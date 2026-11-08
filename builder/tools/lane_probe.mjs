#!/usr/bin/env node
// 单页失败注入探针：发送一个 lane 页面，可选延迟取消，记录终态与事件尾部。
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    out[argv[i].slice(2)] = argv[i + 1];
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

async function main() {
  const args = parseArgs(process.argv);
  const base = (args.base ?? "http://127.0.0.1:9100").replace(/\/+$/, "");
  const token = process.env.BUILDER_TOKEN;
  if (!token) throw new Error("缺少 BUILDER_TOKEN");
  const role = args.role ?? "practice";
  const sessionKey = args["session-key"] ?? `deck_probe_${Date.now()}`;
  const pageIndex = Number(args["page-index"] ?? 0);
  const pageTotal = Number(args["page-total"] ?? 2);
  const first = args.first === "true";
  const cancelAfterMs = Number(args["cancel-after-ms"] ?? 0);
  const chapter = args.chapter === undefined ? 1 : Number(args.chapter);
  const timeoutMs = Number(args.timeout ?? 600) * 1000;
  const outPath = path.resolve(ROOT, args.out ?? "probe.json");

  const brief = JSON.parse(
    await fs.readFile(path.join(ROOT, "fixtures", "teaching", role, "brief.json"), "utf8"),
  );
  if (brief.deck_context) brief.deck_context.chapter_index = chapter;
  const buildId = `probe_${role}_${Date.now()}`;
  const payload = {
    build_id: buildId,
    page_brief: brief,
    feedback: null,
    deadline_seconds: 480,
    session: {
      key: sessionKey,
      lane: 0,
      page_index: pageIndex,
      page_total: pageTotal,
      first,
    },
  };

  const started = Date.now();
  const created = await call(base, token, "POST", "/v1/builds", payload);
  const report = {
    generated_at: new Date().toISOString(),
    base,
    role,
    session_key: sessionKey,
    build_id: buildId,
    first,
    cancel_after_ms: cancelAfterMs || null,
    create: created,
    final: null,
    events: [],
  };

  if (created.status !== 202 && created.status !== 200) {
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  let cancelledAt = null;
  let cancelResult = null;
  if (cancelAfterMs > 0) {
    setTimeout(async () => {
      cancelledAt = Date.now();
      cancelResult = await call(base, token, "POST", `/v1/builds/${buildId}/cancel`, {});
    }, cancelAfterMs);
  }

  for (;;) {
    const status = await call(base, token, "GET", `/v1/builds/${buildId}`);
    if (status.status !== 200) throw new Error(`查询失败：${JSON.stringify(status.body)}`);
    if (["succeeded", "failed", "canceled"].includes(status.body.status)) {
      report.final = status.body;
      break;
    }
    if (Date.now() - started > timeoutMs) {
      await call(base, token, "POST", `/v1/builds/${buildId}/cancel`, {});
      report.final = { status: "client_timeout" };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  report.cancel_result = cancelResult;
  report.cancelled_at_ms = cancelledAt;
  report.duration_ms = Date.now() - started;
  const events = await call(base, token, "GET", `/v1/builds/${buildId}/events?after_seq=0`);
  if (events.status === 200) {
    report.events = (events.body.events ?? []).slice(-12);
  }
  if (args.delete === "true") {
    report.cleanup = await call(base, token, "DELETE", `/v1/sessions/${sessionKey}`);
  }
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        out: outPath,
        status: report.final?.status,
        error: report.final?.error,
        session_key: report.final?.session_key,
        usage: report.final?.usage,
        duration_ms: report.duration_ms,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
