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

function cloneBundle(bundle: Bundle): Bundle {
  return JSON.parse(JSON.stringify(bundle)) as Bundle;
}

const TEACHING_FIXTURES = [
  'good-teaching.bundle.json',
  'good-teaching-mechanism.bundle.json',
  'good-teaching-worked-example.bundle.json',
  'good-teaching-practice.bundle.json',
  'good-teaching-compare.bundle.json',
  'good-teaching-summary.bundle.json'
];

test('六个角色 golden fixture 在 1280×720 下无错误', { skip }, async () => {
  for (const file of TEACHING_FIXTURES) {
    const result = await browserCheck({
      bundle: loadBundle(file),
      viewports: [{ width: 1280, height: 720 }],
      screenshot: false
    });
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    assert.deepEqual(
      errors.map((issue) => `${issue.code}: ${issue.message}`),
      [],
      `${file} 出现 error`
    );
  }
});

test('good-teaching 在桌面与移动视口零错误且无内容预算告警', { skip }, async () => {
  const bundle = loadBundle('good-teaching.bundle.json');
  const result = await browserCheck({
    bundle,
    viewports: [...DEFAULT_VIEWPORTS, { width: 390, height: 844 }],
    screenshot: false
  });
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  assert.deepEqual(
    errors.map((issue) => `${issue.code}: ${issue.message}`),
    [],
    'good-teaching 不应出现 error'
  );
  const contentCodes = new Set([
    'CONTENT_BUDGET_EXCEEDED',
    'CONTENT_LAYER_WARNING',
    'CONTENT_BLOCKS_WARNING',
    'CONTENT_CLIPPED',
    'MIN_FONT_TOO_SMALL',
    'MIN_FONT_WARNING',
    'MOBILE_HORIZONTAL_OVERFLOW',
    'MOBILE_SCROLL_BLOCKED'
  ]);
  const contentIssues = result.issues.filter((issue) => contentCodes.has(issue.code));
  assert.deepEqual(
    contentIssues.map((issue) => `${issue.code}: ${issue.message}`),
    [],
    'good-teaching 不应触发内容预算/字号/移动端告警'
  );
});

test('内容超预算、块裁剪与过小字号会被浏览器检查拦截', { skip }, async () => {
  const bundle = cloneBundle(loadBundle('good-teaching.bundle.json'));
  bundle.html = bundle.html.replace(
    '若目标存在，它的下标一定落在闭区间内；区间为空则目标不存在。',
    `若目标存在，它的下标一定落在闭区间内；区间为空则目标不存在。${'内容'.repeat(400)}<span class="mp-tiny">小字说明</span>`
  );
  bundle.css += '\n.mp-card { height: 72px; overflow: hidden; }\n.mp-tiny { font-size: 9px; }';
  const result = await browserCheck({
    bundle,
    viewports: [{ width: 1280, height: 720 }],
    screenshot: false
  });
  const codes = codesOf(result.issues);
  assert.ok(codes.includes('CONTENT_BUDGET_EXCEEDED'), codes.join(','));
  assert.ok(codes.includes('MIN_FONT_TOO_SMALL'), codes.join(','));
  assert.ok(codes.includes('CONTENT_CLIPPED'), codes.join(','));
});

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

const PG2_GOOD_FIXTURES = [
  'good-pg2-mechanism.bundle.json',
  'good-pg2-worked-example.bundle.json',
  'good-pg2-summary.bundle.json'
];

test('Page Kit 2.0 good fixtures 在桌面与移动视口无错误', { skip }, async () => {
  const viewports = [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 }
  ];
  for (const file of PG2_GOOD_FIXTURES) {
    const result = await browserCheck({
      bundle: loadBundle(file),
      viewports,
      screenshot: false
    });
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    assert.deepEqual(
      errors.map((issue) => `${issue.code}: ${issue.viewport ?? ''} ${issue.message}`),
      [],
      `${file} 出现 error`
    );
  }
});

const PG2_BAD_FIXTURES: Array<[string, string]> = [
  ['bad-pg2-sparse.bundle.json', 'CONTENT_SPARSE'],
  ['bad-pg2-figure-large.bundle.json', 'FIGURE_TOO_LARGE'],
  ['bad-pg2-flow-long.bundle.json', 'FLOW_PAGE_TOO_LONG'],
  ['bad-pg2-fit-overflow.bundle.json', 'CONTENT_CLIPPED'],
  ['bad-pg2-min-font.bundle.json', 'MIN_FONT_TOO_SMALL']
];

test('Page Kit 2.0 bad fixtures 触发对应错误码', { skip }, async () => {
  for (const [file, expected] of PG2_BAD_FIXTURES) {
    const result = await browserCheck({
      bundle: loadBundle(file),
      viewports: [{ width: 1280, height: 720 }],
      screenshot: false
    });
    const codes = codesOf(result.issues.filter((issue) => issue.severity === 'error'));
    assert.ok(codes.includes(expected), `${file} 未出现 ${expected}，实际：${codes.join(', ')}`);
  }
});
