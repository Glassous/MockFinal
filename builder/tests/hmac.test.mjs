import assert from "node:assert/strict";
import test from "node:test";

import {
  computeSignature,
  fingerprintBody,
  verifyRequestSignature,
} from "../dist/hmac.js";

const TOKEN = "unit-test-token";
const METHOD = "POST";
const PATH = "/v1/builds";
const BODY = Buffer.from(JSON.stringify({ build_id: "bld_test_001", page_brief: {} }), "utf8");

test("HMAC：合法签名与时间戳通过，并返回 body 指纹", () => {
  const now = 1_800_000_000;
  const timestamp = String(now - 30);
  const signature = computeSignature(TOKEN, timestamp, METHOD, PATH, BODY);
  const result = verifyRequestSignature({
    token: TOKEN,
    timestamp,
    signature,
    method: METHOD,
    path: PATH,
    rawBody: BODY,
    nowSeconds: now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.fingerprint, fingerprintBody(BODY));
});

test("HMAC：method/path 绑定，跨端点或改方法均拒绝", () => {
  const now = 1_800_000_000;
  const timestamp = String(now);
  const signature = computeSignature(TOKEN, timestamp, METHOD, PATH, BODY);
  assert.equal(
    verifyRequestSignature({
      token: TOKEN,
      timestamp,
      signature,
      method: "GET",
      path: PATH,
      rawBody: BODY,
      nowSeconds: now,
    }).ok,
    false,
  );
  assert.equal(
    verifyRequestSignature({
      token: TOKEN,
      timestamp,
      signature,
      method: METHOD,
      path: "/v1/builds/other",
      rawBody: BODY,
      nowSeconds: now,
    }).ok,
    false,
  );
});

test("HMAC：跨语言固定向量", () => {
  const signature = computeSignature(
    "unit-test-token",
    "1794030000",
    "POST",
    "/v1/builds",
    Buffer.from('{"build_id":"bld_1"}', "utf8"),
  );
  assert.equal(
    signature,
    "a7f4b000af9a40d3e39580f2ed9f31c9d525a2704fdbccd7f67933b29654d500",
  );
});

test("HMAC：时间戳偏差超过 300 秒返回 STALE_TIMESTAMP", () => {
  const now = 1_800_000_000;
  const timestamp = String(now - 301);
  const signature = computeSignature(TOKEN, timestamp, METHOD, PATH, BODY);
  const result = verifyRequestSignature({
    token: TOKEN,
    timestamp,
    signature,
    method: METHOD,
    path: PATH,
    rawBody: BODY,
    nowSeconds: now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STALE_TIMESTAMP");
});

test("HMAC：签名不匹配或请求体被篡改返回 BAD_SIGNATURE", () => {
  const now = 1_800_000_000;
  const timestamp = String(now);
  const signature = computeSignature(TOKEN, timestamp, METHOD, PATH, BODY);
  const tampered = Buffer.from(BODY.toString("utf8").replace("bld_test_001", "bld_test_002"));
  const result = verifyRequestSignature({
    token: TOKEN,
    timestamp,
    signature,
    method: METHOD,
    path: PATH,
    rawBody: tampered,
    nowSeconds: now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BAD_SIGNATURE");

  const wrong = verifyRequestSignature({
    token: "another-token",
    timestamp,
    signature,
    method: METHOD,
    path: PATH,
    rawBody: BODY,
    nowSeconds: now,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, "BAD_SIGNATURE");
});

test("HMAC：缺少请求头返回 MISSING_SIGNATURE", () => {
  const result = verifyRequestSignature({
    token: TOKEN,
    timestamp: undefined,
    signature: undefined,
    method: METHOD,
    path: PATH,
    rawBody: BODY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MISSING_SIGNATURE");
});
