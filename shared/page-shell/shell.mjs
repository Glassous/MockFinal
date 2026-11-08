/**
 * page-shell · 页面 shell 组装（PAGE_CONTRACT.md §7.1、§7.3）
 *
 * 前端阅读器与 Validator 复用本文件（共享源码），保证「校验时通过、真实渲染漂移」不会发生。
 * 纯 ESM、无依赖，Node 与打包工具都能直接用。
 *
 * 顺序固定：reset/token base → page.css → #mp-root + page.html → channel → runtime.js → page.js。
 * 组装层不静默清洗：html 片段出现 </script、</style、<!-- 直接抛错；
 * js/css 中的逃离序列按契约替换为 <\/script、<\/style。
 */

import {
  PAGE_KIT_CSS,
  PAGE_KIT_JS,
  PAGE_KIT_THEMES,
  PAGE_KIT_VERSION,
} from './page-kit/index.mjs';

export { PAGE_KIT_VERSION, PAGE_KIT_THEMES };

/** 页面可依赖的 runtime 版本（当前）；与 runtime.js 顶部声明一致。 */
export const SUPPORTED_RUNTIME_VERSION = '1.1.0';

/** 同时兼容的 runtime 版本：1.0 旧页面继续用 1.1 runtime 渲染。 */
export const SUPPORTED_RUNTIME_VERSIONS = Object.freeze(['1.0.0', '1.1.0']);

/** Bundle 结构版本（当前）。 */
export const BUNDLE_SCHEMA_VERSION = '1.1';

/** 同时兼容的 bundle schema 版本。 */
export const BUNDLE_SCHEMA_VERSIONS = Object.freeze(['1.0', '1.1']);

/** Bundle 总字节数上限（2 MiB，契约 §3.1）。 */
export const MAX_BUNDLE_BYTES = 2097152;

/** CSP 与契约 §7.2 逐字一致，不得使用 'self' 或外部域名。 */
export const CSP_CONTENT =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; " +
  "font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

/** reset + 语义 token 映射 + runtime base（契约 §6.2、§7.1）。 */
const BASE_CSS = `:root {
  color-scheme: light;
  --mp-surface: #f4f4f5;
  --mp-panel: #ffffff;
  --mp-raised: #fafafb;
  --mp-border: #e4e4e7;
  --mp-border-strong: #d4d4d8;
  --mp-ink: #16161a;
  --mp-muted: #6b6b73;
  --mp-faint: #9a9aa2;
  --mp-invert: #16161a;
  --mp-invert-ink: #ffffff;
  --mp-code-bg: #f4f4f5;
  --mp-font-sans: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --mp-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
}
html[data-mp-theme="dark"] {
  color-scheme: dark;
  --mp-surface: #09090b;
  --mp-panel: #131316;
  --mp-raised: #1c1c20;
  --mp-border: #26262b;
  --mp-border-strong: #3a3a41;
  --mp-ink: #f5f5f6;
  --mp-muted: #a0a0a8;
  --mp-faint: #6e6e77;
  --mp-invert: #f5f5f6;
  --mp-invert-ink: #09090b;
  --mp-code-bg: #0e0e11;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--mp-panel); color: var(--mp-ink); font-family: var(--mp-font-sans); }
#mp-root { height: 100dvh; overflow: hidden; }
/* flow 页：由 html 承担纵向滚动，body 保持 visible，页面内的 sticky 才有效 */
html[data-mp-scroll="flow"] { height: auto; overflow-x: hidden; overflow-y: auto; }
html[data-mp-scroll="flow"] body { height: auto; overflow: visible; }
html[data-mp-scroll="flow"] #mp-root { height: auto; min-height: 100dvh; overflow: visible; }
#mp-root :focus-visible { outline: 2px solid var(--mp-invert); outline-offset: 2px; }
#mp-root [data-mp-focus="true"] { outline: 2px solid var(--mp-invert); outline-offset: 3px; border-radius: 6px; }
/* 移动端阅读模式：允许页面纵向滚动，禁止横向溢出；桌面零滚动规则不变 */
@media (max-width: 767px) {
  html, body { height: auto !important; overflow-y: auto !important; overflow-x: hidden !important; }
  #mp-root { height: auto !important; min-height: 100dvh; overflow: visible !important; }
  #mp-root > *, #mp-root .mp-page {
    height: auto !important;
    max-height: none !important;
    overflow-y: visible !important;
    overflow-x: hidden !important;
  }
}
/* 移动端同样由 html 滚动，避免 body 变成非滚动容器导致 sticky 失效 */
html[data-mp-scroll="flow"] body { overflow: visible !important; }
`;

/** 设计系统版本（manifest.design_system = "1.0" 时注入 DECK_KIT_CSS）。 */
export const DECK_KIT_VERSION = '1.0';

/**
 * 宿主组件基线（P10）：只在新页面（design_system=1.0）注入，旧页面渲染完全不变。
 * 纯内联 CSS，无外部字体/图片/脚本；页面可覆盖局部样式，但不得自造基础按钮/卡片。
 */
export const DECK_KIT_CSS = `
.mp-page { height: 100dvh; display: flex; flex-direction: column; gap: 0; overflow: hidden; padding: 28px 36px; }
.mp-head { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
.mp-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--mp-faint); }
.mp-title { margin: 0; font-size: clamp(24px, 2.2vw, 34px); line-height: 1.2; letter-spacing: -.01em; font-weight: 700; color: var(--mp-ink); }
.mp-sub { margin: 0; font-size: 15px; line-height: 1.6; color: var(--mp-muted); max-width: 72ch; }
.mp-body { flex: 1; min-height: 0; display: grid; gap: 18px; }
.mp-foot { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mp-border); font-size: 12px; color: var(--mp-faint); display: flex; justify-content: space-between; gap: 12px; }
.mp-layout-focus { grid-template-columns: minmax(0, 1fr); }
.mp-layout-split { grid-template-columns: minmax(0, 1.25fr) minmax(0, .75fr); }
.mp-layout-steps { grid-template-columns: minmax(0, .72fr) minmax(0, 1.28fr); }
.mp-layout-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mp-layout-compare { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mp-section-title { margin: 0 0 8px; font-size: 17px; line-height: 1.4; font-weight: 600; letter-spacing: -.01em; color: var(--mp-ink); }
.mp-text { margin: 0; font-size: 15px; line-height: 1.75; color: var(--mp-ink); }
.mp-caption { font-size: 12px; line-height: 1.55; color: var(--mp-muted); }
.mp-label { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--mp-faint); }
.mp-formula { padding: 10px 14px; border: 1px solid var(--mp-border); border-radius: 12px; background: var(--mp-raised); overflow-x: auto; }
.mp-card { padding: 16px 18px; border: 1px solid var(--mp-border); border-radius: 18px; background: var(--mp-panel); min-width: 0; }
.mp-callout { padding: 12px 14px; border-left: 3px solid var(--mp-border-strong); border-radius: 0 12px 12px 0; background: var(--mp-raised); }
.mp-quote { margin: 0; padding: 12px 16px; border-left: 3px solid var(--mp-border-strong); border-radius: 0 12px 12px 0; background: var(--mp-raised); color: var(--mp-muted); font-size: 14px; }
.mp-figure { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; border: 1px solid var(--mp-border); border-radius: 18px; background: var(--mp-raised); min-width: 0; }
.mp-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--mp-muted); }
.mp-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border: 1px solid var(--mp-border); border-radius: 999px; font-size: 12px; color: var(--mp-muted); }
.mp-stepper { display: flex; flex-direction: column; gap: 8px; }
.mp-step { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--mp-border); border-radius: 14px; background: var(--mp-panel); color: var(--mp-ink); text-align: left; font: inherit; font-size: 14px; }
.mp-step[aria-current="step"], .mp-step[data-mp-state="active"] { border-color: var(--mp-ink); background: var(--mp-raised); }
.mp-step[data-mp-state="done"] { color: var(--mp-muted); }
.mp-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--mp-border); }
.mp-tabs [role="tab"] { padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--mp-muted); font: inherit; font-size: 14px; cursor: pointer; }
.mp-tabs [role="tab"][aria-selected="true"] { color: var(--mp-ink); border-bottom-color: var(--mp-ink); font-weight: 600; }
.mp-panel { padding: 16px 18px; border: 1px solid var(--mp-border); border-radius: 18px; background: var(--mp-panel); min-width: 0; }
.mp-check { display: flex; flex-direction: column; gap: 8px; }
.mp-option { display: flex; gap: 8px; align-items: flex-start; padding: 9px 12px; border: 1px solid var(--mp-border); border-radius: 12px; background: var(--mp-panel); color: var(--mp-ink); text-align: left; font: inherit; font-size: 14px; }
.mp-option[data-mp-state="correct"] { border-color: var(--mp-ink); background: var(--mp-raised); }
.mp-option[data-mp-state="wrong"] { border-color: var(--mp-border-strong); color: var(--mp-muted); }
.mp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 7px 14px; border: 1px solid var(--mp-border); border-radius: 12px; background: var(--mp-panel); color: var(--mp-ink); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.mp-btn:hover { border-color: var(--mp-border-strong); background: var(--mp-raised); }
.mp-btn-primary { border-color: var(--mp-invert); background: var(--mp-invert); color: var(--mp-invert-ink); }
.mp-btn:disabled { opacity: .45; cursor: not-allowed; }
[hidden], [data-mp-state="hidden"] { display: none !important; }
.mp-badge, .mp-caption, .mp-label, .mp-legend, .mp-step { min-height: 0; }
@media (prefers-reduced-motion: reduce) {
  .mp-page *, .mp-page *::before, .mp-page *::after { animation: none !important; transition: none !important; }
}
`;

/** Shell 组装失败；`code` 使用 PAGE_CONTRACT §10.1 的失败码。 */
export class ShellBuildError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ShellBuildError';
    this.code = code;
  }
}

/**
 * 转义 page.js 中的 `</script`，避免提前闭合内联脚本标签。
 * @param {string} source
 * @returns {string}
 */
export function escapeForScript(source) {
  return String(source).replace(/<\/script/gi, '<\\/script');
}

/**
 * 转义 page.css 中的 `</style`，避免提前闭合内联样式标签。
 * @param {string} source
 * @returns {string}
 */
export function escapeForStyle(source) {
  return String(source).replace(/<\/style/gi, '<\\/style');
}

function byteLength(text) {
  // TextEncoder 在 Node 与浏览器中均可用，前端阅读器复用本文件时不需要 Buffer
  return new TextEncoder().encode(String(text)).length;
}

function assertPlainString(value, field, code) {
  if (typeof value !== 'string') {
    throw new ShellBuildError(code, `bundle.${field} 必须是字符串`);
  }
  if (value.charCodeAt(0) === 0xfeff) {
    throw new ShellBuildError(code, `bundle.${field} 不得包含 BOM`);
  }
}

/**
 * 校验 bundle 顶层结构、大小与 runtime_version（契约 §3.1、§12.3）。
 * @param {unknown} bundle
 */
function assertBundle(bundle) {
  const code = 'BUNDLE_SCHEMA_INVALID';
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new ShellBuildError(code, 'bundle 必须是 JSON 对象');
  }
  const record = /** @type {Record<string, unknown>} */ (bundle);
  if (record.schema_version !== BUNDLE_SCHEMA_VERSION && !BUNDLE_SCHEMA_VERSIONS.includes(record.schema_version)) {
    throw new ShellBuildError(
      code,
      `bundle.schema_version 必须为 ${BUNDLE_SCHEMA_VERSIONS.map((v) => `"${v}"`).join(' 或 ')}`
    );
  }
  if (!SUPPORTED_RUNTIME_VERSIONS.includes(record.runtime_version)) {
    throw new ShellBuildError(
      'RUNTIME_VERSION_MISMATCH',
      `bundle.runtime_version 必须为 ${SUPPORTED_RUNTIME_VERSIONS.join(' / ')} 之一`
    );
  }
  if (!record.manifest || typeof record.manifest !== 'object' || Array.isArray(record.manifest)) {
    throw new ShellBuildError(code, 'bundle.manifest 必须是对象');
  }
  assertPlainString(record.html, 'html', code);
  assertPlainString(record.css, 'css', code);
  assertPlainString(record.js, 'js', code);

  const total = byteLength(JSON.stringify(bundle));
  if (total > MAX_BUNDLE_BYTES) {
    throw new ShellBuildError('BUNDLE_TOO_LARGE', `bundle 总字节数 ${total} 超过上限 ${MAX_BUNDLE_BYTES}`);
  }
  return /** @type {{ schema_version: string, runtime_version: string, manifest: object, html: string, css: string, js: string }} */ (record);
}

/**
 * 校验 runtime 源码声明的版本与 bundle 一致（契约 §12.3）。
 * @param {unknown} runtimeSource
 * @param {string} bundleVersion
 */
function assertRuntime(runtimeSource, bundleVersion) {
  if (typeof runtimeSource !== 'string' || runtimeSource.trim() === '') {
    throw new ShellBuildError('RUNTIME_VERSION_MISMATCH', 'runtimeSource 不能为空');
  }
  const match = /runtime_version\s*=\s*["'](\d+\.\d+\.\d+)["']/.exec(runtimeSource);
  if (!match) {
    throw new ShellBuildError('RUNTIME_VERSION_MISMATCH', 'runtimeSource 顶部未声明 runtime_version');
  }
  const declared = match[1];
  if (!SUPPORTED_RUNTIME_VERSIONS.includes(declared)) {
    throw new ShellBuildError(
      'RUNTIME_VERSION_MISMATCH',
      `runtimeSource 声明 ${declared}，shell 支持 ${SUPPORTED_RUNTIME_VERSIONS.join(' / ')}`
    );
  }
  if (!SUPPORTED_RUNTIME_VERSIONS.includes(bundleVersion)) {
    throw new ShellBuildError(
      'RUNTIME_VERSION_MISMATCH',
      `bundle.runtime_version 为 ${bundleVersion}，不在支持列表`
    );
  }
  // 1.1 runtime 向后兼容 1.0 页面；bundle 不得声明高于注入 runtime 的版本
  if (bundleVersion > declared) {
    throw new ShellBuildError(
      'RUNTIME_VERSION_MISMATCH',
      `bundle.runtime_version 为 ${bundleVersion}，runtime 声明 ${declared}`
    );
  }
}

/**
 * HTML 片段中出现会破坏 shell 结构的序列时直接失败，不做静默清洗（契约 §7.3 第 4 条）。
 * @param {string} html
 */
function assertHtmlFragment(html) {
  if (/<\/script/i.test(html)) {
    throw new ShellBuildError('SHELL_ESCAPE_SEQUENCE', 'html 片段不得包含 </script 序列');
  }
  if (/<\/style/i.test(html)) {
    throw new ShellBuildError('SHELL_ESCAPE_SEQUENCE', 'html 片段不得包含 </style 序列');
  }
  if (html.includes('<!--')) {
    throw new ShellBuildError('SHELL_ESCAPE_SEQUENCE', 'html 片段不得包含 HTML 注释起始序列 <!--');
  }
  // 防御纵深：即使 bundle 绕过 Validator 落库，也不让可执行/可外链标签进入阅读器
  const forbidden = /<\s*(script|style|iframe|object|embed|link|form|base|meta)\b/i.exec(html);
  if (forbidden) {
    throw new ShellBuildError(
      'SHELL_ESCAPE_SEQUENCE',
      `html 片段不得包含 <${forbidden[1].toLowerCase()}> 标签`
    );
  }
}

/**
 * 组装完整 shell。失败时抛 ShellBuildError（含契约失败码），调用方不得吞掉后继续渲染。
 *
 * @param {object} input
 * @param {{ schema_version: string, runtime_version: string, manifest: object, html: string, css: string, js: string }} input.bundle
 * @param {string} input.runtimeSource shared/page-runtime/runtime.js 的内容
 * @param {string} input.channel 每次 iframe 独立的 32 位十六进制 channel
 * @param {'light'|'dark'} [input.theme]
 * @returns {string} 完整 HTML 文档（可写入 iframe srcdoc 或 page.setContent）
 */
export function buildShell({ bundle, runtimeSource, channel, theme = 'light' } = {}) {
  const safeBundle = assertBundle(bundle);
  assertRuntime(runtimeSource, safeBundle.runtime_version);
  if (typeof channel !== 'string' || !/^[0-9a-f]{32}$/i.test(channel)) {
    throw new ShellBuildError('INVALID_CHANNEL', 'channel 必须是 32 位十六进制字符串');
  }
  if (theme !== 'light' && theme !== 'dark') {
    throw new ShellBuildError('INVALID_THEME', 'theme 只能是 light 或 dark');
  }
  assertHtmlFragment(safeBundle.html);

  const css = escapeForStyle(safeBundle.css);
  const runtime = escapeForScript(runtimeSource);
  const js = escapeForScript(safeBundle.js);
  const manifest = /** @type {Record<string, unknown>} */ (safeBundle.manifest);
  const isPageKit2 = manifest.design_system === '2.0';
  let kitTheme = '';
  if (isPageKit2) {
    const renderer = manifest.renderer;
    kitTheme =
      renderer && typeof renderer === 'object' && typeof renderer.theme === 'string'
        ? renderer.theme
        : '';
    if (!PAGE_KIT_THEMES.includes(kitTheme)) {
      throw new ShellBuildError(
        'BUNDLE_SCHEMA_INVALID',
        `design_system 2.0 页面必须在 manifest.renderer.theme 指定 ${PAGE_KIT_THEMES.join(' / ')}`
      );
    }
  }
  const scrollMode =
    isPageKit2 && manifest.teaching && manifest.teaching.scroll === 'flow' ? 'flow' : 'fit';
  const kit = isPageKit2
    ? PAGE_KIT_CSS
    : manifest.design_system === DECK_KIT_VERSION
      ? DECK_KIT_CSS
      : '';
  const scrollAttr = isPageKit2 ? ` data-mp-scroll="${scrollMode}"` : '';
  const pageKitScript = isPageKit2
    ? `<script>\n${escapeForScript(PAGE_KIT_JS)}\n</script>\n`
    : '';

  return `<!doctype html>
<html lang="zh-CN" data-mp-theme="${theme}"${scrollAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">
<style>
${BASE_CSS}
${kit}
</style>
<style>
${css}
</style>
</head>
<body>
<div id="mp-root">
${safeBundle.html}
</div>
<script>
window.__MP_CHANNEL__ = ${JSON.stringify(channel)};
${runtime}
</script>
${pageKitScript}<script>
${js}
</script>
</body>
</html>
`;
}
