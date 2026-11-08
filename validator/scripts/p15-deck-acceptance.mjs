/**
 * P15 复变函数 deck 验收：逐页渲染真实 bundle，截图 + 测滚动/字号/图示/交互。
 *
 * 运行（token 只从环境变量读取，不写入仓库）：
 *   P15_TOKEN=... P15_DECK_ID=40 node validator/scripts/p15-deck-acceptance.mjs
 *
 * 输出：
 *   docs/pageref/p15-screenshots/<ordinal>-<role>-<viewport>.png
 *   docs/pageref/p15-screenshots/P15_RESULTS.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { buildShell } from '../../shared/page-shell/shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', 'pageref', 'p15-screenshots');
const BASE = (process.env.P15_BASE_URL || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
const TOKEN = process.env.P15_TOKEN;
const DECK_ID = process.env.P15_DECK_ID;
const RUNTIME_SOURCE = await fs.readFile(path.join(ROOT, 'shared', 'page-runtime', 'runtime.js'), 'utf8');

if (!TOKEN || !DECK_ID) {
  console.error('缺少 P15_TOKEN 或 P15_DECK_ID');
  process.exit(2);
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 720 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
  { name: '390', width: 390, height: 844 }
];

async function api(pathname) {
  const response = await fetch(`${BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!response.ok) {
    throw new Error(`${pathname} -> HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

function channel() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

async function measure(page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.pg-page');
    const flow = document.querySelector('.pg-flow');
    const rail = document.querySelector('.pg-rail');
    const figure = document.querySelector('[data-pg-figure]');
    const blocks = Array.from(document.querySelectorAll('[data-mp-block]'));
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const cjk = (pageEl?.innerText.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
    let minFont = Infinity;
    let sample = '';
    if (pageEl) {
      const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue?.trim();
        if (!text) continue;
        const el = walker.currentNode.parentElement;
        if (!el || el.closest('math') || el.closest('svg') || !visible(el)) continue;
        const size = Number.parseFloat(window.getComputedStyle(el).fontSize);
        if (size > 0 && size < minFont) {
          minFont = size;
          sample = text.slice(0, 18);
        }
      }
    }
    const contentBottom = Math.max(
      flow ? flow.getBoundingClientRect().bottom + window.scrollY : 0,
      rail ? rail.getBoundingClientRect().bottom + window.scrollY : 0
    );
    const figureRect = figure?.getBoundingClientRect();
    return {
      theme: pageEl?.getAttribute('data-pg-theme'),
      role: pageEl?.getAttribute('data-pg-role'),
      scroll: pageEl?.getAttribute('data-pg-scroll'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      screenRatio: Number((document.documentElement.scrollHeight / window.innerHeight).toFixed(2)),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      blocks: blocks.length,
      visibleBlocks: blocks.filter(visible).length,
      cjk,
      minFont: Number.isFinite(minFont) ? minFont : 0,
      minFontSample: sample,
      figure: figureRect
        ? { width: Math.round(figureRect.width), height: Math.round(figureRect.height) }
        : null,
      contentBottom: Math.round(contentBottom),
      contentShare: Math.round((contentBottom / window.innerHeight) * 100) / 100,
      checks: document.querySelectorAll('[data-pg-check]').length,
      figureStates: document.querySelectorAll('[data-pg-action="figure-next"]').length
    };
  });
}

async function renderPage(browser, bundle, theme, viewport, reducedMotion = false) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const html = buildShell({ bundle, runtimeSource: RUNTIME_SOURCE, channel: channel(), theme });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForSelector('[data-mp-ready="true"]', { timeout: 15000 });
  await page.waitForTimeout(80);
  return { page, errors };
}

await fs.mkdir(OUT, { recursive: true });
const deck = await api(`/decks/${DECK_ID}`);
const pages = deck.pages
  .filter((page) => page.status === 'ready')
  .sort((a, b) => a.ordinal - b.ordinal);

const browser = await chromium.launch({ headless: true });
const results = [];
const failures = [];

for (const summary of pages) {
  const bundle = await api(`/decks/${DECK_ID}/pages/${summary.id}/bundle`);
  const manifest = bundle.manifest || {};
  const role = manifest.teaching?.role || summary.kind;
  const theme = manifest.renderer?.theme || 'workbench';
  const scroll = manifest.teaching?.scroll || 'flow';
  const prefix = `${String(summary.ordinal + 1).padStart(2, '0')}-${role}`;
  const entry = { page_id: summary.id, ordinal: summary.ordinal + 1, title: summary.title, role, theme, scroll, runs: [] };

  for (const viewport of VIEWPORTS) {
    const { page, errors } = await renderPage(browser, bundle, 'light', viewport);
    const metrics = await measure(page);
    await page.screenshot({ path: path.join(OUT, `${prefix}-${viewport.name}.png`), fullPage: false });
    if (scroll === 'flow') {
      await page.screenshot({ path: path.join(OUT, `${prefix}-${viewport.name}-full.png`), fullPage: true });
    }
    entry.runs.push({ ...metrics, viewportName: viewport.name, consoleErrors: errors });
    if (errors.length) failures.push(`${prefix}/${viewport.name}: console ${errors.join(' | ')}`);
    if (metrics.overflowX > 1) failures.push(`${prefix}/${viewport.name}: 横向溢出 ${metrics.overflowX}px`);
    if (scroll === 'fit' && viewport.name !== '390' && metrics.documentHeight > viewport.height + 1) {
      failures.push(`${prefix}/${viewport.name}: fit 页纵向溢出 ${metrics.documentHeight - viewport.height}px`);
    }
    if (scroll === 'flow' && viewport.name !== '390' && metrics.documentHeight > 2200) {
      failures.push(`${prefix}/${viewport.name}: flow 页总高 ${metrics.documentHeight}px 超过 2200px`);
    }
    if (metrics.minFont > 0 && metrics.minFont < 12) {
      failures.push(`${prefix}/${viewport.name}: 最小字号 ${metrics.minFont}px (${metrics.minFontSample})`);
    }
    if (scroll === 'fit' && metrics.contentShare < 0.65) {
      failures.push(`${prefix}/${viewport.name}: fit 页内容仅 ${metrics.contentShare} 屏高`);
    }
    if (metrics.figure && scroll === 'flow' && metrics.figure.width > 380) {
      failures.push(`${prefix}/${viewport.name}: flow 图示宽 ${metrics.figure.width}px`);
    }
    if (metrics.figure) {
      const share = (metrics.figure.width * metrics.figure.height) / (viewport.width * viewport.height);
      if (scroll === 'fit' && share > 0.35) failures.push(`${prefix}/${viewport.name}: fit 图示面积 ${(share * 100).toFixed(1)}%`);
    }

    if (viewport.name === '1280') {
      if (metrics.figureStates > 0) {
        await page.locator('[data-pg-action="figure-next"]').first().click();
        await page.waitForTimeout(80);
        await page.screenshot({ path: path.join(OUT, `${prefix}-state2-1280.png`) });
      }
      if (metrics.checks > 0) {
        await page.locator('[data-pg-option]').first().click();
        await page.waitForTimeout(80);
        const state = await page.locator('[data-pg-check]').first().getAttribute('data-pg-check-state');
        if (state !== 'answered') failures.push(`${prefix}: 检查未进入 answered`);
        await page.screenshot({ path: path.join(OUT, `${prefix}-check-1280.png`) });
      }
    }
    await page.close();
  }

  const dark = await renderPage(browser, bundle, 'dark', { width: 1280, height: 720 });
  await dark.page.screenshot({ path: path.join(OUT, `${prefix}-dark-1280.png`) });
  entry.dark = await measure(dark.page);
  if (dark.errors.length) failures.push(`${prefix}/dark: console ${dark.errors.join(' | ')}`);
  await dark.page.close();

  const reduced = await renderPage(browser, bundle, 'light', { width: 1280, height: 720 }, true);
  await reduced.page.screenshot({ path: path.join(OUT, `${prefix}-reduced-1280.png`) });
  entry.reduced = await measure(reduced.page);
  if (reduced.errors.length) failures.push(`${prefix}/reduced: console ${reduced.errors.join(' | ')}`);
  await reduced.page.close();

  const baseline = entry.runs.find((run) => run.viewportName === '1280');
  console.log(
    `${prefix}: cjk=${baseline.cjk} minFont=${baseline.minFont} scroll=${scroll} ratio=${baseline.screenRatio} ` +
      `overflowX=${baseline.overflowX} figure=${baseline.figure ? `${baseline.figure.width}x${baseline.figure.height}` : '-'} ` +
      `checks=${baseline.checks} errors=${baseline.consoleErrors.length}`
  );
  results.push(entry);
}

await browser.close();

const summary = {
  deck_id: Number(DECK_ID),
  title: deck.title,
  generated_at: new Date().toISOString(),
  expected_pages: deck.pages.length,
  ready_pages: pages.length,
  failed_pages: deck.pages.filter((page) => page.status === 'failed').map((page) => page.ordinal + 1),
  failures,
  pages: results
};
await fs.writeFile(path.join(OUT, 'P15_RESULTS.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\nready=${pages.length}/${deck.pages.length} failures=${failures.length}`);
console.log(`results=${path.join(OUT, 'P15_RESULTS.json')}`);
if (failures.length) {
  for (const failure of failures) console.log(` - ${failure}`);
  process.exitCode = 1;
}
