/**
 * 内部 HTTP 接口测试：真实启动 dist/server.js，验证鉴权、错误体与报告结构。
 * 默认端口 9300（避开开发用的 9200）；可用 VALIDATOR_TEST_PORT 覆盖。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOKEN = 'test-validator-token-0123456789';
const PORT = Number(process.env.VALIDATOR_TEST_PORT ?? 9300);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess | null = null;

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      // 尚未监听，继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Validator 未在 12 秒内启动（端口 9200 可能被占用）');
}

before(async () => {
  const entry = fileURLToPath(new URL('../server.js', import.meta.url));
  child = spawn(process.execPath, [entry], {
    env: { ...process.env, VALIDATOR_TOKEN: TOKEN, VALIDATOR_PORT: String(PORT) },
    stdio: 'ignore',
    windowsHide: true
  });
  await waitForServer();
});

after(() => {
  child?.kill();
});

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}/v1/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body
  });
}

test('/healthz 返回版本信息', async () => {
  const response = await fetch(`${BASE}/healthz`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { status: string; version: string; runtime_version: string };
  assert.equal(body.status, 'ok');
  assert.equal(body.runtime_version, '1.1.0');
  assert.ok(body.version.length > 0);
});

test('缺少 Bearer token 返回 401 中文错误', async () => {
  const response = await post('{}');
  assert.equal(response.status, 401);
  const body = (await response.json()) as { detail: string; code: string };
  assert.equal(body.code, 'UNAUTHORIZED');
  assert.ok(body.detail.length > 0);
});

test('错误 token 返回 401', async () => {
  const response = await post('{}', { authorization: 'Bearer wrong-token' });
  assert.equal(response.status, 401);
});

test('非 JSON Content-Type 返回 415', async () => {
  const response = await post('{}', {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'text/plain'
  });
  assert.equal(response.status, 415);
});

test('非法 JSON 返回 400 INVALID_JSON', async () => {
  const response = await post('{not json', { authorization: `Bearer ${TOKEN}` });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, 'INVALID_JSON');
});

test('缺少 bundle 返回 400 INVALID_REQUEST', async () => {
  const response = await post(JSON.stringify({ viewports: [] }), {
    authorization: `Bearer ${TOKEN}`
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, 'INVALID_REQUEST');
});

test('非法 viewports 返回 400 INVALID_VIEWPORTS', async () => {
  const response = await post(JSON.stringify({ bundle: {}, viewports: [{ width: 3, height: 2 }] }), {
    authorization: `Bearer ${TOKEN}`
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, 'INVALID_VIEWPORTS');
});

test('结构非法的 bundle 返回 failed 报告（不需要浏览器）', async () => {
  const response = await post(JSON.stringify({ bundle: { schema_version: '2.0' } }), {
    authorization: `Bearer ${TOKEN}`
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    status: string;
    issues: Array<{ severity: string; code: string; message: string }>;
    screenshots: unknown[];
    duration_ms: number;
  };
  assert.equal(body.status, 'failed');
  assert.ok(body.issues.length > 0);
  assert.ok(body.issues.every((issue) => issue.severity && issue.code && issue.message));
  assert.ok(Array.isArray(body.screenshots));
  assert.ok(typeof body.duration_ms === 'number');
});

test('未知路径返回 404', async () => {
  const response = await fetch(`${BASE}/v1/unknown`);
  assert.equal(response.status, 404);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, 'NOT_FOUND');
});
