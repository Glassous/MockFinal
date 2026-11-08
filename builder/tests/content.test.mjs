/**
 * Page Kit 2.0 内容渲染契约测试。
 * 运行：cd builder && npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderPage } from '../dist/page-kit/render.js';
import { PageContentError } from '../dist/page-kit/types.js';

const fixturePath = fileURLToPath(new URL('../../design_lab/content/cr-condition.json', import.meta.url));

function fixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function options(theme = 'workbench') {
  return {
    pageId: 'page_test_cr',
    theme,
    knowledgePointIds: ['kp_test'],
    estimatedMinutes: 9,
  };
}

test('同一份内容重复渲染结果完全一致', () => {
  const content = fixture();
  const first = renderPage(content, options());
  const second = renderPage(content, options());
  assert.equal(first.html, second.html);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.css, '');
  assert.equal(first.js, '');
});

test('manifest 映射 2.0 渲染器、主题与教学结构', () => {
  const result = renderPage(fixture(), options('problem'));
  const manifest = result.manifest;
  assert.equal(manifest.schema_version, '1.1');
  assert.equal(manifest.design_system, '2.0');
  assert.deepEqual(manifest.renderer, { kit: 'page-kit', version: '2.0.0', theme: 'problem' });
  assert.equal(manifest.teaching.scroll, 'flow');
  assert.equal(manifest.teaching.content_version, '2.0');
  assert.equal(manifest.teaching.role, 'mechanism');
  assert.equal(manifest.teaching.chain.length, 5);
  assert.equal(manifest.interactions.length, 2);
  assert.equal(manifest.interactions[0].smoke.expect, '[data-pg-figure-state="1"]');
  assert.equal(manifest.interactions[1].smoke.expect, '[data-pg-check-state="answered"]');
});

test('输出统一语义 DOM、MathML 与检查钩子', () => {
  const result = renderPage(fixture(), options('editorial'));
  assert.match(result.html, /class="pg-page/);
  assert.match(result.html, /data-pg-theme="editorial"/);
  assert.match(result.html, /data-mp-block="b1"/);
  assert.match(result.html, /data-pg-figure/);
  assert.match(result.html, /<math/);
  assert.match(result.html, /data-pg-check/);
  assert.match(result.html, /data-pg-option/);
  assert.match(result.html, /data-pg-correct="true"/);
});

test('HTML 内容被转义，不产生可执行标签', () => {
  const content = fixture();
  content.blocks.push({
    id: 'evil',
    type: 'prose',
    text: '行内 <img src=x onerror=alert(1)> 与 <script>alert(1)</script>',
  });
  const result = renderPage(content, options());
  assert.ok(!result.html.includes('<img src=x'));
  assert.ok(!result.html.includes('<script>alert(1)</script>'));
  assert.ok(result.html.includes('&lt;img'));
  assert.ok(result.html.includes('&lt;script&gt;'));
});

test('mechanism 缺少图示时抛出 FIGURE_REQUIRED', () => {
  const content = fixture();
  delete content.figure;
  assert.throws(
    () => renderPage(content, options()),
    (error) => {
      assert.ok(error instanceof PageContentError);
      assert.ok(error.issues.some((issue) => issue.code === 'FIGURE_REQUIRED'));
      return true;
    },
  );
});

test('非法块类型与非法主题被拒绝', () => {
  const content = fixture();
  content.blocks.push({ id: 'video', type: 'video', src: 'x' });
  assert.throws(() => renderPage(content, options()), PageContentError);
  assert.throws(() => renderPage(fixture(), options('unknown-theme')), PageContentError);
});

test('图示标注写 $...$ 时拒绝并提示用 Unicode 文本', () => {
  const content = fixture();
  content.figure.points = [{ x: 1, y: 0, label: '$z_0$' }];
  assert.throws(
    () => renderPage(content, options()),
    (error) => {
      assert.ok(error instanceof PageContentError);
      assert.ok(error.issues.some((issue) => issue.code === 'FIGURE_LABEL_TEX'));
      return true;
    },
  );
});

test('fit 页超过 3 个块时拒绝，防止单屏溢出', () => {
  const content = fixture();
  content.role = 'summary';
  content.scroll = 'fit';
  delete content.figure;
  content.check = [];
  content.blocks = [
    { id: 'b1', type: 'prose', title: '一', text: '要点一。' },
    { id: 'b2', type: 'prose', title: '二', text: '要点二。' },
    { id: 'b3', type: 'prose', title: '三', text: '要点三。' },
    { id: 'b4', type: 'prose', title: '四', text: '要点四。' }
  ];
  content.summary = { key_points: ['要点一'], misconceptions: ['易错一'], next: '下一页。' };
  assert.throws(
    () => renderPage(content, options()),
    (error) => {
      assert.ok(error instanceof PageContentError);
      assert.ok(error.issues.some((issue) => issue.code === 'BLOCKS_INVALID'));
      return true;
    },
  );
});
