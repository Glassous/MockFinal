import fs from "node:fs/promises";

import { GuardError, assertBundleFile, MAX_WRITE_BYTES } from "./paths.js";
import { renderPage } from "./page-kit/render.js";
import { PageContentError, PAGE_THEMES } from "./page-kit/types.js";
import type { PageContent, PageTheme } from "./page-kit/types.js";
import type {
  BundleIssue,
  CollectedFile,
  Manifest,
  PageBrief,
  PageBundle,
  ValidationReport,
} from "./types.js";

export const REQUIRED_FILES = ["manifest.json", "page.html", "page.css", "page.js"] as const;
export const CONTENT_REQUIRED_FILES = ["content.json"] as const;

/** content 模式：Pi 只写 content.json，由 page-kit 在构建期渲染。 */
export function isContentMode(brief: PageBrief): boolean {
  return brief.constraints?.content_schema === "2.0" || brief.constraints?.design_system === "2.0";
}

function contentTheme(brief: PageBrief): PageTheme {
  const raw = brief.constraints?.page_theme ?? brief.style?.page_theme ?? "workbench";
  return (PAGE_THEMES as readonly string[]).includes(raw) ? (raw as PageTheme) : "workbench";
}

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
export function checkManifest(
  manifest: unknown,
  expectedPageId: string,
  options: { requireTeaching?: boolean; html?: string } = {},
): BundleIssue[] {
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

  if (
    m.schema_version !== undefined &&
    m.schema_version !== "1.0" &&
    m.schema_version !== "1.1"
  ) {
    issues.push({
      code: "MANIFEST_INVALID",
      message: 'manifest.json 的 schema_version 必须为 "1.0" 或 "1.1"。',
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
  if (options.requireTeaching) {
    issues.push(...checkTeachingManifest(m, options.html));
  }
  return issues;
}

const TEACHING_ROLES = new Set([
  "concept",
  "mechanism",
  "worked_example",
  "practice",
  "compare",
  "summary",
]);

function collectBlockIds(html: string | undefined): Set<string> {
  const ids = new Set<string>();
  if (!html) return ids;
  const regex = /data-mp-block\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(regex)) {
    if (match[1]) ids.add(match[1].trim());
  }
  return ids;
}

/**
 * 教学结构检查（P9）。结构缺失为 error；质量指标留给 Validator 的 teaching 评分。
 * 只校验 manifest 自身与 HTML 的 block 引用，不判断“讲得好不好”。
 */
export function checkTeachingManifest(
  manifest: Record<string, unknown>,
  html?: string,
): BundleIssue[] {
  const issues: BundleIssue[] = [];
  const push = (message: string, code = "TEACHING_INVALID") => {
    issues.push({ code, message, file: "manifest.json" });
  };
  if (manifest.schema_version !== "1.1") {
    push('启用教学页时 manifest.schema_version 必须为 "1.1"。', "TEACHING_SCHEMA_MISMATCH");
  }
  if (manifest.design_system !== "1.0" && manifest.design_system !== "2.0") {
    push('启用教学页时 manifest.design_system 必须为 "1.0" 或 "2.0"。');
  }
  if (manifest.design_system === "2.0") {
    const renderer = manifest.renderer;
    if (!renderer || typeof renderer !== "object" || Array.isArray(renderer)) {
      push('design_system="2.0" 时 manifest.renderer 缺失。', "RENDERER_INVALID");
    } else {
      const record = renderer as Record<string, unknown>;
      if (record.kit !== "page-kit") push('manifest.renderer.kit 必须为 "page-kit"。', "RENDERER_INVALID");
      if (record.version !== "2.0.0") push('manifest.renderer.version 必须为 "2.0.0"。', "RENDERER_INVALID");
      if (!PAGE_THEMES.includes(record.theme as PageTheme)) {
        push(`manifest.renderer.theme 必须为 ${PAGE_THEMES.join(" / ")}。`, "RENDERER_INVALID");
      }
    }
  }
  const teaching = manifest.teaching;
  if (!teaching || typeof teaching !== "object" || Array.isArray(teaching)) {
    push("manifest.teaching 缺失：教学页必须声明角色、目标、讲解链与检查。", "TEACHING_MISSING");
    return issues;
  }
  const t = teaching as Record<string, unknown>;
  if (t.version !== "1.0") push('teaching.version 必须为 "1.0"。');
  if (manifest.design_system === "2.0") {
    if (t.content_version !== "2.0") push('design_system="2.0" 时 teaching.content_version 必须为 "2.0"。');
    if (t.scroll !== "flow" && t.scroll !== "fit") {
      push('design_system="2.0" 时 teaching.scroll 必须为 "flow" 或 "fit"。');
    }
  }
  const role = String(t.role ?? "");
  if (!TEACHING_ROLES.has(role)) {
    push("teaching.role 必须是 concept/mechanism/worked_example/practice/compare/summary 之一。");
  }

  const objectives = Array.isArray(t.objectives) ? t.objectives : [];
  if (objectives.length < 1 || objectives.length > 3) {
    push("teaching.objectives 必须为 1–3 条。");
  } else if (objectives.some((item) => typeof item !== "string" || item.trim() === "")) {
    push("teaching.objectives 每项必须是非空字符串。");
  }

  if (t.prerequisites !== undefined) {
    const prerequisites = Array.isArray(t.prerequisites) ? t.prerequisites : null;
    if (!prerequisites || prerequisites.length > 6) {
      push("teaching.prerequisites 必须是最多 6 条的数组。");
    }
  }
  if (t.hook !== undefined && (typeof t.hook !== "string" || t.hook.length > 300)) {
    push("teaching.hook 必须是 ≤300 字的字符串。");
  }

  const chain = Array.isArray(t.chain) ? t.chain : [];
  if (["concept", "mechanism", "compare"].includes(role)) {
    if (chain.length < 3 || chain.length > 5) {
      push("concept/mechanism/compare 页的 teaching.chain 必须为 3–5 步。");
    }
  }
  const blockIds = collectBlockIds(html);
  const chainIds = new Set<string>();
  for (const [index, step] of chain.entries()) {
    if (!step || typeof step !== "object") {
      push(`teaching.chain[${index}] 必须是对象。`);
      continue;
    }
    const record = step as Record<string, unknown>;
    const id = String(record.id ?? "");
    const blockId = String(record.block_id ?? "");
    if (!id || chainIds.has(id)) push(`teaching.chain[${index}].id 缺失或重复。`);
    chainIds.add(id);
    if (!blockId) {
      push(`teaching.chain[${index}].block_id 缺失。`);
    } else if (html !== undefined && !blockIds.has(blockId)) {
      push(
        `teaching.chain[${index}].block_id（${blockId}）在 page.html 中找不到 data-mp-block。`,
        "TEACHING_BLOCK_MISSING",
      );
    }
    if (typeof record.title !== "string" || record.title.trim() === "") {
      push(`teaching.chain[${index}].title 必须是非空字符串。`);
    }
  }

  if (role === "worked_example") {
    const example = t.worked_example;
    if (!example || typeof example !== "object") {
      push("worked_example 页必须提供 teaching.worked_example（题目、步骤、答案）。");
    } else {
      const record = example as Record<string, unknown>;
      const steps = Array.isArray(record.steps) ? record.steps : [];
      if (typeof record.problem !== "string" || record.problem.trim() === "") {
        push("teaching.worked_example.problem 不能为空。");
      }
      if (steps.length < 3 || steps.length > 5) {
        push("teaching.worked_example.steps 必须为 3–5 步。");
      }
      if (typeof record.answer !== "string" || record.answer.trim() === "") {
        push("teaching.worked_example.answer 不能为空。");
      }
    }
  }

  const checks = Array.isArray(t.check) ? t.check : [];
  if (checks.length > 3) push("teaching.check 最多 3 题。");
  if (role !== "summary" && checks.length < 1) {
    push("除 summary 外，教学页必须至少包含 1 道随堂检查。", "TEACHING_CHECK_MISSING");
  }
  const objectiveCount = objectives.length;
  for (const [index, item] of checks.entries()) {
    if (!item || typeof item !== "object") {
      push(`teaching.check[${index}] 必须是对象。`);
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.question !== "string" || record.question.trim() === "") {
      push(`teaching.check[${index}].question 不能为空。`);
    }
    const options = Array.isArray(record.options) ? record.options : [];
    if (options.length < 2 || options.length > 6) {
      push(`teaching.check[${index}].options 必须为 2–6 项。`);
    }
    const answerIndex = record.answer_index;
    if (
      typeof answerIndex !== "number" ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= options.length
    ) {
      push(`teaching.check[${index}].answer_index 必须落在 options 范围内。`);
    }
    if (typeof record.explanation !== "string" || record.explanation.trim() === "") {
      push(`teaching.check[${index}].explanation 不能为空。`);
    }
    const objectiveId = String(record.objective_id ?? "");
    const match = /^o(\d+)$/.exec(objectiveId);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > objectiveCount) {
      push(
        `teaching.check[${index}].objective_id 必须指向 objectives（o1–o${Math.max(1, objectiveCount)}）。`,
        "TEACHING_OBJECTIVE_MISMATCH",
      );
    }
  }

  if (role === "summary") {
    const summary = t.summary;
    if (!summary || typeof summary !== "object") {
      push("summary 页必须提供 teaching.summary（要点/误区/下一页）。");
    } else {
      const record = summary as Record<string, unknown>;
      const keyPoints = Array.isArray(record.key_points) ? record.key_points : [];
      if (keyPoints.length < 1) push("teaching.summary.key_points 至少 1 条。");
    }
  }
  return issues;
}

export interface CollectOptions {
  buildDir: string;
  brief: PageBrief;
  maxBundleBytes?: number;
  runtimeVersion?: string;
}

function normalizeContentSourceRefs(
  manifest: Record<string, unknown>,
  content: PageContent,
  brief: PageBrief,
): void {
  const refs = Array.isArray(manifest.source_refs) ? manifest.source_refs : [];
  const rawRefs = content.source_refs ?? [];
  const excerpts = brief.source_excerpts ?? [];
  for (const [index, raw] of refs.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const ref = raw as Record<string, unknown>;
    const source = rawRefs[index];
    const heading = String(source?.heading ?? ref.heading ?? "").trim();
    const excerpt =
      (source && typeof source.section_id === "number" && source.section_id > 0
        ? excerpts.find((item) => Number(item.section_id) === source.section_id)
        : undefined) ??
      (heading ? excerpts.find((item) => (item.heading ?? "").trim() === heading) : undefined);
    if (!excerpt) continue;
    if (typeof ref.section_id !== "number" || ref.section_id <= 0) {
      ref.section_id = Number(excerpt.section_id);
    }
    if (typeof ref.material_id !== "number" || ref.material_id <= 0) {
      if (excerpt.material_id !== undefined) ref.material_id = excerpt.material_id;
    }
  }
}

async function collectContentBundle(
  options: CollectOptions,
  maxBundleBytes: number,
  perFileLimit: number,
): Promise<CollectResult> {
  const issues: BundleIssue[] = [];
  const files: CollectedFile[] = [];
  const name = "content.json";
  let text = "";
  try {
    const abs = assertBundleFile(options.buildDir, name, perFileLimit);
    const buffer = await fs.readFile(abs);
    issues.push(...checkUtf8(buffer, name));
    files.push({ name, bytes: buffer.byteLength });
    text = buffer.toString("utf8");
  } catch (error) {
    issues.push(toIssue(error, name));
    return { bundle: null, issues, files, totalBytes: files.reduce((sum, f) => sum + f.bytes, 0) };
  }

  let content: PageContent;
  try {
    content = JSON.parse(text) as PageContent;
  } catch {
    issues.push({
      code: "CONTENT_JSON_INVALID",
      message: "content.json 不是合法 JSON，请检查括号、引号与逗号。",
      file: name,
    });
    return { bundle: null, issues, files, totalBytes: files[0]?.bytes ?? 0 };
  }

  let rendered;
  try {
    const chapterTitle = options.brief.deck_context?.chapter_title;
    if (chapterTitle) {
      const eyebrow = typeof content.eyebrow === "string" ? content.eyebrow : "";
      const chapterLecture = /^第\s*(\d+)\s*讲/.exec(chapterTitle)?.[1];
      const eyebrowLecture = /^第\s*(\d+)\s*讲/.exec(eyebrow)?.[1];
      if (!eyebrow || (chapterLecture && eyebrowLecture && chapterLecture !== eyebrowLecture)) {
        content.eyebrow = chapterTitle;
      }
    }
    rendered = renderPage(content, {
      pageId: options.brief.page_id,
      theme: contentTheme(options.brief),
      knowledgePointIds: options.brief.knowledge_point_ids,
      importance: options.brief.knowledge_point.importance,
      estimatedMinutes: options.brief.estimated_minutes,
    });
  } catch (error) {
    if (error instanceof PageContentError) {
      issues.push(
        ...error.issues.map((issue) => ({
          code: issue.code,
          message: `[${issue.path}] ${issue.message}`,
          file: name,
        })),
      );
      return { bundle: null, issues, files, totalBytes: files[0]?.bytes ?? 0 };
    }
    throw error;
  }

  normalizeContentSourceRefs(rendered.manifest, content, options.brief);
  issues.push(
    ...checkManifest(rendered.manifest, options.brief.page_id, {
      requireTeaching: true,
      html: rendered.html,
    }),
  );
  issues.push(...checkForbiddenSequence(rendered.html, "</script", "page.html", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkForbiddenSequence(rendered.html, "</style", "page.html", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkForbiddenSequence(rendered.html, "<!--", "page.html", "SHELL_ESCAPE_SEQUENCE"));
  issues.push(...checkHtml(rendered.html));

  const bundle: PageBundle = {
    schema_version: "1.1",
    runtime_version: options.runtimeVersion ?? options.brief.constraints?.runtime_version ?? "1.1.0",
    manifest: rendered.manifest as unknown as Manifest,
    html: rendered.html,
    css: rendered.css,
    js: rendered.js,
  };
  const serializedBytes = Buffer.byteLength(JSON.stringify(bundle), "utf8");
  if (serializedBytes > maxBundleBytes) {
    issues.push({
      code: "BUNDLE_TOO_LARGE",
      message: `序列化后的 bundle 为 ${serializedBytes} 字节，超过上限 ${maxBundleBytes} 字节。`,
    });
  }
  if (issues.length > 0) {
    return { bundle: null, issues, files, totalBytes: serializedBytes };
  }
  return { bundle, issues, files, totalBytes: serializedBytes };
}

/**
 * 收集 cwd 下的 4 个页面文件，做路径/大小/扩展名/禁止序列/Manifest 基础检查，
 * 组装 PageBundle。任何问题都通过 issues 返回，不抛异常（便于转成修复提示）。
 */
export async function collectBundle(options: CollectOptions): Promise<CollectResult> {
  const maxBundleBytes = options.maxBundleBytes ?? 2 * 1024 * 1024;
  const perFileLimit = Math.min(maxBundleBytes, MAX_WRITE_BYTES);
  if (isContentMode(options.brief)) {
    return collectContentBundle(options, maxBundleBytes, perFileLimit);
  }
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
      const requireTeaching =
        options.brief.teaching_contract !== undefined ||
        options.brief.constraints?.schema_version === "1.1";
      issues.push(...checkManifest(parsed, options.brief.page_id, { requireTeaching, html }));
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
    schema_version: manifest.schema_version === "1.1" ? "1.1" : "1.0",
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
