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

/** 页面可依赖的 runtime 版本；与 shared/page-runtime/runtime.js 顶部声明必须一致（契约 §2）。 */
export const SUPPORTED_RUNTIME_VERSION = '1.0.0';

/** Bundle 结构版本（契约 §3.1）。 */
export const BUNDLE_SCHEMA_VERSION = '1.0';

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
#mp-root :focus-visible { outline: 2px solid var(--mp-invert); outline-offset: 2px; }`;

/** shell 组装失败；`code` 使用 PAGE_CONTRACT §10.1 的失败码。 */
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
  if (record.schema_version !== BUNDLE_SCHEMA_VERSION) {
    throw new ShellBuildError(code, `bundle.schema_version 必须为 "${BUNDLE_SCHEMA_VERSION}"`);
  }
  if (typeof record.runtime_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(record.runtime_version)) {
    throw new ShellBuildError(code, 'bundle.runtime_version 必须是 x.y.z 形式的字符串');
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
  if (declared !== SUPPORTED_RUNTIME_VERSION) {
    throw new ShellBuildError(
      'RUNTIME_VERSION_MISMATCH',
      `runtimeSource 声明 ${declared}，shell 支持 ${SUPPORTED_RUNTIME_VERSION}`
    );
  }
  if (bundleVersion !== declared) {
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

  return `<!doctype html>
<html lang="zh-CN" data-mp-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">
<style>
${BASE_CSS}
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
<script>
${js}
</script>
</body>
</html>
`;
}
