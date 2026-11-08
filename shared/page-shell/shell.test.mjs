/**
 * shell 组装测试（node:test，无第三方依赖）
 * 运行：node --test shared/page-shell/shell.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildShell,
  escapeForScript,
  escapeForStyle,
  ShellBuildError,
  CSP_CONTENT,
  MAX_BUNDLE_BYTES,
  SUPPORTED_RUNTIME_VERSION
} from './shell.mjs';

const runtimeSource = readFileSync(
  fileURLToPath(new URL('../page-runtime/runtime.js', import.meta.url)),
  'utf8'
);

const channel = '0123456789abcdef0123456789abcdef';

function makeBundle(overrides = {}) {
  return {
    schema_version: '1.0',
    runtime_version: SUPPORTED_RUNTIME_VERSION,
    manifest: {
      schema_version: '1.0',
      page_id: 'page_test_001',
      title: '测试页',
      knowledge_point_ids: ['kp_001'],
      importance: 'core',
      estimated_minutes: 5,
      layout: 'focus',
      interactions: [{ id: 'demo', type: 'none', label: '无交互', smoke: null }],
      source_refs: [{ material_id: 1, section_id: 1, quote: '引用原文' }],
      a11y: { reduced_motion: true }
    },
    html: '<div class="mp-page"><h1>测试页</h1><button data-mp-action="go">下一步</button></div>',
    css: '.mp-page { height: 100dvh; overflow: hidden; }',
    js: "MockFinal.ready({ title: '测试页' });",
    ...overrides
  };
}

test('escapeForScript 只替换 </script 序列', () => {
  assert.equal(escapeForScript('a</script>b</SCRIPT>c'), 'a<\\/script>b<\\/script>c');
  assert.equal(escapeForScript('plain'), 'plain');
});

test('escapeForStyle 只替换 </style 序列', () => {
  assert.equal(escapeForStyle('a</style>b</STYLE>c'), 'a<\\/style>b<\\/style>c');
  assert.equal(escapeForStyle('plain'), 'plain');
});

test('buildShell 生成契约要求的 CSP 与文档骨架', () => {
  const shell = buildShell({ bundle: makeBundle(), runtimeSource, channel });
  assert.ok(shell.startsWith('<!doctype html>'));
  assert.ok(shell.includes(`content="${CSP_CONTENT}"`));
  assert.ok(
    shell.includes(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"
    )
  );
  assert.ok(shell.includes('<html lang="zh-CN" data-mp-theme="light">'));
  assert.ok(shell.includes(`window.__MP_CHANNEL__ = ${JSON.stringify(channel)};`));
  assert.ok(shell.includes('<div id="mp-root">'));
  assert.ok(shell.includes('--mp-surface'));
  assert.ok(shell.includes('<h1>测试页</h1>'));
  // CSP meta 必须位于任何 page 内容之前
  assert.ok(shell.indexOf('Content-Security-Policy') < shell.indexOf('mp-root'));
});

test('buildShell 注入顺序固定：base css → page css → html → channel → runtime → page.js', () => {
  const shell = buildShell({ bundle: makeBundle(), runtimeSource, channel });
  const baseCss = shell.indexOf('--mp-surface');
  const pageCss = shell.indexOf('.mp-page { height: 100dvh');
  const root = shell.indexOf('<div id="mp-root">');
  const chan = shell.indexOf('window.__MP_CHANNEL__');
  const runtime = shell.indexOf(`var RUNTIME_VERSION = '${SUPPORTED_RUNTIME_VERSION}';`);
  const pageJs = shell.indexOf("MockFinal.ready({ title: '测试页' });");
  assert.ok(baseCss < pageCss, 'base css 必须在 page css 之前');
  assert.ok(pageCss < root, 'page css 必须在页面内容之前');
  assert.ok(root < chan, 'channel 必须在页面内容之后');
  assert.ok(chan < runtime, 'channel 必须在 runtime 之前');
  assert.ok(runtime < pageJs, 'runtime 必须在 page.js 之前');
});

test('buildShell 对 js 中的 </script 转义，页面无法提前闭合脚本', () => {
  const bundle = makeBundle({ js: "const s = '</script>'; MockFinal.ready({ title: 'x' });" });
  const shell = buildShell({ bundle, runtimeSource, channel });
  assert.equal(shell.split('</script>').length - 1, 2, '只允许 runtime 与 page.js 两个闭合标签');
  assert.ok(shell.includes('<\\/script'));
});

test('buildShell 对 css 中的 </style 转义', () => {
  const bundle = makeBundle({ css: '.mp-page::after { content: "</style>"; }' });
  const shell = buildShell({ bundle, runtimeSource, channel });
  assert.equal(shell.split('</style>').length - 1, 2, '只允许 base 与 page.css 两个闭合标签');
  assert.ok(shell.includes('<\\/style'));
});

test('buildShell 拒绝 html 中的 </script 序列', () => {
  const bundle = makeBundle({ html: '<div class="mp-page"></script></div>' });
  assert.throws(
    () => buildShell({ bundle, runtimeSource, channel }),
    (err) => err instanceof ShellBuildError && err.code === 'SHELL_ESCAPE_SEQUENCE'
  );
});

test('buildShell 拒绝 html 中的 </style 与 HTML 注释起始序列', () => {
  for (const html of ['<div></style></div>', '<div><!-- 注释 --></div>']) {
    assert.throws(
      () => buildShell({ bundle: makeBundle({ html }), runtimeSource, channel }),
      (err) => err instanceof ShellBuildError && err.code === 'SHELL_ESCAPE_SEQUENCE'
    );
  }
});

test('buildShell 拒绝 html 中的可执行/可外链标签', () => {
  for (const html of [
    '<script>alert(1)</script>',
    '<style>.x{}</style>',
    '<iframe src="https://evil.example"></iframe>',
    '<form action="https://evil.example"></form>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example/">',
  ]) {
    assert.throws(
      () => buildShell({ bundle: makeBundle({ html }), runtimeSource, channel }),
      (err) => err instanceof ShellBuildError && err.code === 'SHELL_ESCAPE_SEQUENCE'
    );
  }
});

test('buildShell 校验 schema_version / runtime_version / 字段类型', () => {
  const cases = [
    makeBundle({ schema_version: '2.0' }),
    makeBundle({ runtime_version: '0.9.0' }),
    makeBundle({ manifest: null }),
    makeBundle({ html: 1 })
  ];
  for (const bundle of cases) {
    assert.throws(
      () => buildShell({ bundle, runtimeSource, channel }),
      (err) => err instanceof ShellBuildError,
      JSON.stringify(bundle).slice(0, 40)
    );
  }
  assert.throws(
    () =>
      buildShell({
        bundle: makeBundle({ runtime_version: '9.9.9' }),
        runtimeSource,
        channel
      }),
    (err) => err instanceof ShellBuildError && err.code === 'RUNTIME_VERSION_MISMATCH'
  );
});

test('buildShell 兼容 1.0 旧 bundle（1.1 runtime 向后兼容）', () => {
  const shell = buildShell({
    bundle: makeBundle({ schema_version: '1.0', runtime_version: '1.0.0' }),
    runtimeSource,
    channel
  });
  assert.ok(shell.includes(`var RUNTIME_VERSION = '${SUPPORTED_RUNTIME_VERSION}';`));
  assert.ok(shell.includes('<div id="mp-root">'));
});

test('buildShell 拒绝超过 2 MiB 的 bundle', () => {
  const bundle = makeBundle({ css: '.a{color:red}' + 'x'.repeat(MAX_BUNDLE_BYTES) });
  assert.throws(
    () => buildShell({ bundle, runtimeSource, channel }),
    (err) => err instanceof ShellBuildError && err.code === 'BUNDLE_TOO_LARGE'
  );
});

test('buildShell 校验 channel 与 theme', () => {
  assert.throws(
    () => buildShell({ bundle: makeBundle(), runtimeSource, channel: 'short' }),
    (err) => err instanceof ShellBuildError && err.code === 'INVALID_CHANNEL'
  );
  assert.throws(
    () => buildShell({ bundle: makeBundle(), runtimeSource, channel, theme: 'sepia' }),
    (err) => err instanceof ShellBuildError && err.code === 'INVALID_THEME'
  );
  const dark = buildShell({ bundle: makeBundle(), runtimeSource, channel, theme: 'dark' });
  assert.ok(dark.includes('data-mp-theme="dark"'));
});

test('DECK_KIT 只对 design_system=1.0 注入，且不新增 style 标签', () => {
  const legacy = buildShell({ bundle: makeBundle(), runtimeSource, channel });
  assert.equal((legacy.match(/<style>/g) || []).length, 2);
  assert.ok(!legacy.includes('.mp-layout-split'), '旧页面不得注入 kit');

  const bundle = makeBundle({
    schema_version: '1.1',
    manifest: {
      ...makeBundle().manifest,
      schema_version: '1.1',
      design_system: '1.0',
      teaching: { version: '1.0', role: 'mechanism', objectives: ['目标'] }
    }
  });
  const next = buildShell({ bundle, runtimeSource, channel });
  assert.equal((next.match(/<style>/g) || []).length, 2);
  assert.ok(next.includes('.mp-layout-split'));
  assert.ok(next.includes('.mp-option'));
  assert.ok(next.includes('data-mp-state="hidden"'));
});

test('Shell 基础层提供移动端纵向滚动且禁止横向溢出', () => {
  const shell = buildShell({ bundle: makeBundle(), runtimeSource, channel });
  assert.ok(shell.includes('@media (max-width: 767px)'));
  assert.ok(shell.includes('overflow-y: auto !important'));
  assert.ok(shell.includes('overflow-x: hidden !important'));
});

function makePg2Bundle(overrides = {}) {
  return {
    schema_version: '1.1',
    runtime_version: SUPPORTED_RUNTIME_VERSION,
    manifest: {
      ...makeBundle().manifest,
      schema_version: '1.1',
      design_system: '2.0',
      renderer: { kit: 'page-kit', version: '2.0.0', theme: 'editorial' },
      teaching: { version: '1.0', role: 'mechanism', objectives: ['目标'], scroll: 'flow' }
    },
    html: '<div class="pg-page" data-pg-theme="editorial" data-pg-title="测试页"><h1 class="pg-title">测试页</h1></div>',
    css: '',
    js: '',
    ...overrides
  };
}

test('PAGE_KIT 2.0 注入基础样式、主题、通用脚本与 scroll 属性', () => {
  const shell = buildShell({ bundle: makePg2Bundle(), runtimeSource, channel });
  assert.equal((shell.match(/<style>/g) || []).length, 2);
  assert.ok(shell.includes('.pg-page'));
  assert.ok(shell.includes('[data-pg-theme="editorial"]'));
  assert.ok(shell.includes('[data-pg-theme="workbench"]'));
  assert.ok(shell.includes('[data-pg-theme="problem"]'));
  assert.ok(shell.includes('data-mp-scroll="flow"'));
  assert.ok(shell.includes('data-pg-figure'));
  assert.ok(shell.includes('MockFinal.ready'));
  const runtimeIndex = shell.indexOf("var RUNTIME_VERSION = '1.1.0';");
  const kitIndex = shell.indexOf('data-pg-figure');
  assert.ok(runtimeIndex >= 0 && runtimeIndex < kitIndex, 'kit 脚本必须在 runtime 之后');
  assert.ok(!shell.includes('.mp-layout-split'), '2.0 页面不得注入 1.0 Deck Kit');
});

test('PAGE_KIT 2.0 fit 页写入 data-mp-scroll=fit', () => {
  const bundle = makePg2Bundle();
  bundle.manifest.teaching = { ...bundle.manifest.teaching, scroll: 'fit' };
  const shell = buildShell({ bundle, runtimeSource, channel });
  assert.ok(shell.includes('data-mp-scroll="fit"'));
});

test('PAGE_KIT 2.0 必须提供合法主题', () => {
  const bundle = makePg2Bundle();
  bundle.manifest.renderer = { kit: 'page-kit', version: '2.0.0', theme: 'sepia' };
  assert.throws(
    () => buildShell({ bundle, runtimeSource, channel }),
    (err) => err instanceof ShellBuildError && err.code === 'BUNDLE_SCHEMA_INVALID'
  );
  const missing = makePg2Bundle();
  delete missing.manifest.renderer;
  assert.throws(
    () => buildShell({ bundle: missing, runtimeSource, channel }),
    (err) => err instanceof ShellBuildError && err.code === 'BUNDLE_SCHEMA_INVALID'
  );
});
