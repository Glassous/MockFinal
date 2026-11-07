import fs from "node:fs/promises";

import { GuardError, assertBundleFile, MAX_WRITE_BYTES } from "./paths.js";
import type {
  BundleIssue,
  CollectedFile,
  Manifest,
  PageBrief,
  PageBundle,
  ValidationReport,
} from "./types.js";

export const REQUIRED_FILES = ["manifest.json", "page.html", "page.css", "page.js"] as const;

/** HTML 禁止标签（PAGE_CONTRACT §5.1）。 */
const FORBIDDEN_TAGS = [
  "html",
  "head",
  "body",
  "script",
  "style",
  "link",
  "base",
  "iframe",
  "object",
  "embed",
  "meta",
  "form",
];

/** JS 禁止 API 的最低字符串检查；AST 级检查由 Validator 负责。 */
const FORBIDDEN_JS = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "eval(",
  "new Function",
  "document.write",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "document.cookie",
  "window.parent",
  "window.top",
  "window.opener",
  "window.open",
];

export interface CollectResult {
  bundle: PageBundle | null;
  issues: BundleIssue[];
  files: CollectedFile[];
  totalBytes: number;
}

function toIssue(error: unknown, file?: string): BundleIssue {
  if (error instanceof GuardError) {
    return { code: error.code, message: error.message, file };
  }
  return {
    code: "BUNDLE_IO_ERROR",
    message: `读取页面文件失败：${error instanceof Error ? error.message : String(error)}`,
    file,
  };
}

function checkForbiddenSequence(text: string, sequence: string, file: string, code: string): BundleIssue[] {
  if (text.toLowerCase().includes(sequence)) {
    return [
      {
        code,
        message: `${file} 中出现可能破坏宿主 shell 的序列 "${sequence}"，请移除或改用转义写法。`,
        file,
      },
    ];
  }
  return [];
}

function checkUtf8(buffer: Buffer, file: string): BundleIssue[] {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return [{ code: "BUNDLE_BOM", message: `${file} 含 UTF-8 BOM，请保存为无 BOM 的 UTF-8。`, file }];
  }
  const text = buffer.toString("utf8");
  if (text.includes("\uFFFD")) {
    return [{ code: "BUNDLE_ENCODING", message: `${file} 不是合法的 UTF-8 编码。`, file }];
  }
  return [];
}

function checkHtml(html: string): BundleIssue[] {
  const issues: BundleIssue[] = [];
  const lower = html.toLowerCase();
  for (const tag of FORBIDDEN_TAGS) {
    if (new RegExp(`<\\s*${tag}[\\s/>]`, "i").test(lower)) {
      issues.push({
        code: "FORBIDDEN_HTML_TAG",
        message: `page.html 含禁止标签 <${tag}>，只能输出 body 片段。`,
        file: "page.html",
      });
    }
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    issues.push({
      code: "FORBIDDEN_HTML_ATTR",
      message: "page.html 含内联事件属性（on*），请改用 data-mp-* 属性并在 page.js 中监听。",
      file: "page.html",
    });
  }
  if (/(href|src|srcset|poster)\s*=\s*["']\s*(https?:|\/\/)/i.test(html)) {
    issues.push({
      code: "FORBIDDEN_URL",
      message: "page.html 含外部 URL，页面必须完全自包含（内联 SVG 或 data: URI）。",
      file: "page.html",
    });
  }
  if (/(javascript|vbscript|data:text\/html)\s*:/i.test(html)) {
    issues.push({
      code: "FORBIDDEN_URL",
      message: "page.html 含 javascript:/vbscript:/data:text/html 形式的 URL。",
      file: "page.html",
    });
  }
  if (/<foreignobject/i.test(html)) {
    issues.push({
      code: "FORBIDDEN_HTML_TAG",
      message: "page.html 的 SVG 中不允许使用 <foreignObject>。",
      file: "page.html",
    });
  }
  return issues;
}

function checkCss(css: string): BundleIssue[] {
  const issues: BundleIssue[] = [];
  if (/@import/i.test(css)) {
    issues.push({ code: "FORBIDDEN_CSS", message: "page.css 禁止使用 @import。", file: "page.css" });
  }
  if (/url\(\s*['"]?\s*(https?:|\/\/|\/|\.{1,2}\/)/i.test(css)) {
    issues.push({
      code: "FORBIDDEN_CSS",
      message: "page.css 含外部或相对 url()，只允许 data: URI 或页面内引用。",
      file: "page.css",
    });
  }
  if (/expression\s*\(|-moz-binding/i.test(css)) {
    issues.push({ code: "FORBIDDEN_CSS", message: "page.css 含历史脚本化 CSS 写法。", file: "page.css" });
  }
  return issues;
}

function checkJs(js: string): BundleIssue[] {
  const issues: BundleIssue[] = [];
  for (const api of FORBIDDEN_JS) {
    if (js.includes(api)) {
      issues.push({
        code: "FORBIDDEN_JS_API",
        message: `page.js 使用了禁止 API "${api}"。页面不能联网、读写存储、执行动态代码或访问父窗口。`,
        file: "page.js",
      });
    }
  }
  if (!/MockFinal\s*\.\s*ready\s*\(/.test(js)) {
    issues.push({
      code: "MISSING_READY",
      message: "page.js 必须在初始化完成后调用 MockFinal.ready({ title })。",
      file: "page.js",
    });
  }
  return issues;
}

/** Manifest 必填项与 brief 一致性检查（完整 schema 由 Validator 负责）。 */
export function checkManifest(manifest: unknown, expectedPageId: string): BundleIssue[] {
  const issues: BundleIssue[] = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [
      { code: "MANIFEST_INVALID", message: "manifest.json 必须是 JSON 对象。", file: "manifest.json" },
    ];
  }
  const m = manifest as Record<string, unknown>;
  const requireString = (key: string): void => {
    if (typeof m[key] !== "string" || (m[key] as string).trim() === "") {
      issues.push({
        code: "MANIFEST_INVALID",
        message: `manifest.json 缺少必填字符串字段 ${key}。`,
        file: "manifest.json",
      });
    }
  };
  requireString("schema_version");
  requireString("page_id");
  requireString("title");
  requireString("importance");
  requireString("layout");

  if (m.schema_version !== undefined && m.schema_version !== "1.0") {
    issues.push({
      code: "MANIFEST_INVALID",
      message: 'manifest.json 的 schema_version 必须为 "1.0"。',
      file: "manifest.json",
    });
  }
  if (typeof m.page_id === "string" && m.page_id !== expectedPageId) {
    issues.push({
      code: "MANIFEST_PAGE_ID_MISMATCH",
      message: `manifest.json 的 page_id（${m.page_id}）必须与 brief 的 page_id（${expectedPageId}）一致。`,
      file: "manifest.json",
    });
  }
  if (!Array.isArray(m.knowledge_point_ids) || m.knowledge_point_ids.length === 0) {
    issues.push({
      code: "MANIFEST_INVALID",
      message: "manifest.json 的 knowledge_point_ids 必须至少包含 1 个知识点 ID。",
      file: "manifest.json",
    });
  }
  if (!Array.isArray(m.interactions)) {
    issues.push({
      code: "MANIFEST_INVALID",
      message: "manifest.json 的 interactions 必须是数组（非交互页也要给出声明）。",
      file: "manifest.json",
    });
  }
  if (!Array.isArray(m.source_refs)) {
    issues.push({
      code: "MANIFEST_INVALID",
      message: "manifest.json 的 source_refs 必须是数组，且不得编造引用。",
      file: "manifest.json",
    });
  }
  if (typeof m.estimated_minutes !== "number" || !(m.estimated_minutes > 0)) {
    issues.push({
      code: "MANIFEST_INVALID",
      message: "manifest.json 的 estimated_minutes 必须是正整数。",
      file: "manifest.json",
    });
  }
  const a11y = m.a11y;
  if (!a11y || typeof a11y !== "object" || (a11y as Record<string, unknown>).reduced_motion !== true) {
    issues.push({
      code: "MANIFEST_INVALID",
      message: "manifest.json 的 a11y.reduced_motion 必须为 true。",
      file: "manifest.json",
    });
  }
  return issues;
}

export interface CollectOptions {
  buildDir: string;
  brief: PageBrief;
  maxBundleBytes?: number;
  runtimeVersion?: string;
}

/**
 * 收集 cwd 下的 4 个页面文件，做路径/大小/扩展名/禁止序列/Manifest 基础检查，
 * 组装 PageBundle。任何问题都通过 issues 返回，不抛异常（便于转成修复提示）。
 */
export async function collectBundle(options: CollectOptions): Promise<CollectResult> {
  const maxBundleBytes = options.maxBundleBytes ?? 2 * 1024 * 1024;
  const perFileLimit = Math.min(maxBundleBytes, MAX_WRITE_BYTES);
  const issues: BundleIssue[] = [];
  const files: CollectedFile[] = [];
  const contents = new Map<string, string>();

  for (const name of REQUIRED_FILES) {
    try {
      const abs = assertBundleFile(options.buildDir, name, perFileLimit);
      const buffer = await fs.readFile(abs);
      issues.push(...checkUtf8(buffer, name));
      files.push({ name, bytes: buffer.byteLength });
      contents.set(name, buffer.toString("utf8"));
    } catch (error) {
      issues.push(toIssue(error, name));
    }
  }

  if (issues.some((issue) => issue.code === "BUNDLE_FILE_MISSING")) {
    return { bundle: null, issues, files, totalBytes: files.reduce((sum, f) => sum + f.bytes, 0) };
  }

  const manifestText = contents.get("manifest.json");
  const html = contents.get("page.html") ?? "";
  const css = contents.get("page.css") ?? "";
  const js = contents.get("page.js") ?? "";

  let manifest: Manifest | null = null;
  if (manifestText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(manifestText);
      issues.push(...checkManifest(parsed, options.brief.page_id));
      manifest = parsed as Manifest;
    } catch {
      issues.push({
        code: "MANIFEST_INVALID",
        message: "manifest.json 不是合法 JSON，请检查括号、引号与逗号。",
        file: "manifest.json",
      });
    }
  }

  issues.push(...checkForbiddenSequence(html, "</script", "page.html", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkForbiddenSequence(html, "</style", "page.html", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkForbiddenSequence(html, "<!--", "page.html", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkForbiddenSequence(css, "</style", "page.css", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkForbiddenSequence(js, "</script", "page.js", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkHtml(html));
  issues.push(...checkCss(css));
  issues.push(...checkJs(js));

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > maxBundleBytes) {
    issues.push({
      code: "BUNDLE_TOO_LARGE",
      message: `页面产物合计 ${totalBytes} 字节，超过上限 ${maxBundleBytes} 字节；请精简内联资源。`,
    });
  }

  if (issues.length > 0 || !manifest) {
    return { bundle: null, issues, files, totalBytes };
  }

  const bundle: PageBundle = {
    schema_version: "1.0",
    runtime_version:
      options.runtimeVersion ?? options.brief.constraints?.runtime_version ?? "1.0.0",
    manifest,
    html,
    css,
    js,
  };
  const serializedBytes = Buffer.byteLength(JSON.stringify(bundle), "utf8");
  if (serializedBytes > maxBundleBytes) {
    issues.push({
      code: "BUNDLE_TOO_LARGE",
      message: `序列化后的 bundle 为 ${serializedBytes} 字节，超过上限 ${maxBundleBytes} 字节。`,
    });
    return { bundle: null, issues, files, totalBytes: serializedBytes };
  }

  return { bundle, issues, files, totalBytes: serializedBytes };
}

/** 把 bundle 静态问题与 Validator 问题合并成修复提示用的列表。 */
export function formatIssuesForRepair(
  issues: BundleIssue[],
  validation?: ValidationReport | null,
): string {
  const lines: string[] = [];
  if (issues.length > 0) {
    lines.push("静态检查问题（必须修复）：");
    for (const issue of issues) {
      lines.push(`- [${issue.code}]${issue.file ? ` ${issue.file}:` : ""} ${issue.message}`);
    }
  }
  const validationIssues = validation?.issues ?? [];
  const errors = validationIssues.filter((issue) => issue.severity === "error");
  const warnings = validationIssues.filter((issue) => issue.severity !== "error");
  if (errors.length > 0) {
    lines.push("校验器错误（必须修复）：");
    for (const issue of errors) {
      lines.push(
        `- [${issue.code}]${issue.viewport ? ` ${issue.viewport}:` : ""} ${issue.message}${
          issue.selector ? `（选择器：${issue.selector}）` : ""
        }`,
      );
    }
  }
  if (warnings.length > 0) {
    lines.push("校验器警告（尽量修复）：");
    for (const issue of warnings) {
      lines.push(`- [${issue.code}] ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export type { ValidationReport };
