/**
 * 浏览器检查测试（Playwright Chromium）。
 * 未安装浏览器时自动 skip，并在输出中说明，不冒充通过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { browserCheck } from '../browser-check.js';
import { staticCheck } from '../static-check.js';
import { DEFAULT_VIEWPORTS, type Bundle, type Issue } from '../types.js';

function loadBundle(name: string): Bundle {
  const path = fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Bundle;
}

let chromiumFailure: string | null = null;
try {
  const browser = await chromium.launch();
  await browser.close();
} catch (error) {
  chromiumFailure = error instanceof Error ? error.message.split('\n')[0] ?? String(error) : String(error);
}

const skip = chromiumFailure ? `Chromium 不可用：${chromiumFailure}` : false;

function codesOf(issues: Issue[]): string[] {
  return issues.map((issue) => issue.code);
}

test('good-basic 在三个验收视口零滚动、无控制台错误、冒烟通过', { skip }, async () => {
  const bundle = loadBundle('good-basic.bundle.json');
  const result = await browserCheck({ bundle, viewports: DEFAULT_VIEWPORTS, screenshot: false });
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  assert.deepEqual(
    errors.map((issue) => `${issue.code}: ${issue.message}`),
    [],
    'good-basic 不应出现 error'
  );
});

test('good-basic 截图返回 data URI', { skip }, async () => {
  const bundle = loadBundle('good-basic.bundle.json');
  const result = await browserCheck({
    bundle,
    viewports: [{ width: 1280, height: 720 }],
    screenshot: true
  });
  assert.equal(result.screenshots.length, 1);
  const dataUri = result.screenshots[0]?.data_uri ?? '';
  assert.ok(dataUri.startsWith('data:image/'), dataUri.slice(0, 40));
});

test('bad-overflow 触发 ZERO_SCROLL_OVERFLOW', { skip }, async () => {
  const bundle = loadBundle('bad-overflow.bundle.json');
  const result = await browserCheck({
    bundle,
    viewports: [{ width: 1280, height: 720 }],
    screenshot: false
  });
  assert.ok(codesOf(result.issues).includes('ZERO_SCROLL_OVERFLOW'), codesOf(result.issues).join(','));
});

test('bad-console-error 触发 CONSOLE_ERROR', { skip }, async () => {
  const bundle = loadBundle('bad-console-error.bundle.json');
  const result = await browserCheck({
    bundle,
    viewports: [{ width: 1280, height: 720 }],
    screenshot: false
  });
  assert.ok(codesOf(result.issues).includes('CONSOLE_ERROR'), codesOf(result.issues).join(','));
});

test('bad-smoke-fail 触发 SMOKE_FAILED', { skip }, async () => {
  const bundle = loadBundle('bad-smoke-fail.bundle.json');
  const result = await browserCheck({
    bundle,
    viewports: [{ width: 1280, height: 720 }],
    screenshot: false
  });
  assert.ok(codesOf(result.issues).includes('SMOKE_FAILED'), codesOf(result.issues).join(','));
});

test('bad-external-link 出现 NETWORK_REQUEST', { skip }, async () => {
  const bundle = loadBundle('bad-external-link.bundle.json');
  const staticResult = staticCheck(bundle);
  assert.ok(staticResult.issues.some((issue) => issue.code === 'HTML_EXTERNAL_URL'));
  const result = await browserCheck({
    bundle,
    viewports: [{ width: 1280, height: 720 }],
    screenshot: false
  });
  assert.ok(codesOf(result.issues).includes('NETWORK_REQUEST'), codesOf(result.issues).join(','));
});

test('bad-fetch 在浏览器中被 CSP 拦截（报 CONSOLE_ERROR 或 NETWORK_REQUEST）', { skip }, async () => {
  const bundle = loadBundle('bad-fetch.bundle.json');
  const result = await browserCheck({
    bundle,
    viewports: [{ width: 1280, height: 720 }],
    screenshot: false
  });
  const codes = codesOf(result.issues);
  assert.ok(
    codes.includes('CONSOLE_ERROR') || codes.includes('NETWORK_REQUEST'),
    `实际问题：${codes.join(',')}`
  );
});
