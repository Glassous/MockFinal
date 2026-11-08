import fs from "node:fs/promises";
import http from "node:http";
import { pathToFileURL } from "node:url";

import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import { loadConfig, llmConfigured, validatorConfigured, type BuilderConfig } from "./config.js";
import { verifyRequestSignature } from "./hmac.js";
import { isValidBuildId, MemoryTaskStore, type BuildTask, type TaskStore } from "./task-store.js";
import {
  BuildAbortedError,
  closeAllPooledSessions,
  closePooledSession,
  isModelReady,
  pooledSessionCount,
  pruneSessionPool,
  runMockBuild,
  runPiBuild,
  type BuildDeps,
  type LogFn,
} from "./session.js";
import type { CreateBuildRequest, ValidationReport } from "./types.js";
import { ValidatorClient, summarizeValidation } from "./validator-client.js";

export const BUILDER_VERSION = "0.2.0";

const SESSION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" } as const;

interface JsonResponse {
  status: number;
  body: unknown;
}

function json(status: number, body: unknown): JsonResponse {
  return { status, body };
}

function errorResponse(status: number, code: string, detail: string): JsonResponse {
  return json(status, { detail, code });
}

function send(res: http.ServerResponse, response: JsonResponse): void {
  const payload = JSON.stringify(response.body);
  res.writeHead(response.status, {
    ...JSON_HEADERS,
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readRawBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limit) {
      throw Object.assign(new Error("请求体超过上限"), { code: "BODY_TOO_LARGE" });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  return value.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function clampDeadline(requested: unknown, config: BuilderConfig): number {
  const value = typeof requested === "number" && Number.isFinite(requested) ? requested : 0;
  const base = value > 0 ? value : config.defaultDeadlineSeconds;
  return Math.min(Math.max(Math.trunc(base), 30), config.maxDeadlineSeconds);
}

interface QueueEntry {
  buildId: string;
}

class BuildQueue {
  private readonly pending: QueueEntry[] = [];
  private readonly running = new Set<string>();
  private readonly concurrency: number;
  private readonly run: (buildId: string) => Promise<void>;

  constructor(concurrency: number, run: (buildId: string) => Promise<void>) {
    this.concurrency = concurrency;
    this.run = run;
  }

  get stats(): { running: number; pending: number; concurrency: number } {
    return { running: this.running.size, pending: this.pending.length, concurrency: this.concurrency };
  }

  enqueue(buildId: string): void {
    this.pending.push({ buildId });
    this.pump();
  }

  remove(buildId: string): void {
    const index = this.pending.findIndex((entry) => entry.buildId === buildId);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();
      if (!entry) return;
      this.running.add(entry.buildId);
      void this.run(entry.buildId).finally(() => {
        this.running.delete(entry.buildId);
        this.pump();
      });
    }
  }
}

export interface BuilderApp {
  server: http.Server;
  config: BuilderConfig;
  store: TaskStore;
  queue: BuildQueue;
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
}

export interface BuilderAppOptions {
  validator?: ValidatorClient;
  log?: LogFn;
}

function validateCreateRequest(body: unknown): { request: CreateBuildRequest } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "请求体必须是 JSON 对象。" };
  }
  const record = body as Record<string, unknown>;
  if (!isValidBuildId(record.build_id)) {
    return { error: "build_id 缺失或格式不合法（只允许字母、数字、下划线与短横线，长度 1-64）。" };
  }
  const brief = record.page_brief;
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    return { error: "缺少 page_brief 对象。" };
  }
  const briefRecord = brief as Record<string, unknown>;
  if (typeof briefRecord.page_id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(briefRecord.page_id)) {
    return { error: "page_brief.page_id 缺失或格式不合法。" };
  }
  const knowledgePoint = briefRecord.knowledge_point;
  if (!knowledgePoint || typeof knowledgePoint !== "object") {
    return { error: "page_brief.knowledge_point 缺失。" };
  }
  if (
    typeof (knowledgePoint as Record<string, unknown>).title !== "string" ||
    ((knowledgePoint as Record<string, unknown>).title as string).trim() === ""
  ) {
    return { error: "page_brief.knowledge_point.title 不能为空。" };
  }
  const feedback = record.feedback;
  if (feedback !== undefined && feedback !== null) {
    if (typeof feedback !== "string") return { error: "feedback 必须是字符串。" };
    if (feedback.length > 2000) return { error: "feedback 超过 2000 字上限。" };
  }
  let session: CreateBuildRequest["session"];
  if (record.session !== undefined) {
    const rawSession = record.session;
    if (!rawSession || typeof rawSession !== "object" || Array.isArray(rawSession)) {
      return { error: "session 必须是对象。" };
    }
    const sessionRecord = rawSession as Record<string, unknown>;
    if (typeof sessionRecord.key !== "string" || !SESSION_KEY_PATTERN.test(sessionRecord.key)) {
      return { error: "session.key 缺失或格式不合法（字母、数字、下划线、短横线，长度 1-120）。" };
    }
    if (
      sessionRecord.lane !== undefined &&
      (typeof sessionRecord.lane !== "number" ||
        !Number.isInteger(sessionRecord.lane) ||
        sessionRecord.lane < 0)
    ) {
      return { error: "session.lane 必须是非负整数。" };
    }
    if (
      sessionRecord.page_index !== undefined &&
      (typeof sessionRecord.page_index !== "number" ||
        !Number.isInteger(sessionRecord.page_index) ||
        sessionRecord.page_index < 0)
    ) {
      return { error: "session.page_index 必须是非负整数。" };
    }
    if (
      sessionRecord.page_total !== undefined &&
      (typeof sessionRecord.page_total !== "number" ||
        !Number.isInteger(sessionRecord.page_total) ||
        sessionRecord.page_total < 1)
    ) {
      return { error: "session.page_total 必须是正整数。" };
    }
    if (
      typeof sessionRecord.page_index === "number" &&
      typeof sessionRecord.page_total === "number" &&
      sessionRecord.page_index >= sessionRecord.page_total
    ) {
      return { error: "session.page_index 必须小于 page_total。" };
    }
    if (sessionRecord.first !== undefined && typeof sessionRecord.first !== "boolean") {
      return { error: "session.first 必须是布尔值。" };
    }
    session = {
      key: sessionRecord.key,
      lane: sessionRecord.lane as number | undefined,
      page_index: sessionRecord.page_index as number | undefined,
      page_total: sessionRecord.page_total as number | undefined,
      first: sessionRecord.first as boolean | undefined,
    };
  }
  return {
    request: {
      build_id: record.build_id,
      page_brief: brief as CreateBuildRequest["page_brief"],
      session,
      feedback: typeof feedback === "string" ? feedback : null,
      deadline_seconds:
        typeof record.deadline_seconds === "number" ? record.deadline_seconds : undefined,
    },
  };
}

export function createBuilderApp(config: BuilderConfig, options: BuilderAppOptions = {}): BuilderApp {
  if (!config.builderToken) {
    throw new Error(
      "构建服务未配置 BUILDER_TOKEN，已拒绝启动。请在容器环境变量中设置共享密钥后重试。",
    );
  }

  const log: LogFn =
    options.log ??
    ((level, message, fields) => {
      const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
      process.stdout.write(`[builder] ${level} ${message}${suffix}\n`);
    });

  const store = new MemoryTaskStore(config.taskTtlSeconds);
  const validator =
    options.validator ??
    new ValidatorClient({
      url: config.validator.url,
      token: config.validator.token,
      timeoutMs: config.validator.timeoutMs,
    });
  const deps: BuildDeps = { config, validator, log };
  const mode = config.mock.enabled ? "mock" : "pi";

  const cleanupBuildDir = async (task: BuildTask): Promise<void> => {
    if (task.request.session && mode !== "mock") {
      // Deck 会话的页面目录由 SessionPool 统一清理，保留已完成页面供后续参考
      return;
    }
    try {
      await fs.rm(task.buildDir, { recursive: true, force: true });
    } catch {
      log("warn", "清理构建目录失败", { build_id: task.buildId });
    }
  };

  const execute = async (buildId: string): Promise<void> => {
    const task = store.get(buildId);
    if (!task || task.finished) return;
    task.markRunning();
    const deadlineMs = Math.min(task.deadlineSeconds, config.maxDeadlineSeconds) * 1000;
    const timer = setTimeout(() => {
      log("warn", "构建超时，准备取消", { build_id: buildId, deadline_ms: deadlineMs });
      task.abortForTimeout();
    }, deadlineMs);
    timer.unref?.();

    try {
      if (mode === "mock") {
        log("info", "MOCK 模式执行构建（非真实 Pi）", { build_id: buildId });
      }
      const result = mode === "mock" ? await runMockBuild(task, deps) : await runPiBuild(task, deps);
      task.usage = result.usage;
      if (task.finished) {
        // 取消 / 超时已经写入终态，迟到的结果不覆盖状态
        return;
      }
      if (result.ok && result.bundle && result.validation) {
        task.succeed(result.bundle, result.validation);
        log("info", "构建成功", {
          build_id: buildId,
          page_id: task.pageId,
          mode,
          thinking_level: config.llm.thinkingLevel,
          validation: result.validation.status,
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cache_read_tokens: result.usage.cache_read_tokens,
          cache_write_tokens: result.usage.cache_write_tokens,
          cost: result.usage.cost,
          duration_ms: result.usage.duration_ms,
        });
      } else {
        task.fail(result.error ?? "页面构建失败，请稍后重试。", result.code ?? "BUILD_FAILED");
        log("warn", "构建失败", { build_id: buildId, code: result.code ?? "BUILD_FAILED" });
      }
    } catch (error) {
      if (error instanceof BuildAbortedError || task.signal.aborted) {
        if (!task.finished) {
          task.cancel(task.signal.reason instanceof Error && task.signal.reason.message === "timeout" ? "timeout" : "user");
        }
      } else {
        const message =
          error instanceof Error && error.message
            ? `页面构建失败：${error.message}`
            : "页面构建失败，请稍后重试。";
        if (!task.finished) {
          task.fail(message.length > 300 ? `${message.slice(0, 300)}…` : message, "BUILD_ERROR");
        }
        log("error", "构建异常", {
          build_id: buildId,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    } finally {
      clearTimeout(timer);
      await cleanupBuildDir(task);
    }
  };

  const queue = new BuildQueue(config.concurrency, execute);

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://builder.local");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (pathname === "/healthz" && req.method === "GET") {
      send(
        res,
        json(200, {
          status: "ok",
          version: BUILDER_VERSION,
          mode,
          pi_version: PI_VERSION,
          harness_version: config.harnessVersion,
          model_configured: config.mock.enabled ? true : llmConfigured(config),
          validator_configured: validatorConfigured(config),
          session_mode: config.session.mode,
          sessions: pooledSessionCount(),
          queue: queue.stats,
        }),
      );
      return;
    }

    if (!pathname.startsWith("/v1/")) {
      send(res, errorResponse(404, "NOT_FOUND", "接口不存在。"));
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(req, config.maxBodyBytes);
    } catch {
      send(res, errorResponse(413, "BODY_TOO_LARGE", "请求体超过 6 MiB 上限。"));
      return;
    }

    const signature = verifyRequestSignature({
      token: config.builderToken,
      timestamp: req.headers["x-mf-timestamp"] as string | undefined,
      signature: req.headers["x-mf-signature"] as string | undefined,
      method: req.method ?? "",
      path: req.url ?? "",
      rawBody,
    });
    if (!signature.ok) {
      send(res, errorResponse(401, signature.code, signature.detail));
      return;
    }

    if (req.method === "POST" && !isJsonContentType(req.headers["content-type"] as string | undefined)) {
      send(res, errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "只接受 application/json 请求体。"));
      return;
    }

    if (pathname === "/v1/builds" && req.method === "POST") {
      if (mode === "pi" && !llmConfigured(config)) {
        send(
          res,
          errorResponse(
            503,
            "BUILDER_UNAVAILABLE",
            "页面构建服务未配置模型（LLM_BASE_URL / LLM_API_KEY / PAGE_BUILDER_MODEL），请稍后重试或联系管理员。",
          ),
        );
        return;
      }
      if (!validatorConfigured(config)) {
        send(
          res,
          errorResponse(
            503,
            "VALIDATOR_UNAVAILABLE",
            "页面校验服务未配置，构建无法交付（fail-closed），请稍后重试或联系管理员。",
          ),
        );
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        send(res, errorResponse(400, "INVALID_JSON", "请求体不是合法 JSON。"));
        return;
      }
      const validated = validateCreateRequest(parsed);
      if ("error" in validated) {
        send(res, errorResponse(400, "INVALID_REQUEST", validated.error));
        return;
      }
      const request = validated.request;
      const deadlineSeconds = clampDeadline(request.deadline_seconds, config);
      const outcome = store.create({
        request,
        fingerprint: signature.fingerprint,
        buildRoot: config.buildRoot,
        deadlineSeconds,
        harnessVersion: config.harnessVersion,
        runtimeVersion: request.page_brief.constraints?.runtime_version ?? "1.0.0",
      });
      if (outcome.kind === "conflict") {
        send(
          res,
          errorResponse(
            409,
            "BUILD_ID_CONFLICT",
            "该 build_id 已存在且请求内容不同，请使用新的 build_id 重试。",
          ),
        );
        return;
      }
      if (outcome.kind === "existing") {
        send(res, json(200, { build_id: outcome.task.buildId, status: outcome.task.status }));
        return;
      }
      const task = outcome.task;
      task.addEvent("stage", {
        text: `已受理构建请求（${task.pageId}），并发上限 ${config.concurrency}`,
      });
      queue.enqueue(task.buildId);
      log("info", "已受理构建", { build_id: task.buildId, page_id: task.pageId, mode });
      send(res, json(202, { build_id: task.buildId, status: task.status }));
      return;
    }

    const sessionMatch = /^\/v1\/sessions\/([^/]+)$/.exec(pathname);
    if (sessionMatch) {
      if (req.method !== "DELETE") {
        send(res, errorResponse(405, "METHOD_NOT_ALLOWED", "会话清理只支持 DELETE。"));
        return;
      }
      const key = decodeURIComponent(sessionMatch[1] ?? "");
      if (!SESSION_KEY_PATTERN.test(key)) {
        send(res, errorResponse(400, "INVALID_SESSION_KEY", "session key 格式不合法。"));
        return;
      }
      const closed = await closePooledSession(key);
      log("info", "清理 Deck 会话", { session_key: key, closed });
      send(res, json(202, { key, status: closed ? "closed" : "not_found" }));
      return;
    }

    const buildMatch = /^\/v1\/builds\/([^/]+)(\/events|\/bundle|\/cancel)?$/.exec(pathname);
    if (!buildMatch) {
      send(res, errorResponse(404, "NOT_FOUND", "接口不存在。"));
      return;
    }
    const buildId = decodeURIComponent(buildMatch[1] ?? "");
    const action = buildMatch[2] ?? "";
    const task = store.get(buildId);
    if (!task) {
      send(res, errorResponse(404, "BUILD_NOT_FOUND", "构建任务不存在或已过期。"));
      return;
    }

    if (action === "" && req.method === "GET") {
      send(res, json(200, task.snapshot()));
      return;
    }

    if (action === "/events" && req.method === "GET") {
      const afterSeqRaw = url.searchParams.get("after_seq") ?? "0";
      const afterSeq = Number.parseInt(afterSeqRaw, 10);
      if (!Number.isFinite(afterSeq) || afterSeq < 0) {
        send(res, errorResponse(400, "INVALID_QUERY", "after_seq 必须是非负整数。"));
        return;
      }
      const { events, nextSeq } = task.events.listAfter(afterSeq);
      send(res, json(200, { events, next_seq: nextSeq, finished: task.finished }));
      return;
    }

    if (action === "/bundle" && req.method === "GET") {
      if (task.status !== "succeeded" || !task.bundle) {
        send(
          res,
          errorResponse(409, "BUILD_NOT_READY", "构建尚未成功，暂无可交付的 bundle。"),
        );
        return;
      }
      send(
        res,
        json(200, {
          build_id: task.buildId,
          bundle: task.bundle,
          validation: summarizeValidation(task.validation),
        }),
      );
      return;
    }

    if (action === "/cancel" && req.method === "POST") {
      if (!task.finished) {
        queue.remove(task.buildId);
        task.cancel("user");
        task.abortForCancel();
        await cleanupBuildDir(task);
        log("info", "构建已取消", { build_id: task.buildId });
      }
      send(res, json(202, task.snapshot()));
      return;
    }

    send(res, errorResponse(405, "METHOD_NOT_ALLOWED", "不支持的请求方法。"));
  };

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      log("error", "请求处理异常", {
        error: error instanceof Error ? error.name : "unknown",
      });
      if (!res.headersSent) {
        send(res, errorResponse(500, "INTERNAL_ERROR", "构建服务内部错误，请稍后重试。"));
      } else {
        res.end();
      }
    });
  });

  const pruneTimer = setInterval(() => {
    const removed = store.prune();
    if (removed > 0) log("debug", "清理过期构建任务", { removed });
    void pruneSessionPool(config.session.ttlSeconds)
      .then((closed) => {
        if (closed > 0) log("debug", "清理空闲 Deck 会话", { closed });
      })
      .catch((error: unknown) => {
        log("warn", "清理 Deck 会话失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, 60_000);
  pruneTimer.unref?.();

  return {
    server,
    config,
    store,
    queue,
    start: async () => {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : config.port;
      return { port };
    },
    stop: async () => {
      clearInterval(pruneTimer);
      await closeAllPooledSessions();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const mode = config.mock.enabled ? "mock" : "pi";
  let app: BuilderApp;
  try {
    app = createBuilderApp(config);
  } catch (error) {
    process.stderr.write(
      `[builder] 启动失败：${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (mode === "mock") {
    process.stdout.write(
      "[builder] ============================================================\n" +
        "[builder] MOCK 模式，非真实 Pi 构建（PAGE_BUILDER_MOCK=1）\n" +
        "[builder] 仅用于开发联调，不能作为 P2 门禁通过证据。\n" +
        "[builder] ============================================================\n",
    );
    if (!config.mock.bundlePath) {
      process.stdout.write(
        "[builder] MOCK 未设置 PAGE_BUILDER_MOCK_BUNDLE，将按 fixtures/golden/{page_id}/bundle.json 查找预置 bundle。\n",
      );
    }
  } else {
    const modelReady = await isModelReady(config);
    if (!modelReady) {
      process.stdout.write(
        "[builder] 警告：模型未配置或凭据不可用（LLM_BASE_URL / LLM_API_KEY / PAGE_BUILDER_MODEL）。" +
          "服务仍会启动，但构建请求将返回 503 中文错误；这是预期行为，不会伪造构建成功。\n",
      );
    }
    if (!validatorConfigured(config)) {
      process.stdout.write(
        "[builder] 警告：PAGE_VALIDATOR_URL / PAGE_VALIDATOR_TOKEN 未配置，构建将 fail-closed 并返回 503。\n",
      );
    }
  }

  const { port } = await app.start();
  process.stdout.write(
    `[builder] 监听 ${config.host}:${port}（mode=${mode}，并发 ${config.concurrency}，Pi ${PI_VERSION}）\n`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`[builder] 收到 ${signal}，准备退出\n`);
    await app.stop();
    for (const task of app.store.list()) {
      if (!task.finished) task.cancel("user");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry === import.meta.url) {
  void main();
}

export type { ValidationReport };
