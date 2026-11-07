import type { PageBundle, PageConstraints, ValidationReport, Viewport } from "./types.js";

export class ValidatorUnavailableError extends Error {
  readonly code: string;

  constructor(message: string, code = "VALIDATOR_UNAVAILABLE") {
    super(message);
    this.name = "ValidatorUnavailableError";
    this.code = code;
  }
}

export interface ValidatorClientOptions {
  url: string;
  token: string;
  timeoutMs: number;
}

const DEFAULT_VIEWPORTS: Viewport[] = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** 从 brief constraints.viewport（"1280x720"）解析视口；非法值回落到默认三档。 */
export function viewportsFromConstraints(constraints?: PageConstraints): Viewport[] {
  const raw = constraints?.viewport;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_VIEWPORTS;
  const parsed: Viewport[] = [];
  for (const entry of raw) {
    const match = /^(\d{3,5})\s*[xX×]\s*(\d{3,5})$/.exec(String(entry).trim());
    if (match) {
      parsed.push({ width: Number(match[1]), height: Number(match[2]) });
    }
  }
  return parsed.length > 0 ? parsed : DEFAULT_VIEWPORTS;
}

function isValidationReport(value: unknown): value is ValidationReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Record<string, unknown>;
  if (!["passed", "warning", "failed"].includes(String(report.status))) return false;
  if (!Array.isArray(report.issues)) return false;
  return report.issues.every((issue) => {
    if (!issue || typeof issue !== "object") return false;
    const item = issue as Record<string, unknown>;
    return typeof item.code === "string" && typeof item.message === "string";
  });
}

/**
 * Page Validator 客户端：POST /v1/validate，Bearer token。
 * 任何网络/协议错误都抛 ValidatorUnavailableError —— 调用方必须 fail-closed，
 * 不允许降级为「跳过校验」。
 */
export class ValidatorClient {
  private readonly options: ValidatorClientOptions;

  constructor(options: ValidatorClientOptions) {
    this.options = options;
  }

  get configured(): boolean {
    return Boolean(this.options.url && this.options.token);
  }

  async validate(
    bundle: PageBundle,
    options: {
      viewports?: Viewport[];
      screenshot?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<ValidationReport> {
    if (!this.configured) {
      throw new ValidatorUnavailableError(
        "页面校验服务未配置，构建无法交付。请联系管理员配置 PAGE_VALIDATOR_URL 与 PAGE_VALIDATOR_TOKEN。",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const outer = options.signal;
    const onOuterAbort = (): void => controller.abort();
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", onOuterAbort, { once: true });
    }

    try {
      const response = await fetch(`${this.options.url}/v1/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.token}`,
        },
        body: JSON.stringify({
          bundle,
          viewports: options.viewports ?? DEFAULT_VIEWPORTS,
          screenshot: options.screenshot ?? false,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new ValidatorUnavailableError(
          `页面校验服务返回错误（HTTP ${response.status}），本次构建不交付，请稍后重试。`,
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ValidatorUnavailableError("页面校验服务返回了非法 JSON，本次构建不交付。");
      }
      if (!isValidationReport(payload)) {
        throw new ValidatorUnavailableError("页面校验服务返回的报告结构不符合契约，本次构建不交付。");
      }
      return payload;
    } catch (error) {
      if (error instanceof ValidatorUnavailableError) throw error;
      if (outer?.aborted) {
        throw new ValidatorUnavailableError(
          "构建已取消或超时，页面校验被中断，未交付任何产物。",
          "VALIDATION_ABORTED",
        );
      }
      const isTimeout = controller.signal.aborted && !outer?.aborted;
      throw new ValidatorUnavailableError(
        isTimeout
          ? "页面校验服务响应超时，本次构建不交付，请稍后重试。"
          : "无法连接页面校验服务，本次构建不交付（fail-closed，不会跳过校验）。",
      );
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }
}

/** 报告摘要，用于 GET /bundle 与任务快照。 */
export function summarizeValidation(report: ValidationReport | null): {
  status: string;
  issues: ValidationReport["issues"];
} {
  if (!report) return { status: "none", issues: [] };
  return { status: report.status, issues: report.issues };
}
