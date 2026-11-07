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
  validator: {
    url: string;
    token: string;
    timeoutMs: number;
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    thinkingLevel: string;
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
    validator: {
      url: envString(env, "PAGE_VALIDATOR_URL", "http://page-validator:9200").replace(/\/+$/, ""),
      token: envString(env, "PAGE_VALIDATOR_TOKEN", ""),
      timeoutMs: envNumber(env, "PAGE_VALIDATOR_TIMEOUT_SECONDS", 120) * 1000,
    },
    llm: {
      baseUrl: envString(env, "LLM_BASE_URL", ""),
      apiKey: envString(env, "LLM_API_KEY", ""),
      model: envString(env, "PAGE_BUILDER_MODEL", ""),
      thinkingLevel: envString(env, "PAGE_BUILDER_THINKING", "medium"),
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
