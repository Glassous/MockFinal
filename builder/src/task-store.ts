import path from "node:path";

import { EventLog } from "./events.js";
import type {
  BuildEvent,
  BuildEventType,
  BuildSnapshot,
  BuildStatus,
  BuildUsage,
  CreateBuildRequest,
  PageBundle,
  ValidationReport,
} from "./types.js";

export type CancelReason = "user" | "timeout" | null;

const BUILD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidBuildId(value: unknown): value is string {
  return typeof value === "string" && BUILD_ID_PATTERN.test(value);
}

export interface CreateTaskInput {
  request: CreateBuildRequest;
  fingerprint: string;
  buildRoot: string;
  deadlineSeconds: number;
  harnessVersion: string;
  runtimeVersion: string;
}

/**
 * 单个构建任务的进程内状态。
 * 只通过方法修改，快照是只读拷贝，便于将来替换为持久化实现。
 */
export class BuildTask {
  readonly buildId: string;
  readonly request: CreateBuildRequest;
  readonly fingerprint: string;
  readonly buildDir: string;
  readonly deadlineSeconds: number;
  readonly harnessVersion: string;
  readonly runtimeVersion: string;
  readonly createdAt = new Date().toISOString();
  readonly events = new EventLog();

  status: BuildStatus = "queued";
  stage = "已进入构建队列，等待执行";
  attempts = 0;
  error: string | null = null;
  usage: BuildUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost: 0,
    duration_ms: 0,
  };
  validation: ValidationReport | null = null;
  bundle: PageBundle | null = null;
  startedAt: string | null = null;
  finishedAt: string | null = null;
  cancelReason: CancelReason = null;
  fileList: string[] = [];

  private readonly controller = new AbortController();

  constructor(input: CreateTaskInput) {
    this.buildId = input.request.build_id;
    this.request = input.request;
    this.fingerprint = input.fingerprint;
    this.deadlineSeconds = input.deadlineSeconds;
    this.harnessVersion = input.harnessVersion;
    this.runtimeVersion = input.runtimeVersion;
    const sessionKey = input.request.session?.key;
    this.buildDir = sessionKey
      ? path.join(
          input.buildRoot,
          "sessions",
          sessionKey,
          "pages",
          input.request.page_brief.page_id,
        )
      : path.join(input.buildRoot, this.buildId);
  }

  get pageId(): string {
    return this.request.page_brief.page_id;
  }

  get sessionKey(): string | undefined {
    return this.request.session?.key;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get finished(): boolean {
    return (
      this.status === "succeeded" ||
      this.status === "failed" ||
      this.status === "canceled"
    );
  }

  snapshot(): BuildSnapshot {
    return {
      build_id: this.buildId,
      status: this.status,
      stage: this.stage,
      attempts: this.attempts,
      error: this.error,
      events_cursor: this.events.cursor,
      usage: { ...this.usage },
      validation: this.validation,
      harness_version: this.harnessVersion,
      runtime_version: this.runtimeVersion,
      created_at: this.createdAt,
      started_at: this.startedAt,
      finished_at: this.finishedAt,
      page_id: this.pageId,
      ...(this.sessionKey
        ? { session_key: this.sessionKey, lane: this.request.session?.lane }
        : {}),
    };
  }

  addEvent(type: BuildEventType, payload: Record<string, unknown> = {}): BuildEvent | undefined {
    return this.events.add(type, payload);
  }

  setStage(stage: string): void {
    if (this.finished) return;
    this.stage = stage;
    this.addEvent("stage", { text: stage });
  }

  setStatus(status: BuildStatus): void {
    if (this.finished && status !== "canceled") return;
    this.status = status;
    if (status === "running" && !this.startedAt) {
      this.startedAt = new Date().toISOString();
    }
  }

  markRunning(): void {
    if (this.finished) return;
    this.attempts = Math.max(1, this.attempts);
    this.startedAt = this.startedAt ?? new Date().toISOString();
    this.setStatus("running");
  }

  succeed(bundle: PageBundle, validation: ValidationReport): void {
    if (this.finished) return;
    this.bundle = bundle;
    this.validation = validation;
    this.status = "succeeded";
    this.stage = "页面构建完成，已通过 Builder 侧最终校验";
    this.finishedAt = new Date().toISOString();
    this.addEvent("page_done", {
      text: "页面构建完成，已通过校验并生成 bundle。",
      files: this.fileList,
      validation_status: validation.status,
    });
  }

  fail(message: string, code?: string): void {
    if (this.finished) return;
    this.status = "failed";
    this.error = message;
    this.stage = "构建失败";
    this.finishedAt = new Date().toISOString();
    this.addEvent("error", code ? { text: message, code } : { text: message });
  }

  cancel(reason: Exclude<CancelReason, null> = "user"): void {
    if (this.finished) return;
    this.cancelReason = reason;
    this.status = "canceled";
    this.stage = reason === "timeout" ? "构建超时，已取消" : "构建已取消";
    this.error =
      reason === "timeout"
        ? `页面构建超时（超过 ${this.deadlineSeconds} 秒），请稍后重试或拆分知识点。`
        : "构建已取消，未交付任何产物。";
    this.finishedAt = new Date().toISOString();
    this.addEvent("error", { text: this.error, code: "BUILD_CANCELED" });
    this.controller.abort();
  }

  abortForTimeout(): void {
    if (this.finished) return;
    this.controller.abort(new Error("timeout"));
  }

  abortForCancel(): void {
    this.controller.abort(new Error("canceled"));
  }
}

export type CreateOutcome =
  | { kind: "created"; task: BuildTask }
  | { kind: "existing"; task: BuildTask }
  | { kind: "conflict"; task: BuildTask };

/**
 * 任务表接口。MVP 为进程内实现；换成持久化只需实现同一组方法，
 * 事件与状态仍通过 BuildTask 方法写入。
 */
export interface TaskStore {
  get(buildId: string): BuildTask | undefined;
  create(input: CreateTaskInput): CreateOutcome;
  delete(buildId: string): void;
  prune(now?: number): number;
  list(): BuildTask[];
}

export class MemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, BuildTask>();
  private readonly ttlSeconds: number;

  constructor(ttlSeconds: number) {
    this.ttlSeconds = ttlSeconds;
  }

  get(buildId: string): BuildTask | undefined {
    return this.tasks.get(buildId);
  }

  create(input: CreateTaskInput): CreateOutcome {
    const existing = this.tasks.get(input.request.build_id);
    if (existing) {
      if (existing.fingerprint === input.fingerprint) {
        return { kind: "existing", task: existing };
      }
      return { kind: "conflict", task: existing };
    }
    const task = new BuildTask(input);
    this.tasks.set(task.buildId, task);
    return { kind: "created", task };
  }

  delete(buildId: string): void {
    this.tasks.delete(buildId);
  }

  list(): BuildTask[] {
    return [...this.tasks.values()];
  }

  prune(now: number = Date.now()): number {
    let removed = 0;
    for (const [buildId, task] of this.tasks) {
      if (!task.finished) continue;
      const finishedAt = task.finishedAt ? Date.parse(task.finishedAt) : Date.parse(task.createdAt);
      if (Number.isFinite(finishedAt) && now - finishedAt > this.ttlSeconds * 1000) {
        this.tasks.delete(buildId);
        removed += 1;
      }
    }
    return removed;
  }
}
