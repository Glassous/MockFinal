/**
 * 设计实验室构建：3 个方向 × 3 个页面，输出可直接打开的 shell 与 bundle。
 * 运行前先 `cd builder && npm run build`。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPage } from '../builder/dist/page-kit/render.js';
import { buildShell } from '../shared/page-shell/shell.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
const runtimeSource = readFileSync(join(here, '..', 'shared', 'page-runtime', 'runtime.js'), 'utf8');

const THEMES = [
  { id: 'editorial', label: 'A · 讲义型' },
  { id: 'workbench', label: 'B · 工作台型' },
  { id: 'problem', label: 'C · 题解型' },
];

const PAGES = [
  { id: 'cr-condition', label: 'C-R 条件', short: 'C-R' },
  { id: 'residue-contour', label: '留数定理', short: '留数' },
  { id: 'laplace-ode', label: '拉普拉斯四步法', short: '拉普拉斯' },
];

function channel() {
  return randomBytes(16).toString('hex');
}

function buildOne(theme, page) {
  const content = JSON.parse(readFileSync(join(here, 'content', `${page.id}.json`), 'utf8'));
  const result = renderPage(content, {
    pageId: `page_demo_${page.id.replace(/-/g, '_')}`,
    theme,
    knowledgePointIds: ['kp_demo'],
    estimatedMinutes: content.meta?.minutes ?? 8,
  });
  const bundle = {
    schema_version: '1.1',
    runtime_version: '1.1.0',
    manifest: result.manifest,
    html: result.html,
    css: result.css,
    js: result.js,
  };
  const light = buildShell({ bundle, runtimeSource, channel: channel(), theme: 'light' });
  const dark = buildShell({ bundle, runtimeSource, channel: channel(), theme: 'dark' });
  return { bundle, light, dark, warnings: result.issues };
}

function labIndex() {
  const themeButtons = THEMES.map(
    (theme) => `<button type="button" class="pill" data-theme="${theme.id}">${theme.label}</button>`,
  ).join('');
  const pageButtons = PAGES.map(
    (page) => `<button type="button" class="pill" data-page="${page.id}">${page.short}</button>`,
  ).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>复习页设计实验室</title>
<style>
  :root { color-scheme: light; --bg:#f4f4f5; --panel:#fff; --ink:#16161a; --muted:#6b6b73; --line:#e4e4e7; --invert:#16161a; --invert-ink:#fff; }
  html.dark { color-scheme: dark; --bg:#09090b; --panel:#131316; --ink:#f5f5f6; --muted:#a0a0a8; --line:#26262b; --invert:#f5f5f6; --invert-ink:#09090b; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--ink); font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; }
  .lab { height:100dvh; display:grid; grid-template-rows: auto 1fr; }
  .bar { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:10px 16px; border-bottom:1px solid var(--line); background:var(--panel); }
  .title { display:grid; gap:1px; margin-right:6px; }
  .title strong { font-size:14px; }
  .title span { font-size:11px; color:var(--muted); }
  .group { display:flex; align-items:center; gap:6px; }
  .group-label { font-size:11px; color:var(--muted); }
  .pill { min-height:30px; padding:4px 12px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--ink); font:inherit; font-size:12px; cursor:pointer; }
  .pill:hover { border-color:var(--invert); }
  .pill[aria-pressed="true"] { background:var(--invert); border-color:var(--invert); color:var(--invert-ink); }
  .spacer { flex:1; }
  .hint { font-size:11px; color:var(--muted); max-width:340px; line-height:1.5; }
  .ghost { min-height:30px; padding:4px 10px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--muted); font:inherit; font-size:12px; cursor:pointer; }
  .ghost:hover { color:var(--ink); border-color:var(--invert); }
  iframe { width:100%; height:100%; border:0; background:var(--panel); display:block; }
  .stage { min-height:0; }
  @media (max-width: 760px) { .hint { display:none; } }
</style>
</head>
<body>
<div class="lab">
  <header class="bar">
    <div class="title"><strong>复习页设计实验室</strong><span>3 个方向 × 3 页 · 同一份内容，只换排版</span></div>
    <div class="group" data-group="theme"><span class="group-label">方向</span>${themeButtons}</div>
    <div class="group" data-group="page"><span class="group-label">页面</span>${pageButtons}</div>
    <div class="spacer"></div>
    <p class="hint">点击页面里的图示步骤、选项和底部「下一页」；方向与页面可随时切换。</p>
    <button type="button" class="ghost" id="darkToggle">深色</button>
    <button type="button" class="ghost" id="openPage">打开单页</button>
  </header>
  <div class="stage">
    <iframe id="stage" title="复习页样本"></iframe>
  </div>
</div>
<script>
(function () {
  var themes = ${JSON.stringify(THEMES)};
  var pages = ${JSON.stringify(PAGES)};
  var state = { theme: 'editorial', page: 'cr-condition', dark: false };
  var stage = document.getElementById('stage');
  var darkToggle = document.getElementById('darkToggle');
  var openPage = document.getElementById('openPage');

  function syncButtons() {
    document.querySelectorAll('[data-theme]').forEach(function (el) {
      el.setAttribute('aria-pressed', String(el.getAttribute('data-theme') === state.theme));
    });
    document.querySelectorAll('[data-page]').forEach(function (el) {
      el.setAttribute('aria-pressed', String(el.getAttribute('data-page') === state.page));
    });
    darkToggle.textContent = state.dark ? '浅色' : '深色';
  }

  function src() {
    return './' + state.theme + '/' + state.page + (state.dark ? '--dark' : '') + '.html';
  }

  function render() {
    stage.src = src();
    syncButtons();
  }

  function move(delta) {
    var index = pages.findIndex(function (page) { return page.id === state.page; });
    var next = pages[(index + delta + pages.length) % pages.length];
    state.page = next.id;
    render();
  }

  document.querySelectorAll('[data-theme]').forEach(function (el) {
    el.addEventListener('click', function () {
      state.theme = el.getAttribute('data-theme');
      render();
    });
  });
  document.querySelectorAll('[data-page]').forEach(function (el) {
    el.addEventListener('click', function () {
      state.page = el.getAttribute('data-page');
      render();
    });
  });
  darkToggle.addEventListener('click', function () {
    state.dark = !state.dark;
    render();
  });
  openPage.addEventListener('click', function () {
    window.open(src(), '_blank', 'noopener');
  });
  window.addEventListener('message', function (event) {
    var type = event.data && event.data.type;
    if (type === 'request_next') move(1);
    else if (type === 'request_prev') move(-1);
  });
  render();
})();
</script>
</body>
</html>`;
}

rmSync(outDir, { recursive: true, force: true });
for (const theme of THEMES) {
  const themeDir = join(outDir, theme.id);
  mkdirSync(themeDir, { recursive: true });
  for (const page of PAGES) {
    const { bundle, light, dark, warnings } = buildOne(theme.id, page);
    writeFileSync(join(themeDir, `${page.id}.bundle.json`), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    writeFileSync(join(themeDir, `${page.id}.html`), light, 'utf8');
    writeFileSync(join(themeDir, `${page.id}--dark.html`), dark, 'utf8');
    console.log(
      `[${theme.id}] ${page.id}: html ${light.length} bytes, warnings ${warnings.length}`,
    );
    for (const warning of warnings) console.log(`  - ${warning.code} ${warning.path}: ${warning.message}`);
  }
}
writeFileSync(join(outDir, 'index.html'), labIndex(), 'utf8');
if (!existsSync(join(outDir, 'index.html'))) throw new Error('lab index missing');
console.log(`\nlab ready: ${outDir}`);
console.log('run: node design_lab/serve.mjs  →  http://localhost:4173');
