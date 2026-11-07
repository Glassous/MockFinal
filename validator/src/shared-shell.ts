/**
 * 共享 shell / runtime 的加载器（PAGE_CONTRACT §7.2、§12.3）
 *
 * Validator 不复制 shell.mjs 与 runtime.js，运行时从仓库 `shared/` 读取同一份源码，
 * 避免「校验通过、真实渲染漂移」。镜像内通过 `PAGE_SHARED_DIR` 指向 /app/shared。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface ShellInput {
  bundle: unknown;
  runtimeSource: string;
  channel: string;
  theme?: 'light' | 'dark';
}

export interface ShellModule {
  buildShell(input: ShellInput): string;
  escapeForScript(source: string): string;
  escapeForStyle(source: string): string;
  SUPPORTED_RUNTIME_VERSION: string;
  MAX_BUNDLE_BYTES: number;
  CSP_CONTENT: string;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

function candidates(): string[] {
  const list: string[] = [];
  if (process.env.PAGE_SHARED_DIR) list.push(process.env.PAGE_SHARED_DIR);
  list.push(join(moduleDir, '..', '..', 'shared'));
  list.push(join(process.cwd(), 'shared'));
  list.push(join(process.cwd(), '..', 'shared'));
  return list;
}

/** 定位仓库 shared/ 目录；找不到时抛出中文错误（服务启动失败而不是静默降级）。 */
export function sharedRoot(): string {
  for (const candidate of candidates()) {
    if (existsSync(join(candidate, 'page-shell', 'shell.mjs'))) return candidate;
  }
  throw new Error(
    `未找到 shared/ 目录（尝试过：${candidates().join('、')}）；请设置 PAGE_SHARED_DIR 指向仓库 shared 目录`
  );
}

let shellModule: ShellModule | null = null;

/** 动态加载 shared/page-shell/shell.mjs（同一份源码，Node 与前端共用）。 */
export async function loadShellModule(): Promise<ShellModule> {
  if (shellModule) return shellModule;
  const url = pathToFileURL(join(sharedRoot(), 'page-shell', 'shell.mjs')).href;
  const loaded = (await import(url)) as unknown as ShellModule;
  shellModule = loaded;
  return loaded;
}

/** 读取 shared/page-runtime/runtime.js。 */
export function loadRuntimeSource(): string {
  return readFileSync(join(sharedRoot(), 'page-runtime', 'runtime.js'), 'utf8');
}
