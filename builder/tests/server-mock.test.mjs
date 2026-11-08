/**
 * 端到端 HTTP 流程（MOCK 模式 + 本地假 Validator）：
 * POST /v1/builds（HMAC）→ 轮询状态 → 增量事件 → GET /bundle。
 * 该测试验证的是接口与交付链路，不代表真实 Pi 构建质量。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { computeSignature } from "../dist/hmac.js";
import { createBuilderApp } from "../dist/server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK_BUNDLE = path.join(HERE, "fixtures", "mock-bundle.json");
const BUILDER_TOKEN = "test-builder-token";
const VALIDATOR_TOKEN = "test-validator-token";

function startFakeValidator({ delayMs = 0, status = "passed", issues = [] } = {}) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const authorized = req.headers.authorization === `Bearer ${VALIDATOR_TOKEN}`;
      const respond = () => {
        if (!authorized) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "bad token" }));
          return;
        }
        if (req.url !== "/v1/validate" || req.method !== "POST") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "not found" }));
          return;
        }
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "bad json" }));
          return;
        }
        const payload = {
          status,
          issues,
          screenshots: [],
          duration_ms: 1,
          received_viewports: parsed.viewports?.length ?? 0,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (delayMs > 0) setTimeout(respond, delayMs);
      else respond();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function startBuilder(overrides = {}) {
  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mf-builder-"));
  const config = {
    host: "127.0.0.1",
    port: 0,
    builderToken: BUILDER_TOKEN,
    maxBodyBytes: 6 * 1024 * 1024,
    defaultDeadlineSeconds: 60,
    maxDeadlineSeconds: 120,
    concurrency: 2,
    buildRoot,
    taskTtlSeconds: 60,
    harnessVersion: "0.1.0",
    maxBundleBytes: 2 * 1024 * 1024,
    agentDir: path.join(HERE, "..", "pi-harness", "agent"),
    harnessDir: path.join(HERE, "..", "pi-harness"),
    validator: {
      url: "http://127.0.0.1:1",
      token: VALIDATOR_TOKEN,
      timeoutMs: 5000,
    },
    session: { mode: "page", pagesPerLane: 3, contextRatio: 0.6, ttlSeconds: 60 },
    llm: { baseUrl: "", apiKey: "", model: "", thinkingLevel: "medium", reasoning: false, promptProfile: "zh" },
    mock: { enabled: true, bundlePath: MOCK_BUNDLE },
    logLevel: "error",
    ...overrides,
  };
  const app = createBuilderApp(config, { log: () => {} });
  const { port } = await app.start();
  return { app, port, buildRoot, config };
}

function signedPost(port, pathname, body) {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeSignature(BUILDER_TOKEN, timestamp, "POST", pathname, raw);
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MF-Timestamp": timestamp,
      "X-MF-Signature": signature,
    },
    body: raw,
  });
}

function signedGet(port, pathname) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeSignature(BUILDER_TOKEN, timestamp, "GET", pathname, Buffer.alloc(0));
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: {
      "X-MF-Timestamp": timestamp,
      "X-MF-Signature": signature,
    },
  });
}

function signedDelete(port, pathname) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeSignature(BUILDER_TOKEN, timestamp, "DELETE", pathname, Buffer.alloc(0));
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "DELETE",
    headers: {
      "X-MF-Timestamp": timestamp,
      "X-MF-Signature": signature,
    },
  });
}

const BRIEF = {
  page_id: "page_mock_001",
  deck_title: "MOCK 联调",
  knowledge_point: { title: "二分查找", summary: "每次排除一半" },
  source_excerpts: [{ section_id: 101, heading: "二分查找", text: "在有序序列中每次排除一半。" }],
  style: { preset: "blueprint", content: ["concept"], custom_prompt: "", density: "standard" },
  interaction_idea: "区间收缩动画",
  constraints: {
    viewport: ["1280x720", "1440x900", "1920x1080"],
    no_scroll: true,
    no_network: true,
    max_bundle_bytes: 2097152,
    runtime_version: "1.0.0",
    language: "zh-CN",
  },
};

function buildBody(buildId = "bld_mock_001") {
  return { build_id: buildId, page_brief: BRIEF, feedback: null };
}

async function waitForStatus(port, buildId, expected, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await signedGet(port, `/v1/builds/${buildId}`);
    assert.equal(response.status, 200);
    last = await response.json();
    if (expected.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待状态 ${expected.join("/")} 超时，最后状态：${last?.status} ${last?.stage}`);
}

test("HTTP：MOCK 模式创建 → 轮询 → 事件 → bundle 全链路", async (t) => {
  const validator = await startFakeValidator();
  const builder = await startBuilder({
    validator: {
      url: `http://127.0.0.1:${validator.port}`,
      token: VALIDATOR_TOKEN,
      timeoutMs: 5000,
    },
  });
  t.after(async () => {
    await builder.app.stop();
    await new Promise((resolve) => validator.server.close(resolve));
  });

  const health = await fetch(`http://127.0.0.1:${builder.port}/healthz`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.mode, "mock");
  assert.equal(healthBody.pi_version, "1.5.0");

  const created = await signedPost(builder.port, "/v1/builds", buildBody());
  assert.equal(created.status, 202);
  const createdBody = await created.json();
  assert.equal(createdBody.build_id, "bld_mock_001");

  const repeated = await signedPost(builder.port, "/v1/builds", buildBody());
  assert.equal(repeated.status, 200, "相同 build_id 与相同 body 必须幂等");

  const conflict = await signedPost(builder.port, "/v1/builds", {
    ...buildBody(),
    feedback: "这次内容不同",
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "BUILD_ID_CONFLICT");

  const snapshot = await waitForStatus(builder.port, "bld_mock_001", [
    "succeeded",
    "failed",
  ]);
  assert.equal(snapshot.status, "succeeded", snapshot.error ?? "");
  assert.equal(snapshot.validation.status, "passed");
  assert.equal(snapshot.page_id, "page_mock_001");

  const eventsResponse = await signedGet(builder.port, "/v1/builds/bld_mock_001/events?after_seq=0");
  assert.equal(eventsResponse.status, 200);
  const eventsBody = await eventsResponse.json();
  assert.ok(eventsBody.events.length > 0);
  assert.equal(eventsBody.finished, true);
  assert.ok(eventsBody.next_seq >= eventsBody.events.length);
  assert.ok(
    eventsBody.events.some((event) => event.type === "stage"),
    "事件中应包含 stage 类型",
  );
  const eventText = JSON.stringify(eventsBody);
  assert.ok(!eventText.includes(BUILDER_TOKEN), "事件不得泄露构建 token");
  assert.ok(!eventText.includes(VALIDATOR_TOKEN), "事件不得泄露 Validator token");

  const bundleResponse = await signedGet(builder.port, "/v1/builds/bld_mock_001/bundle");
  assert.equal(bundleResponse.status, 200);
  const bundleBody = await bundleResponse.json();
  assert.equal(bundleBody.build_id, "bld_mock_001");
  assert.equal(bundleBody.bundle.schema_version, "1.0");
  assert.equal(bundleBody.bundle.manifest.page_id, "page_mock_001");
  assert.equal(bundleBody.validation.status, "passed");

  assert.equal(
    fs.existsSync(path.join(builder.buildRoot, "bld_mock_001")),
    false,
    "成功交付后应清理构建临时目录",
  );
});

test("HTTP：未签名/过期时间戳被拒绝，未就绪 bundle 返回 409", async (t) => {
  const validator = await startFakeValidator({ delayMs: 400 });
  const builder = await startBuilder({
    validator: {
      url: `http://127.0.0.1:${validator.port}`,
      token: VALIDATOR_TOKEN,
      timeoutMs: 5000,
    },
  });
  t.after(async () => {
    await builder.app.stop();
    await new Promise((resolve) => validator.server.close(resolve));
  });

  const unsigned = await fetch(`http://127.0.0.1:${builder.port}/v1/builds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody("bld_mock_002")),
  });
  assert.equal(unsigned.status, 401);
  assert.equal((await unsigned.json()).code, "MISSING_SIGNATURE");

  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400);
  const raw = Buffer.from(JSON.stringify(buildBody("bld_mock_003")), "utf8");
  const stale = await fetch(`http://127.0.0.1:${builder.port}/v1/builds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MF-Timestamp": staleTimestamp,
      "X-MF-Signature": computeSignature(BUILDER_TOKEN, staleTimestamp, "POST", "/v1/builds", raw),
    },
    body: raw,
  });
  assert.equal(stale.status, 401);
  assert.equal((await stale.json()).code, "STALE_TIMESTAMP");

  const mismatchRaw = Buffer.from(JSON.stringify(buildBody("bld_mock_004")), "utf8");
  const mismatchTimestamp = String(Math.floor(Date.now() / 1000));
  const pathMismatch = await fetch(
    `http://127.0.0.1:${builder.port}/v1/builds/bld_mock_004/cancel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MF-Timestamp": mismatchTimestamp,
        "X-MF-Signature": computeSignature(
          BUILDER_TOKEN,
          mismatchTimestamp,
          "POST",
          "/v1/builds",
          mismatchRaw,
        ),
      },
      body: mismatchRaw,
    },
  );
  assert.equal(pathMismatch.status, 401);
  assert.equal((await pathMismatch.json()).code, "BAD_SIGNATURE");

  const queryMismatchTimestamp = String(Math.floor(Date.now() / 1000));
  const queryMismatch = await fetch(
    `http://127.0.0.1:${builder.port}/v1/builds/bld_mock_004/events?after_seq=0`,
    {
      headers: {
        "X-MF-Timestamp": queryMismatchTimestamp,
        "X-MF-Signature": computeSignature(
          BUILDER_TOKEN,
          queryMismatchTimestamp,
          "GET",
          "/v1/builds/bld_mock_004/events",
          Buffer.alloc(0),
        ),
      },
    },
  );
  assert.equal(queryMismatch.status, 401);
  assert.equal((await queryMismatch.json()).code, "BAD_SIGNATURE");

  const created = await signedPost(builder.port, "/v1/builds", buildBody("bld_mock_004"));
  assert.equal(created.status, 202);

  const earlyBundle = await signedGet(builder.port, "/v1/builds/bld_mock_004/bundle");
  assert.equal(earlyBundle.status, 409);
  assert.equal((await earlyBundle.json()).code, "BUILD_NOT_READY");

  const canceled = await signedPost(builder.port, "/v1/builds/bld_mock_004/cancel", {});
  assert.equal(canceled.status, 202);
  const canceledBody = await canceled.json();
  assert.equal(canceledBody.status, "canceled");

  const cancelAgain = await signedPost(builder.port, "/v1/builds/bld_mock_004/cancel", {});
  assert.equal(cancelAgain.status, 202, "取消接口必须幂等");
});

test("HTTP：Validator 不可用时 fail-closed，返回中文失败原因", async (t) => {
  const builder = await startBuilder({
    validator: { url: "http://127.0.0.1:1", token: VALIDATOR_TOKEN, timeoutMs: 1000 },
  });
  t.after(async () => {
    await builder.app.stop();
  });

  const created = await signedPost(builder.port, "/v1/builds", buildBody("bld_mock_005"));
  assert.equal(created.status, 202);
  const snapshot = await waitForStatus(builder.port, "bld_mock_005", ["failed", "succeeded"]);
  assert.equal(snapshot.status, "failed");
  assert.ok(snapshot.error && /校验/.test(snapshot.error), `失败原因应为中文校验文案：${snapshot.error}`);

  const bundleResponse = await signedGet(builder.port, "/v1/builds/bld_mock_005/bundle");
  assert.equal(bundleResponse.status, 409);
});

test("HTTP：未配置 Validator 时创建请求返回 503", async (t) => {
  const builder = await startBuilder({
    validator: { url: "http://127.0.0.1:1", token: "", timeoutMs: 1000 },
  });
  t.after(async () => {
    await builder.app.stop();
  });
  const response = await signedPost(builder.port, "/v1/builds", buildBody("bld_mock_006"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "VALIDATOR_UNAVAILABLE");
});

test("HTTP：session 元数据被接受并写入快照", async (t) => {
  const validator = await startFakeValidator();
  t.after(() => new Promise((resolve) => validator.server.close(resolve)));
  const builder = await startBuilder({
    validator: {
      url: `http://127.0.0.1:${validator.port}`,
      token: VALIDATOR_TOKEN,
      timeoutMs: 5000,
    },
  });
  t.after(async () => {
    await builder.app.stop();
  });
  const body = {
    ...buildBody("bld_mock_lane_001"),
    session: { key: "deck_1_lane_0", lane: 0, page_index: 0, page_total: 3, first: true },
  };
  const created = await signedPost(builder.port, "/v1/builds", body);
  assert.equal(created.status, 202);
  const snapshot = await waitForStatus(builder.port, "bld_mock_lane_001", ["succeeded", "failed"]);
  assert.equal(snapshot.status, "succeeded", snapshot.error ?? "");
  assert.equal(snapshot.session_key, "deck_1_lane_0");
  assert.equal(snapshot.lane, 0);
  const pageDir = path.join(
    builder.buildRoot,
    "sessions",
    "deck_1_lane_0",
    "pages",
    "page_mock_001",
  );
  assert.equal(fs.existsSync(pageDir), false, "MOCK 模式清理页面目录，但不得误删会话根");
});

test("HTTP：非法 session 元数据被拒绝", async (t) => {
  const builder = await startBuilder();
  t.after(async () => {
    await builder.app.stop();
  });
  const invalidKey = await signedPost(builder.port, "/v1/builds", {
    ...buildBody("bld_mock_lane_bad_1"),
    session: { key: "bad key!" },
  });
  assert.equal(invalidKey.status, 400);
  const badIndex = await signedPost(builder.port, "/v1/builds", {
    ...buildBody("bld_mock_lane_bad_2"),
    session: { key: "deck_1_lane_0", page_index: 3, page_total: 3 },
  });
  assert.equal(badIndex.status, 400);
});

test("HTTP：DELETE /v1/sessions/{key} 幂等且校验 key", async (t) => {
  const builder = await startBuilder();
  t.after(async () => {
    await builder.app.stop();
  });
  const missing = await signedDelete(builder.port, "/v1/sessions/deck_missing_lane_0");
  assert.equal(missing.status, 202);
  assert.deepEqual(await missing.json(), { key: "deck_missing_lane_0", status: "not_found" });

  const invalid = await signedDelete(builder.port, "/v1/sessions/bad%20key");
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_SESSION_KEY");

  const wrongMethod = await signedGet(builder.port, "/v1/sessions/deck_missing_lane_0");
  assert.equal(wrongMethod.status, 405);
});
