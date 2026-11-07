/**
 * Validator 内部 HTTP 服务（docs/pageref/INTERNAL_API.md §4）
 *
 * - POST /v1/validate：静态检查 + Playwright 浏览器检查，返回结构化报告；
 * - GET  /healthz：健康检查（无需鉴权）；
 * - 鉴权：Authorization: Bearer <VALIDATOR_TOKEN>，常量时间比较；
 * - 请求体上限 6 MiB；所有异常返回结构化中文错误，不返回堆栈。
 *
 * 服务只监听容器内部端口 9200；compose 不映射宿主端口。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { browserCheck, BrowserUnavailableError } from './browser-check.js';
import { staticCheck } from './static-check.js';
import { loadShellModule } from './shared-shell.js';
import {
  DEFAULT_VIEWPORTS,
  MAX_REQUEST_BYTES,
  RUNTIME_VERSION,
  statusOf,
  type Bundle,
  type Issue,
  type Report,
  type Screenshot,
  type Viewport
} from './types.js';

const VALIDATOR_API_VERSION = '0.1.0';
const PORT = 9200;
const HOST = '0.0.0.0';
const MAX_VIEWPORTS = 6;
const MIN_VIEWPORT_EDGE = 320;
const MAX_VIEWPORT_EDGE = 4096;

interface ApiError {
  status: number;
  code: string;
  detail: string;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  response.end(payload);
}

function sendError(response: ServerResponse, error: ApiError): void {
  sendJson(response, error.status, { detail: error.detail, code: error.code });
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    // 长度不同也做一次比较，避免用长度差异泄露信息
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new HttpError(413, 'REQUEST_TOO_LARGE', `请求体超过 ${MAX_REQUEST_BYTES} 字节上限`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', (error) => reject(error));
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 阅读器实际内容视口：1280×720 窗口减去 56px 头部、24px 内边距与 1px 边框 ×2。
 * 页面在更小的内容区里也必须零滚动，否则生产环境会静默裁掉内容。
 */
const READER_VIEWPORTS: readonly Viewport[] = Object.freeze([
  Object.freeze({ width: 1254, height: 638 }),
  Object.freeze({ width: 1414, height: 818 }),
  Object.freeze({ width: 1894, height: 998 })
]);

function parseViewports(raw: unknown): Viewport[] {
  if (raw !== undefined && (!Array.isArray(raw) || raw.length === 0)) {
    throw new HttpError(400, 'INVALID_VIEWPORTS', 'viewports 必须是非空数组，元素形如 {"width":1280,"height":720}');
  }
  if (raw !== undefined && (raw as unknown[]).length > MAX_VIEWPORTS) {
    throw new HttpError(400, 'INVALID_VIEWPORTS', `viewports 最多 ${MAX_VIEWPORTS} 项`);
  }
  const requested = (raw === undefined ? [] : (raw as unknown[])).map((item, index) => {
    if (!isPlainObject(item)) {
      throw new HttpError(400, 'INVALID_VIEWPORTS', `viewports[${index}] 必须是对象`);
    }
    const width = item.width;
    const height = item.height;
    const valid = (value: unknown): value is number =>
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= MIN_VIEWPORT_EDGE &&
      value <= MAX_VIEWPORT_EDGE;
    if (!valid(width) || !valid(height)) {
      throw new HttpError(
        400,
        'INVALID_VIEWPORTS',
        `viewports[${index}] 的宽高必须是 ${MIN_VIEWPORT_EDGE}–${MAX_VIEWPORT_EDGE} 的整数`
      );
    }
    return { width, height };
  });

  // 硬门禁视口不能由调用方移除：始终与请求视口取并集
  const merged: Viewport[] = [...requested];
  for (const viewport of [...DEFAULT_VIEWPORTS, ...READER_VIEWPORTS]) {
    if (!merged.some((item) => item.width === viewport.width && item.height === viewport.height)) {
      merged.push({ ...viewport });
    }
  }
  return merged;
}

interface ValidateOutcome {
  report: Report;
  bundle: Bundle | null;
}

const VALIDATION_TIMEOUT_MS = 300_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HttpError(504, 'VALIDATION_TIMEOUT', '页面校验超时，请稍后重试')),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function validate(rawBody: unknown): Promise<ValidateOutcome> {
  if (!isPlainObject(rawBody)) {
    throw new HttpError(400, 'INVALID_REQUEST', '请求体必须是 JSON 对象');
  }
  if (!('bundle' in rawBody)) {
    throw new HttpError(400, 'INVALID_REQUEST', '请求体缺少 bundle 字段');
  }
  const viewports = parseViewports(rawBody.viewports);
  if (rawBody.screenshot !== undefined && typeof rawBody.screenshot !== 'boolean') {
    throw new HttpError(400, 'INVALID_REQUEST', 'screenshot 必须是布尔值');
  }
  const wantScreenshot = rawBody.screenshot !== false;

  const started = Date.now();
  const staticResult = staticCheck(rawBody.bundle);
  const issues: Issue[] = [...staticResult.issues];
  const screenshots: Screenshot[] = [];

  if (staticResult.bundle) {
    const browserResult = await withTimeout(
      browserCheck({
        bundle: staticResult.bundle,
        viewports,
        screenshot: wantScreenshot
      }),
      VALIDATION_TIMEOUT_MS
    );
    issues.push(...browserResult.issues);
    screenshots.push(...browserResult.screenshots);
  }

  return {
    report: {
      status: statusOf(issues),
      issues,
      screenshots,
      duration_ms: Date.now() - started
    },
    bundle: staticResult.bundle
  };
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice('Bearer '.length).trim(), token);
}

async function handle(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
  const url = request.url ?? '/';
  const path = url.split('?')[0] ?? '/';
  const method = request.method ?? 'GET';

  if (path === '/healthz') {
    if (method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', '健康检查只支持 GET');
    }
    sendJson(response, 200, { status: 'ok', version: VALIDATOR_API_VERSION, runtime_version: RUNTIME_VERSION });
    return;
  }

  if (path !== '/v1/validate') {
    throw new HttpError(404, 'NOT_FOUND', '接口不存在');
  }
  if (method !== 'POST') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', '校验接口只支持 POST');
  }
  if (!authorized(request, token)) {
    throw new HttpError(401, 'UNAUTHORIZED', '未授权：缺少或错误的 Bearer token');
  }
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '只接受 application/json 请求体');
  }

  const raw = await readBody(request);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体不是合法 JSON');
  }

  const { report } = await validate(parsed);
  sendJson(response, 200, report);
}

async function main(): Promise<void> {
  const token = process.env.VALIDATOR_TOKEN ?? '';
  if (token.trim() === '') {
    process.stderr.write('启动失败：未设置 VALIDATOR_TOKEN，Validator 不提供默认密钥\n');
    process.exit(1);
  }
  // 启动即校验 shared/ 可访问与 runtime 版本一致，避免请求期才发现配置问题
  const shellModule = await loadShellModule();
  if (shellModule.SUPPORTED_RUNTIME_VERSION !== RUNTIME_VERSION) {
    process.stderr.write(
      `启动失败：shared shell 声明 runtime ${shellModule.SUPPORTED_RUNTIME_VERSION}，Validator 期望 ${RUNTIME_VERSION}\n`
    );
    process.exit(1);
  }

  const server = createServer((request, response) => {
    handle(request, response, token).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendError(response, { status: error.status, code: error.code, detail: error.message });
        return;
      }
      if (error instanceof BrowserUnavailableError) {
        process.stderr.write(`浏览器不可用：${error.message}\n`);
        sendError(response, {
          status: 503,
          code: 'BROWSER_UNAVAILABLE',
          detail: '校验服务暂时不可用：浏览器环境无法启动，请稍后重试'
        });
        return;
      }
      process.stderr.write(
        `校验请求处理失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
      );
      if (!response.headersSent) {
        sendError(response, {
          status: 500,
          code: 'INTERNAL_ERROR',
          detail: '校验服务内部错误，请稍后重试'
        });
      } else {
        response.end();
      }
    });
  });

  server.listen(PORT, HOST, () => {
    process.stdout.write(
      `Validator 已启动：http://${HOST}:${PORT}（api ${VALIDATOR_API_VERSION}，runtime ${RUNTIME_VERSION}）\n`
    );
  });
}

void main();
