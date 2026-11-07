import fs from "node:fs";
import path from "node:path";

/** 路径守卫错误；code 会写入构建事件，message 为中文可行动文案。 */
export class GuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GuardError";
    this.code = code;
  }
}

/** 允许 Pi 写入的扩展名（页面产物只有 4 个文件）。 */
export const WRITE_EXTENSIONS = new Set([".json", ".html", ".css", ".js"]);

/** read 允许的只读扩展名（harness 里还有 SKILL.md 等 Markdown）。 */
export const READ_EXTENSIONS = new Set([
  ".json",
  ".html",
  ".css",
  ".js",
  ".md",
  ".txt",
  ".mjs",
  ".svg",
]);

export const MAX_WRITE_BYTES = 2 * 1024 * 1024;
export const MAX_READ_BYTES = 4 * 1024 * 1024;

function canonicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/** 判断 abs 是否位于 root 内（含 root 本身）。 */
export function isInside(root: string, abs: string): boolean {
  const relative = path.relative(canonicalRoot(root), path.resolve(abs));
  if (relative === "") return true;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return true;
}

/**
 * 把 target 解析到 root 内并返回绝对路径；越界时抛 PATH_OUTSIDE_ROOT。
 * target 可以为相对路径（相对 root）或绝对路径。
 */
export function resolveWithin(root: string, target: string): string {
  if (typeof target !== "string" || target.trim() === "") {
    throw new GuardError("PATH_EMPTY", "文件路径不能为空。");
  }
  if (target.includes("\0")) {
    throw new GuardError("PATH_INVALID", "文件路径包含非法字符。");
  }
  const base = path.resolve(root);
  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(base, target);
  if (!isInside(base, abs)) {
    throw new GuardError(
      "PATH_OUTSIDE_ROOT",
      `拒绝访问构建目录之外的路径：${target}。只允许在本次构建工作目录内写入，或读取只读 Harness 资源。`,
    );
  }
  return abs;
}

/**
 * 逐段检查路径上已存在的组件，禁止符号链接与非常规文件。
 * 不存在的组件跳过（新建文件允许）。
 */
export function assertNoSymlinkComponents(root: string, abs: string): void {
  const base = path.resolve(root);
  const relative = path.relative(base, path.resolve(abs));
  let current = base;
  for (const segment of relative.split(path.sep)) {
    if (segment === "" || segment === ".") continue;
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      throw new GuardError(
        "PATH_SYMLINK",
        `拒绝访问符号链接路径：${path.relative(base, current)}。请直接使用构建目录内的真实文件。`,
      );
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      throw new GuardError(
        "PATH_NOT_REGULAR",
        `拒绝访问非常规文件：${path.relative(base, current)}。`,
      );
    }
  }
}

export function assertExtension(abs: string, allowed: Set<string>): void {
  const ext = path.extname(abs).toLowerCase();
  if (!allowed.has(ext)) {
    throw new GuardError(
      "PATH_EXTENSION",
      `不允许的文件类型：${ext || "(无扩展名)"}。只允许 ${[...allowed].join(" / ")}。`,
    );
  }
}

export function assertSize(bytes: number, maxBytes: number, label: string): void {
  if (bytes > maxBytes) {
    throw new GuardError(
      "FILE_TOO_LARGE",
      `${label} 大小为 ${bytes} 字节，超过上限 ${maxBytes} 字节。请压缩内容或拆分页面。`,
    );
  }
}

export interface WriteGuardOptions {
  buildDir: string;
  target: string;
  content?: string;
  maxFileBytes?: number;
}

/** write / edit 的路径与体积守卫；返回解析后的绝对路径。 */
export function guardWritePath(options: WriteGuardOptions): string {
  const { buildDir, target } = options;
  const abs = resolveWithin(buildDir, target);
  assertNoSymlinkComponents(buildDir, abs);
  assertExtension(abs, WRITE_EXTENSIONS);
  if (typeof options.content === "string") {
    const bytes = Buffer.byteLength(options.content, "utf8");
    assertSize(bytes, options.maxFileBytes ?? MAX_WRITE_BYTES, `文件 ${path.basename(abs)}`);
  }
  return abs;
}

export interface ReadGuardOptions {
  buildDir: string;
  harnessDir: string;
  target: string;
  maxFileBytes?: number;
}

/** read 只允许构建目录与只读 Harness 目录；返回解析后的绝对路径。 */
export function guardReadPath(options: ReadGuardOptions): string {
  const { buildDir, harnessDir, target } = options;
  const candidate = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(buildDir, target);
  const inBuild = isInside(buildDir, candidate);
  const inHarness = isInside(harnessDir, candidate);
  if (!inBuild && !inHarness) {
    throw new GuardError(
      "PATH_OUTSIDE_ROOT",
      `拒绝读取构建目录与 Harness 之外的路径：${target}。`,
    );
  }
  const root = inBuild ? buildDir : harnessDir;
  assertNoSymlinkComponents(root, candidate);
  assertExtension(candidate, READ_EXTENSIONS);
  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isFile()) {
      assertSize(stat.size, options.maxFileBytes ?? MAX_READ_BYTES, `文件 ${path.basename(candidate)}`);
    }
  } catch (error) {
    if (error instanceof GuardError) throw error;
    // 文件不存在时交给 read 工具自行报错
  }
  return candidate;
}

/** 供 bundle 收集使用：确保文件名固定、非符号链接、大小受限。 */
export function assertBundleFile(buildDir: string, name: string, maxBytes: number): string {
  const abs = resolveWithin(buildDir, name);
  assertNoSymlinkComponents(buildDir, abs);
  assertExtension(abs, WRITE_EXTENSIONS);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    throw new GuardError("BUNDLE_FILE_MISSING", `缺少必需文件：${name}。`);
  }
  if (!stat.isFile()) {
    throw new GuardError("BUNDLE_FILE_INVALID", `${name} 不是普通文件。`);
  }
  assertSize(stat.size, maxBytes, `文件 ${name}`);
  return abs;
}
