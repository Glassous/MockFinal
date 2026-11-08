#!/usr/bin/env node
// P11 A/B 采样器：按 fixture brief 依次构建真实页面，记录 usage / validation。
// 用法：
//   BUILDER_TOKEN=dev-builder node tools/ab_runner.mjs \
//     --base http://127.0.0.1:9100 --mode lane --roles mechanism,practice \
//     --session-key deck_ab_lane0_1 --chapter 1 --out ../../docs/pageref/P11_AB_LANE.json
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

function sign(token, method, pathname, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac("sha256", token)
    .update(`${timestamp}.${method}.${pathname}.`)
    .update(body)
    .digest("hex");
  return { "X-MF-Timestamp": timestamp, "X-MF-Signature": signature };
}

async function call(base, token, method, pathname, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const headers = { ...sign(token, method, pathname, body) };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${pathname}`, { method, headers, body: body || undefined });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

async function waitForBuild(base, token, buildId, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const result = await call(base, token, "GET", `/v1/builds/${buildId}`);
    if (result.status !== 200) throw new Error(`查询 ${buildId} 失败：${JSON.stringify(result.body)}`);
    const status = result.body.status;
    if (["succeeded", "failed", "canceled"].includes(status)) return result.body;
    if (Date.now() - started > timeoutMs) {
      await call(base, token, "POST", `/v1/builds/${buildId}/cancel`);
      throw new Error(`构建 ${buildId} 超时`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const base = (args.base ?? "http://127.0.0.1:9100").replace(/\/+$/, "");
  const token = process.env.BUILDER_TOKEN;
  if (!token) throw new Error("缺少 BUILDER_TOKEN");
  const mode = args.mode === "lane" ? "lane" : "page";
  const roles = (args.roles ?? "mechanism,practice").split(",").filter(Boolean);
  const chapter = args.chapter === undefined ? null : Number(args.chapter);
  const sessionKey = args["session-key"] ?? `deck_ab_lane0_${Date.now()}`;
  const lane = Number(args.lane ?? 0);
  const outPath = path.resolve(ROOT, args.out ?? "ab-report.json");
  const timeoutMs = Number(args.timeout ?? 900) * 1000;

  const health = await call(base, token, "GET", "/healthz");
  const report = {
    generated_at: new Date().toISOString(),
    base,
    mode,
    roles,
    chapter,
    session_key: mode === "lane" ? sessionKey : null,
    healthz: health.body,
    pages: [],
  };

  try {
    for (const [index, role] of roles.entries()) {
      const briefPath = path.join(ROOT, "fixtures", "teaching", role, "brief.json");
      const brief = JSON.parse(await fs.readFile(briefPath, "utf8"));
      if (chapter !== null && brief.deck_context) brief.deck_context.chapter_index = chapter;
      const buildId = `ab_${mode}_${role}_${Date.now()}`;
      const payload = {
        build_id: buildId,
        page_brief: brief,
        feedback: null,
        deadline_seconds: 480,
      };
      if (mode === "lane") {
        payload.session = {
          key: sessionKey,
          lane,
          page_index: index,
          page_total: roles.length,
          first: index === 0,
        };
      }
      const started = Date.now();
      const created = await call(base, token, "POST", "/v1/builds", payload);
      if (created.status !== 202 && created.status !== 200) {
        report.pages.push({
          role,
          build_id: buildId,
          status: "create_failed",
          create_status: created.status,
          error: created.body,
        });
        continue;
      }
      const finished = await waitForBuild(base, token, buildId, timeoutMs);
      const entry = {
        role,
        build_id: buildId,
        status: finished.status,
        error: finished.error,
        session_key: finished.session_key ?? null,
        lane: finished.lane ?? null,
        usage: finished.usage,
        validation: finished.validation
          ? {
              status: finished.validation.status,
              issues: finished.validation.issues,
              teaching: finished.validation.teaching,
            }
          : null,
        duration_ms: Date.now() - started,
      };
      if (finished.status === "succeeded") {
        const bundle = await call(base, token, "GET", `/v1/builds/${buildId}/bundle`);
        entry.bundle_http = bundle.status;
        entry.bundle_bytes = bundle.body?.bundle
          ? Buffer.byteLength(JSON.stringify(bundle.body.bundle))
          : null;
        entry.css_bytes = bundle.body?.bundle?.css
          ? Buffer.byteLength(bundle.body.bundle.css, "utf8")
          : null;
      }
      report.pages.push(entry);
    }
  } finally {
    if (mode === "lane") {
      report.cleanup = await call(base, token, "DELETE", `/v1/sessions/${sessionKey}`);
    }
    report.summary = {
      total: report.pages.length,
      succeeded: report.pages.filter((page) => page.status === "succeeded").length,
    };
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        { out: outPath, mode, summary: report.summary, cleanup: report.cleanup ?? null },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
