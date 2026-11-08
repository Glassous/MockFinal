/**
 * 设计实验室截图与基础测量。
 * 运行：node design_lab/build.mjs && cd validator && node scripts/design-lab-shoot.mjs
 * 输出：docs/pageref/design-lab/screenshots/*.png 与 results.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAB = path.join(ROOT, 'design_lab', 'out');
const SHOT_DIR = path.join(ROOT, 'docs', 'pageref', 'design-lab', 'screenshots');
const RESULTS = path.join(ROOT, 'docs', 'pageref', 'design-lab', 'results.json');

const THEMES = ['editorial', 'workbench', 'problem'];
const PAGES = ['cr-condition', 'residue-contour', 'laplace-ode'];
const VIEWPORTS = [
  { name: '1280', width: 1280, height: 720 },
  { name: '1440', width: 1440, height: 900 },
];

async function measure(page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.pg-page');
    const flowEl = document.querySelector('.pg-flow');
    const railEl = document.querySelector('.pg-rail');
    const figureEl = document.querySelector('[data-pg-figure]');
    const blocks = Array.from(document.querySelectorAll('[data-mp-block]'));
    const visibleBlocks = blocks.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    });
    const minFont = (() => {
      let min = Infinity;
      let sample = '';
      const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue?.trim();
        if (!text) continue;
        const el = walker.currentNode.parentElement;
        if (!el) continue;
        if (el.closest('math')) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        if (el.getClientRects().length === 0) continue;
        const size = Number.parseFloat(style.fontSize);
        if (size > 0 && size < min) {
          min = size;
          sample = text.slice(0, 18);
        }
      }
      return { px: Number.isFinite(min) ? min : 0, sample };
    })();
    const rect = pageEl.getBoundingClientRect();
    const figureRect = figureEl ? figureEl.getBoundingClientRect() : null;
    const flowRect = flowEl ? flowEl.getBoundingClientRect() : null;
    const railRect = railEl ? railEl.getBoundingClientRect() : null;
    const contentArea = flowRect ? flowRect.width * flowRect.height : rect.width * rect.height;
    const cjk = (pageEl.innerText.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
    return {
      theme: pageEl.getAttribute('data-pg-theme'),
      role: pageEl.getAttribute('data-pg-role'),
      scroll: pageEl.getAttribute('data-pg-scroll'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportsTall: document.documentElement.scrollHeight / window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      blocks: blocks.length,
      visibleBlocks: visibleBlocks.length,
      cjk,
      minFont,
      figure: figureRect
        ? {
            width: Math.round(figureRect.width),
            height: Math.round(figureRect.height),
            shareOfContent: contentArea > 0 ? Number(((figureRect.width * figureRect.height) / contentArea).toFixed(3)) : 0,
          }
        : null,
      flowHeight: flowRect ? Math.round(flowRect.height) : null,
      railWidth: railRect ? Math.round(railRect.width) : null,
      contentBottom: flowRect ? Math.round(flowRect.bottom + window.scrollY) : null,
    };
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
}

async function shotFull(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-full.png`), fullPage: true });
}

await fs.mkdir(SHOT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const theme of THEMES) {
  for (const pageName of PAGES) {
    const file = path.join(LAB, theme, `${pageName}.html`);
    const url = pathToFileURL(file).href;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-mp-ready="true"]', { timeout: 10000 });
    const initial = await measure(page);
    await shot(page, `${theme}-${pageName}-1280`);
    await shotFull(page, `${theme}-${pageName}-1280`);

    if (await page.locator('[data-pg-action="figure-next"]').count()) {
      await page.locator('[data-pg-action="figure-next"]').first().click();
      await page.waitForTimeout(60);
      await shot(page, `${theme}-${pageName}-state2-1280`);
    }
    if (await page.locator('[data-pg-option]').count()) {
      await page.locator('[data-pg-option]').first().click();
      await page.waitForTimeout(60);
      await shot(page, `${theme}-${pageName}-check-1280`);
      const checkState = await page.locator('[data-pg-check]').first().getAttribute('data-pg-check-state');
      if (checkState !== 'answered') consoleErrors.push('check did not enter answered state');
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    await shot(page, `${theme}-${pageName}-1440`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    await shot(page, `${theme}-${pageName}-390`);
    await shotFull(page, `${theme}-${pageName}-390`);
    const mobile = await measure(page);

    const dark = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await dark.goto(pathToFileURL(path.join(LAB, theme, `${pageName}--dark.html`)).href, { waitUntil: 'load' });
    await dark.waitForSelector('[data-mp-ready="true"]', { timeout: 10000 });
    await shot(dark, `${theme}-${pageName}-dark-1280`);
    await dark.close();

    const reduced = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await reduced.emulateMedia({ reducedMotion: 'reduce' });
    await reduced.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await reduced.waitForSelector('[data-mp-ready="true"]', { timeout: 10000 });
    await reduced.evaluate(() => window.scrollTo(0, 0));
    await shot(reduced, `${theme}-${pageName}-reduced-1280`);
    await reduced.close();

    results.push({ theme, page: pageName, initial, mobile, consoleErrors });
    console.log(`${theme}/${pageName}: minFont=${initial.minFont.px} cjk=${initial.cjk} scroll=${initial.scroll} viewports=${initial.viewportsTall.toFixed(2)} overflowX=${initial.horizontalOverflow} figure=${initial.figure ? initial.figure.shareOfContent : '-'} errors=${consoleErrors.length}`);
    await page.close();
  }
}

await browser.close();
await fs.writeFile(RESULTS, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
console.log(`\nwrote ${RESULTS}`);
if (results.some((entry) => entry.consoleErrors.length > 0)) {
  console.log('console errors present');
}
