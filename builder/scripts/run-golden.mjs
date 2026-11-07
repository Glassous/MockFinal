#!/usr/bin/env node
/**
 * P2 黄金页门禁执行器。
 *
 * 用法（Builder 已启动且配置了真实 LLM 时）：
 *   BUILDER_TOKEN=... node scripts/run-golden.mjs
 *   BUILDER_TOKEN=... node scripts/run-golden.mjs --base http://127.0.0.1:9100 --out ../docs/pageref/P2_RESULTS.json
 *
 * 只负责发起构建、轮询状态、收集事件与校验报告，不修改页面内容。
 * 报告用于 POC_ACCEPTANCE.md；mock 模式的结果会标记 mock=true，不能作为门禁通过证据。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["bisect", "matrix", "timeline"];
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

function parseArgs(argv) {
  const args = { base: process.env.BUILDER_URL ?? "http://127.0.0.1:9100", out: "../docs/pageref/P2_RESULTS.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--base" && value) args.base = value;
    if (key === "--out" && value) args.out = value;
    if (key === "--timeout" && value) args.timeout = Number(value) * 1000;
  }
  return args;
}

function sign(token, method, pathname, rawBody) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "Content-Type": "application/json",
    "X-MF-Timestamp": timestamp,
    "X-MF-Signature": createHmac("sha256", token)
      .update(`${timestamp}.${method.toUpperCase()}.${pathname}.${rawBody}`)
      .digest("hex"),
  };
}

async function request(base, method, pathname, token, payload) {
  const raw = payload === undefined ? "" : JSON.stringify(payload);
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: sign(token, method, pathname, raw),
    body: method === "POST" ? raw : undefined,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.BUILDER_TOKEN ?? "";
  if (!token) {
    console.error("缺少 BUILDER_TOKEN，无法签名请求。");
    process.exit(2);
  }

  const health = await request(args.base, "GET", "/healthz", token);
  const mode = health.body?.mode ?? "unknown";
  const results = [];
  const startedAt = new Date().toISOString();

  for (const name of PAGES) {
    const brief = JSON.parse(
      await fs.readFile(path.join(ROOT, "fixtures", "golden", name, "brief.json"), "utf8"),
    );
    const pageId = brief.page_id;
    const buildId = `golden_${pageId}_${Date.now()}`;
    const start = Date.now();
    console.log(`\n[${name}] 创建构建 ${buildId}（page_id=${pageId}）`);
    const created = await request(args.base, "POST", "/v1/builds", token, {
      build_id: buildId,
      page_brief: brief,
      feedback: null,
    });
    if (created.status !== 202 && created.status !== 200) {
      results.push({ name, page_id: pageId, build_id: buildId, status: "create_failed", error: created.body?.detail ?? "创建失败" });
      continue;
    }

    const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;
    let snapshot = null;
    while (Date.now() - start < timeout) {
      const current = await request(args.base, "GET", `/v1/builds/${buildId}`, token);
      snapshot = current.body;
      if (["succeeded", "failed", "canceled"].includes(snapshot?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const durationMs = Date.now() - start;
    const events = await request(args.base, "GET", `/v1/builds/${buildId}/events?after_seq=0`, token);
    const record = {
      name,
      page_id: pageId,
      build_id: buildId,
      status: snapshot?.status ?? "timeout",
      stage: snapshot?.stage ?? null,
      error: snapshot?.error ?? null,
      duration_ms: durationMs,
      attempts: snapshot?.attempts ?? null,
      usage: snapshot?.usage ?? null,
      validation: snapshot?.validation ?? null,
      events: events.body?.events ?? [],
    };
    if (snapshot?.status === "succeeded") {
      const bundle = await request(args.base, "GET", `/v1/builds/${buildId}/bundle`, token);
      record.bundle_http = bundle.status;
      record.bundle_bytes = bundle.body?.bundle
        ? Buffer.byteLength(JSON.stringify(bundle.body.bundle))
        : null;
    }
    console.log(`[${name}] ${record.status} ${(durationMs / 1000).toFixed(1)}s ${record.error ?? ""}`);
    results.push(record);
  }

  const report = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    base: args.base,
    mode,
    mock: mode === "mock",
    note:
      mode === "mock"
        ? "MOCK 模式结果，仅用于基础设施联调，不能作为 P2 门禁通过证据。"
        : "真实 Pi 构建结果，用于 P2 门禁评估。",
    pages: results,
    summary: {
      total: results.length,
      succeeded: results.filter((item) => item.status === "succeeded").length,
      failed: results.filter((item) => !["succeeded"].includes(item.status)).length,
    },
  };

  const outPath = path.resolve(ROOT, args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n报告已写入 ${outPath}`);
  console.log(`汇总：${report.summary.succeeded}/${report.summary.total} 成功（mode=${mode}）`);
}

main().catch((error) => {
  console.error("门禁执行失败：", error instanceof Error ? error.message : error);
  process.exit(1);
});
