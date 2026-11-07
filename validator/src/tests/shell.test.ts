/**
 * shell 组装的验证器侧测试：确认 Validator 与前端使用同一份 shared/page-shell/shell.mjs。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadRuntimeSource, loadShellModule } from '../shared-shell.js';
import { RUNTIME_VERSION } from '../types.js';

const channel = 'fedcba9876543210fedcba9876543210';

function goodBundle(): Record<string, unknown> {
  const path = fileURLToPath(new URL('../../fixtures/good-basic.bundle.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

test('shared shell 声明的 runtime_version 与 Validator 期望一致', async () => {
  const shell = await loadShellModule();
  assert.equal(shell.SUPPORTED_RUNTIME_VERSION, RUNTIME_VERSION);
  const runtime = loadRuntimeSource();
  assert.ok(runtime.includes(`runtime_version = "${RUNTIME_VERSION}"`));
});

test('buildShell 输出 CSP、channel 与页面内容', async () => {
  const shell = await loadShellModule();
  const html = shell.buildShell({
    bundle: goodBundle(),
    runtimeSource: loadRuntimeSource(),
    channel,
    theme: 'dark'
  });
  assert.ok(html.includes(shell.CSP_CONTENT));
  assert.ok(html.includes(`window.__MP_CHANNEL__ = "${channel}";`));
  assert.ok(html.includes('data-mp-theme="dark"'));
  assert.ok(html.includes('<div id="mp-root">'));
  assert.ok(html.includes('<h1>二分查找：每次排除一半</h1>'));
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('id="mp-root"'));
});

test('escapeForScript / escapeForStyle 与契约一致', async () => {
  const shell = await loadShellModule();
  assert.equal(shell.escapeForScript('</script>'), '<\\/script>');
  assert.equal(shell.escapeForStyle('</style>'), '<\\/style>');
});

test('html 中的逃逸序列与非法 channel 直接失败', async () => {
  const shell = await loadShellModule();
  const runtimeSource = loadRuntimeSource();
  const badHtml = { ...goodBundle(), html: '<div></script></div>' };
  assert.throws(
    () => shell.buildShell({ bundle: badHtml, runtimeSource, channel }),
    (error: unknown) =>
      typeof error === 'object' && error !== null && (error as { code?: string }).code === 'SHELL_ESCAPE_SEQUENCE'
  );
  assert.throws(() => shell.buildShell({ bundle: goodBundle(), runtimeSource, channel: 'nope' }));
});

test('runtime 版本不一致时 shell 拒绝组装', async () => {
  const shell = await loadShellModule();
  const tampered = loadRuntimeSource().replace('runtime_version = "1.0.0"', 'runtime_version = "1.1.0"');
  assert.throws(() =>
    shell.buildShell({ bundle: goodBundle(), runtimeSource: tampered, channel })
  );
});

test('bundle 超过 2 MiB 时 shell 拒绝组装', async () => {
  const shell = await loadShellModule();
  const huge = { ...goodBundle(), css: 'x'.repeat(shell.MAX_BUNDLE_BYTES + 1) };
  assert.throws(
    () => shell.buildShell({ bundle: huge, runtimeSource: loadRuntimeSource(), channel }),
    (error: unknown) =>
      typeof error === 'object' && error !== null && (error as { code?: string }).code === 'BUNDLE_TOO_LARGE'
  );
});
