import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** builder 目录（dist/ 的上级）；用于定位 pi-harness 与 fixtures 默认路径。 */
export const BUILDER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

function envString(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function envNumber(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(env: Env, name: string): boolean {
  const raw = env[name];
  return raw === "1" || raw === "true" || raw === "yes";
}

export type BuilderThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type BuilderPromptProfile = "zh" | "compact";

const THINKING_LEVELS: readonly BuilderThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function envThinkingLevel(env: Env, name: string, fallback: BuilderThinkingLevel): BuilderThinkingLevel {
  const raw = env[name]?.trim().toLowerCase() as BuilderThinkingLevel | undefined;
  return raw && THINKING_LEVELS.includes(raw) ? raw : fallback;
}

export interface BuilderConfig {
  host: string;
  port: number;
  builderToken: string;
  maxBodyBytes: number;
  /** 每次构建默认 / 最大超时（秒）。 */
  defaultDeadlineSeconds: number;
  maxDeadlineSeconds: number;
  concurrency: number;
  buildRoot: string;
  taskTtlSeconds: number;
  harnessVersion: string;
  maxBundleBytes: number;
  agentDir: string;
  harnessDir: string;
  session: {
    mode: "page" | "deck";
    pagesPerLane: number;
    contextRatio: number;
    ttlSeconds: number;
  };
  validator: {
    url: string;
    token: string;
    timeoutMs: number;
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    thinkingLevel: BuilderThinkingLevel;
    /** 网关模型是否声明支持 reasoning/thinking；默认 false（兼容不支持该参数的网关）。 */
    reasoning: boolean;
    /** zh：中文提示词；compact：紧凑英文技术规则 + 中文内容。 */
    promptProfile: BuilderPromptProfile;
    /** 每 1M token 单价；用于 BuildUsage.cost 估算，0 表示不计价。 */
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  };
  mock: {
    enabled: boolean;
    bundlePath: string | null;
  };
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: Env = process.env): BuilderConfig {
  const agentDir = path.resolve(
    envString(env, "PI_CODING_AGENT_DIR", path.join(BUILDER_ROOT, "pi-harness", "agent")),
  );
  const harnessDir = path.resolve(
    envString(
      env,
      "PI_HARNESS_DIR",
      path.basename(agentDir) === "agent" ? path.dirname(agentDir) : agentDir,
    ),
  );
  const mockBundle = env.PAGE_BUILDER_MOCK_BUNDLE?.trim();
  return {
    host: envString(env, "BUILDER_HOST", "0.0.0.0"),
    port: Number(envString(env, "PORT", "9100")),
    builderToken: envString(env, "BUILDER_TOKEN", ""),
    maxBodyBytes: envNumber(env, "BUILDER_MAX_BODY_BYTES", 6 * 1024 * 1024),
    defaultDeadlineSeconds: envNumber(env, "PAGE_BUILDER_TIMEOUT_SECONDS", 480),
    maxDeadlineSeconds: envNumber(env, "BUILDER_MAX_DEADLINE_SECONDS", 900),
    concurrency: Math.max(1, Math.trunc(envNumber(env, "PAGE_BUILDER_CONCURRENCY", 2))),
    buildRoot: path.resolve(
      envString(env, "BUILDER_BUILD_ROOT", path.join(os.tmpdir(), "mockfinal-builds")),
    ),
    taskTtlSeconds: envNumber(env, "BUILDER_TASK_TTL_SECONDS", 3600),
    harnessVersion: envString(env, "MOCKFINAL_HARNESS_VERSION", "0.1.0"),
    maxBundleBytes: envNumber(env, "DECK_MAX_BUNDLE_BYTES", 2 * 1024 * 1024),
    agentDir,
    harnessDir,
    session: {
      mode: envString(env, "BUILDER_SESSION_MODE", "page") === "deck" ? "deck" : "page",
      pagesPerLane: Math.max(1, Math.trunc(envNumber(env, "BUILDER_SESSION_PAGES_PER_LANE", 3))),
      contextRatio: Math.min(0.9, Math.max(0.1, envNumber(env, "BUILDER_SESSION_CONTEXT_RATIO", 0.6))),
      ttlSeconds: Math.max(60, Math.trunc(envNumber(env, "BUILDER_SESSION_TTL_SECONDS", 1800))),
    },
    validator: {
      url: envString(env, "PAGE_VALIDATOR_URL", "http://page-validator:9200").replace(/\/+$/, ""),
      token: envString(env, "PAGE_VALIDATOR_TOKEN", ""),
      timeoutMs: envNumber(env, "PAGE_VALIDATOR_TIMEOUT_SECONDS", 120) * 1000,
    },
    llm: {
      baseUrl: envString(env, "LLM_BASE_URL", ""),
      apiKey: envString(env, "LLM_API_KEY", ""),
      model: envString(env, "PAGE_BUILDER_MODEL", ""),
      thinkingLevel: envThinkingLevel(env, "PAGE_BUILDER_THINKING", "medium"),
      reasoning: envFlag(env, "PAGE_BUILDER_REASONING"),
      promptProfile:
        envString(env, "PAGE_BUILDER_PROMPT_PROFILE", "zh") === "compact" ? "compact" : "zh",
      cost: {
        input: envNumber(env, "PAGE_BUILDER_COST_INPUT", 0),
        output: envNumber(env, "PAGE_BUILDER_COST_OUTPUT", 0),
        cacheRead: envNumber(env, "PAGE_BUILDER_COST_CACHE_READ", 0),
        cacheWrite: envNumber(env, "PAGE_BUILDER_COST_CACHE_WRITE", 0),
      },
    },
    mock: {
      enabled: envFlag(env, "PAGE_BUILDER_MOCK"),
      bundlePath: mockBundle && mockBundle !== "" ? mockBundle : null,
    },
    logLevel: envString(env, "BUILDER_LOG_LEVEL", "info") as BuilderConfig["logLevel"],
  };
}

export function llmConfigured(config: BuilderConfig): boolean {
  return Boolean(config.llm.baseUrl && config.llm.apiKey && config.llm.model);
}

export function validatorConfigured(config: BuilderConfig): boolean {
  return Boolean(config.validator.url && config.validator.token);
}
