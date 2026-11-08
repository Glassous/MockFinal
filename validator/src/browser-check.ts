/**
 * Playwright 浏览器检查（PAGE_CONTRACT §8.4、§9.3、§10.2；Plan §7.6）
 *
 * 每个视口使用新的 browser context；所有非 data:/blob: 请求一律 abort 并记 NETWORK_REQUEST。
 * 页面代码只在本容器的 Chromium 中执行，校验结束立即关闭 context。
 */
import { randomBytes } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { loadRuntimeSource, loadShellModule } from './shared-shell.js';
import {
  MAX_SCREENSHOT_BYTES,
  READY_TIMEOUT_MS,
  SMOKE_TIMEOUT_MS,
  viewportLabel,
  type Bundle,
  type Issue,
  type Screenshot,
  type Viewport
} from './types.js';

export interface BrowserCheckInput {
  bundle: Bundle;
  viewports: readonly Viewport[];
  screenshot: boolean;
}

export interface BrowserCheckResult {
  issues: Issue[];
  screenshots: Screenshot[];
}

/** Chromium 不可用（未安装或无法启动）时抛出，由 server 映射为 503。 */
export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserUnavailableError';
  }
}

interface PageMetrics {
  documentWidth: number;
  documentHeight: number;
  clientWidth: number;
  clientHeight: number;
  rootWidth: number;
  rootHeight: number;
  rootClientWidth: number;
  rootClientHeight: number;
  pageScrollHeight: number;
  pageClientHeight: number;
  scrollables: Array<{ selector: string; axis: string; overflow: number }>;
  unnamedInteractive: string[];
  h1Count: number;
  minFontSize: number;
  cjkChars: number;
  visibleCjkChars: number;
  totalBlocks: number;
  visibleBlocks: number;
  clippedBlocks: Array<{ selector: string; overflowX: number; overflowY: number }>;
  documentOverflowY: string;
  figureWidth: number;
  figureShare: number;
  contentBottom: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function collectMetrics(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const root = document.getElementById('mp-root');
    const scrollables: Array<{ selector: string; axis: string; overflow: number }> = [];
    const unnamedInteractive: string[] = [];

    const describe = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      const id = element.getAttribute('id');
      const cls = (element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean)[0];
      let text = `${tag}${id ? `#${id}` : ''}${cls ? `.${cls}` : ''}`;
      const action = element.getAttribute('data-mp-action');
      if (action) text += `[data-mp-action="${action}"]`;
      return text.slice(0, 120);
    };

    const isVisible = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    for (const element of Array.from(document.querySelectorAll('body *'))) {
      if (!isVisible(element)) continue;
      const style = window.getComputedStyle(element);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && element.scrollHeight > element.clientHeight + 1) {
        scrollables.push({
          selector: describe(element),
          axis: 'y',
          overflow: element.scrollHeight - element.clientHeight
        });
      }
      const formulaScroller = element.classList.contains('pg-formula');
      if (!formulaScroller && (style.overflowX === 'auto' || style.overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 1) {
        scrollables.push({
          selector: describe(element),
          axis: 'x',
          overflow: element.scrollWidth - element.clientWidth
        });
      }
    }

    for (const element of Array.from(document.querySelectorAll('button, a[href], [role="button"], input, select, textarea'))) {
      if (!isVisible(element)) continue;
      const label =
        element.getAttribute('aria-label') ??
        element.getAttribute('title') ??
        element.getAttribute('alt') ??
        element.textContent ??
        '';
      const value = element instanceof HTMLInputElement ? element.value : '';
      if (label.trim() === '' && value.trim() === '') {
        unnamedInteractive.push(describe(element));
      }
    }

    const blocks = root ? Array.from(root.querySelectorAll('[data-mp-block]')) : [];
    const clippedBlocks: Array<{ selector: string; overflowX: number; overflowY: number }> = [];
    const isPageKit = Boolean(root?.querySelector('.pg-page'));
    for (const block of blocks) {
      if (!isVisible(block)) continue;
      const blockStyle = window.getComputedStyle(block);
      // 2.0 的块默认 overflow:visible；子元素超出几像素只是可见溢出，不是裁剪。
      // 只有块自身建立了裁剪/滚动容器时才按 scrollHeight 判定。
      const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(blockStyle.overflowX);
      const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(blockStyle.overflowY);
      if (isPageKit && !clipsX && !clipsY) continue;
      const overflowX = block.scrollWidth - block.clientWidth;
      const overflowY = block.scrollHeight - block.clientHeight;
      if (overflowX > 1 || overflowY > 1) {
        clippedBlocks.push({
          selector: describe(block),
          overflowX: Math.max(0, overflowX),
          overflowY: Math.max(0, overflowY)
        });
      }
    }

    let minFontSize = 0;
    if (root) {
      for (const element of Array.from(root.querySelectorAll('*'))) {
        if (!isVisible(element)) continue;
        if (element.closest('math')) continue;
        const hasText = Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== ''
        );
        if (!hasText) continue;
        const size = Number.parseFloat(window.getComputedStyle(element).fontSize);
        if (Number.isFinite(size) && size > 0 && (minFontSize === 0 || size < minFontSize)) {
          minFontSize = size;
        }
      }
    }
    const countCjk = (text: string): number => (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const totalCjk = root ? countCjk(root.textContent ?? '') : 0;
    const visibleCjk = root ? countCjk(root.innerText ?? '') : 0;
    const flowElement = document.querySelector('.pg-flow');
    const pageElement = document.querySelector('.pg-page');
    const figureElement = document.querySelector('[data-pg-figure]');
    const flowRect = flowElement ? flowElement.getBoundingClientRect() : null;
    const figureRect = figureElement ? figureElement.getBoundingClientRect() : null;
    const contentArea = flowRect ? flowRect.width * flowRect.height : 0;

    return {
      documentWidth: documentElement.scrollWidth,
      documentHeight: documentElement.scrollHeight,
      clientWidth: documentElement.clientWidth,
      clientHeight: documentElement.clientHeight,
      rootWidth: root ? root.scrollWidth : 0,
      rootHeight: root ? root.scrollHeight : 0,
      rootClientWidth: root ? root.clientWidth : 0,
      rootClientHeight: root ? root.clientHeight : 0,
      pageScrollHeight: pageElement ? pageElement.scrollHeight : 0,
      pageClientHeight: pageElement ? pageElement.clientHeight : 0,
      scrollables,
      unnamedInteractive,
      h1Count: document.querySelectorAll('h1').length,
      minFontSize,
      cjkChars: totalCjk,
      visibleCjkChars: visibleCjk,
      totalBlocks: blocks.length,
      visibleBlocks: blocks.filter((block) => isVisible(block)).length,
      clippedBlocks,
      documentOverflowY: window.getComputedStyle(documentElement).overflowY,
      figureWidth: figureRect ? Math.round(figureRect.width) : 0,
      figureShare: figureRect && contentArea > 0 ? Number(((figureRect.width * figureRect.height) / contentArea).toFixed(3)) : 0,
      contentBottom: flowRect ? Math.round(flowRect.bottom + window.scrollY) : 0
    };
  });
}

interface SmokeOutcome {
  ok: boolean;
  message: string;
}

async function runSmokeStep(page: Page, rawInteraction: unknown, index: number): Promise<SmokeOutcome> {
  const interaction =
    rawInteraction && typeof rawInteraction === 'object'
      ? (rawInteraction as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const type = typeof interaction.type === 'string' ? interaction.type : '';
  const rawSmoke = interaction.smoke;
  if (!rawSmoke || typeof rawSmoke !== 'object') {
    if (type === 'none') return { ok: true, message: '' };
    return { ok: false, message: `interactions[${index}] 缺少 smoke，无法执行冒烟` };
  }
  const smoke = rawSmoke as Record<string, unknown>;
  const action = String(smoke.action ?? '');
  const selector = typeof smoke.selector === 'string' ? smoke.selector : '';
  const expect = typeof smoke.expect === 'string' ? smoke.expect : '';
  const value = typeof smoke.value === 'string' ? smoke.value : '';
  if (!selector || !expect) {
    return { ok: false, message: `interactions[${index}] 的 smoke.selector / smoke.expect 不完整` };
  }
  try {
    const locator = page.locator(selector).first();
    const count = await locator.count();
    if (count === 0) {
      return { ok: false, message: `冒烟选择器 ${selector} 未匹配到元素` };
    }
    if (action === 'input') {
      await locator.fill(value, { timeout: SMOKE_TIMEOUT_MS });
    } else {
      // click 与 step 都视为点击（step 由页面自行推进状态）
      await locator.click({ timeout: SMOKE_TIMEOUT_MS });
    }
    await page.waitForSelector(expect, { timeout: SMOKE_TIMEOUT_MS, state: 'attached' });
    return { ok: true, message: '' };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return {
      ok: false,
      message: `交互 ${String(interaction.id ?? index)} 的冒烟步骤失败：${detail?.slice(0, 200) ?? '未知错误'}`
    };
  }
}

function base64Bytes(base64: string): number {
  return Buffer.byteLength(base64, 'base64');
}

async function capture(page: Page, label: string): Promise<{ screenshot?: Screenshot; warning?: Issue }> {
  try {
    const png = await page.screenshot({ type: 'png' });
    const pngBase64 = png.toString('base64');
    if (base64Bytes(pngBase64) <= MAX_SCREENSHOT_BYTES) {
      return { screenshot: { viewport: label, data_uri: `data:image/png;base64,${pngBase64}` } };
    }
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 60 });
    const jpegBase64 = jpeg.toString('base64');
    if (base64Bytes(jpegBase64) <= MAX_SCREENSHOT_BYTES) {
      return { screenshot: { viewport: label, data_uri: `data:image/jpeg;base64,${jpegBase64}` } };
    }
    return {
      warning: {
        severity: 'warning',
        code: 'SCREENSHOT_OMITTED',
        message: `${label} 截图压缩后仍超过 512 KB，已省略`,
        viewport: label
      }
    };
  } catch (error) {
    return {
      warning: {
        severity: 'warning',
        code: 'SCREENSHOT_OMITTED',
        message: `${label} 截图失败：${error instanceof Error ? error.message : String(error)}`,
        viewport: label
      }
    };
  }
}

/**
 * 执行浏览器检查。Chromium 启动失败抛 BrowserUnavailableError；
 * 页面自身的问题一律转成 Issue，不向调用方抛异常。
 */
export async function browserCheck(input: BrowserCheckInput): Promise<BrowserCheckResult> {
  const { bundle, viewports, screenshot } = input;
  const shellModule = await loadShellModule();
  const runtimeSource = loadRuntimeSource();

  const issues: Issue[] = [];
  const screenshots: Screenshot[] = [];
  const seenNetwork = new Set<string>();
  const seenConsole = new Set<string>();

  const manifestRecord = asRecord(bundle.manifest as unknown);
  const isPageKit2 = manifestRecord?.design_system === '2.0';
  const teachingRecord = asRecord(manifestRecord?.teaching);
  const flowMode = isPageKit2 && teachingRecord?.scroll === 'flow';
  const pageRole = typeof teachingRecord?.role === 'string' ? teachingRecord.role : '';
  const roleMinCjk: Record<string, number> = {
    concept: 300,
    mechanism: 320,
    worked_example: 340,
    practice: 340,
    compare: 320,
    summary: 240
  };

  let browser: Browser;
  try {
    browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  } catch (error) {
    throw new BrowserUnavailableError(
      `无法启动 Chromium：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    );
  }

  try {
    let a11yChecked = false;
    for (let viewportIndex = 0; viewportIndex < viewports.length; viewportIndex += 1) {
      const viewport = viewports[viewportIndex] as Viewport;
      const label = viewportLabel(viewport);
      // 1024×768 是“缩放提示”场景，零滚动问题降级为 warning（PAGE_CONTRACT §9.2、O-4）
      const scrollSeverity: 'error' | 'warning' =
        viewport.width === 1024 && viewport.height === 768 ? 'warning' : 'error';
      const channel = randomBytes(16).toString('hex');
      let context: BrowserContext | null = null;
      let page: Page | null = null;

      try {
        context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          bypassCSP: false
        });

        await context.addInitScript(() => {
          const store: string[] = [];
          Object.defineProperty(window, '__mpUnhandledRejections', {
            value: store,
            writable: false,
            configurable: false,
            enumerable: false
          });
          window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            const message = reason && reason.message ? String(reason.message) : String(reason ?? '未处理的 Promise 拒绝');
            store.push(message);
          });
        });

        const blocked: string[] = [];
        await context.route('**/*', async (route) => {
          const url = route.request().url();
          if (url.startsWith('data:') || url.startsWith('blob:')) {
            await route.continue();
            return;
          }
          blocked.push(url);
          await route.abort();
        });

        page = await context.newPage();
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          const text = message.text();
          const key = `${label}|${text}`;
          if (seenConsole.has(key)) return;
          seenConsole.add(key);
          issues.push({
            severity: 'error',
            code: 'CONSOLE_ERROR',
            message: `控制台 error：${text.slice(0, 300)}`,
            viewport: label
          });
        });
        page.on('pageerror', (error) => {
          const key = `${label}|pageerror|${error.message}`;
          if (seenConsole.has(key)) return;
          seenConsole.add(key);
          issues.push({
            severity: 'error',
            code: 'CONSOLE_ERROR',
            message: `未捕获异常：${error.message.slice(0, 300)}`,
            viewport: label
          });
        });
        page.on('requestfailed', (request) => {
          const url = request.url();
          if (url.startsWith('data:') || url.startsWith('blob:')) return;
          if (seenNetwork.has(url)) return;
          seenNetwork.add(url);
          issues.push({
            severity: 'error',
            code: 'NETWORK_REQUEST',
            message: `出现非 data:/blob: 请求（已阻断）：${url.slice(0, 200)}`,
            viewport: label
          });
        });

        let shell: string;
        try {
          shell = shellModule.buildShell({ bundle, runtimeSource, channel, theme: 'light' });
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code)
              : 'BUNDLE_SCHEMA_INVALID';
          issues.push({
            severity: 'error',
            code,
            message: `shell 组装失败：${error instanceof Error ? error.message : String(error)}`
          });
          break;
        }

        await page.setContent(shell, { waitUntil: 'load', timeout: READY_TIMEOUT_MS + 5_000 });

        let ready = true;
        try {
          await page.waitForSelector('html[data-mp-ready="true"]', {
            timeout: READY_TIMEOUT_MS,
            state: 'attached'
          });
        } catch {
          ready = false;
          issues.push({
            severity: 'error',
            code: 'PAGE_NOT_READY',
            message: `页面未在 ${Math.round(READY_TIMEOUT_MS / 1000)} 秒内调用 MockFinal.ready`,
            viewport: label
          });
        }

        if (ready) {
          // 等两帧，确保 ready 后的首次布局与字体度量完成
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          );
          const metrics = await collectMetrics(page);

          const isMobile = viewport.width < 768;
          const overflowX = metrics.documentWidth - metrics.clientWidth;
          const overflowY = metrics.documentHeight - metrics.clientHeight;
          if (isMobile) {
            // 移动端允许纵向滚动，但禁止横向溢出与“被 overflow:hidden 锁死”
            if (overflowX > 1) {
              issues.push({
                severity: 'error',
                code: 'MOBILE_HORIZONTAL_OVERFLOW',
                message: `${label} 下移动端横向溢出 ${overflowX}px`,
                selector: 'html',
                viewport: label
              });
            }
            if (overflowY > 1 && metrics.documentOverflowY === 'hidden') {
              issues.push({
                severity: 'error',
                code: 'MOBILE_SCROLL_BLOCKED',
                message: `${label} 下内容高度超出视口但页面禁止纵向滚动，移动端无法阅读`,
                selector: 'html',
                viewport: label
              });
            }
            for (const scrollable of metrics.scrollables.filter((item) => item.axis === 'x').slice(0, 10)) {
              issues.push({
                severity: 'error',
                code: 'MOBILE_HORIZONTAL_OVERFLOW',
                message: `${label} 下内部容器横向溢出 ${scrollable.overflow}px`,
                selector: scrollable.selector,
                viewport: label
              });
            }
          } else if (flowMode) {
            // flow 页允许页面本体纵向滚动；横向、内部滚动与“被 hidden 锁死”仍不允许。
            if (overflowX > 1) {
              issues.push({
                severity: 'error',
                code: 'SCROLL_POLICY_VIOLATION',
                message: `${label} 下 flow 页横向溢出 ${overflowX}px`,
                selector: 'html',
                viewport: label
              });
            }
            if (overflowY > 1 && metrics.documentOverflowY === 'hidden') {
              issues.push({
                severity: 'error',
                code: 'SCROLL_POLICY_VIOLATION',
                message: `${label} 下 flow 页内容超出视口但页面禁止纵向滚动`,
                selector: 'html',
                viewport: label
              });
            }
            if (metrics.documentHeight > 2200) {
              issues.push({
                severity: 'error',
                code: 'FLOW_PAGE_TOO_LONG',
                message: `${label} 下 flow 页总高 ${metrics.documentHeight}px，超过 2200px 上限；请拆页或压缩`,
                viewport: label
              });
            } else if (metrics.documentHeight > 2000) {
              issues.push({
                severity: 'warning',
                code: 'FLOW_PAGE_TOO_LONG',
                message: `${label} 下 flow 页总高 ${metrics.documentHeight}px，超过建议值 2000px`,
                viewport: label
              });
            }
            const rootOverflowX = metrics.rootWidth - metrics.rootClientWidth;
            const rootOverflowY = metrics.rootHeight - metrics.rootClientHeight;
            if (rootOverflowX > 1 || rootOverflowY > 1) {
              issues.push({
                severity: 'error',
                code: 'SCROLL_POLICY_VIOLATION',
                message: `${label} 下 #mp-root 溢出（横向 ${Math.max(0, rootOverflowX)}px / 纵向 ${Math.max(0, rootOverflowY)}px）`,
                selector: '#mp-root',
                viewport: label
              });
            }
            for (const scrollable of metrics.scrollables.slice(0, 10)) {
              issues.push({
                severity: 'error',
                code: 'INTERNAL_SCROLL',
                message: `${label} 下存在可滚动的内部容器（${scrollable.axis} 轴溢出 ${scrollable.overflow}px），flow 页也不允许`,
                selector: scrollable.selector,
                viewport: label
              });
            }
          } else {
            if (overflowX > 1) {
              issues.push({
                severity: scrollSeverity,
                code: 'ZERO_SCROLL_OVERFLOW',
                message: `${label} 下页面横向溢出 ${overflowX}px`,
                selector: 'html',
                viewport: label
              });
            }
            if (overflowY > 1) {
              issues.push({
                severity: scrollSeverity,
                code: 'ZERO_SCROLL_OVERFLOW',
                message: `${label} 下页面纵向溢出 ${overflowY}px`,
                selector: 'html',
                viewport: label
              });
            }
            const rootOverflowX = metrics.rootWidth - metrics.rootClientWidth;
            const rootOverflowY = metrics.rootHeight - metrics.rootClientHeight;
            if (rootOverflowX > 1) {
              issues.push({
                severity: scrollSeverity,
                code: 'ZERO_SCROLL_OVERFLOW',
                message: `${label} 下 #mp-root 横向溢出 ${rootOverflowX}px`,
                selector: '#mp-root',
                viewport: label
              });
            }
            if (rootOverflowY > 1) {
              issues.push({
                severity: scrollSeverity,
                code: 'ZERO_SCROLL_OVERFLOW',
                message: `${label} 下 #mp-root 纵向溢出 ${rootOverflowY}px`,
                selector: '#mp-root',
                viewport: label
              });
            }
            if (isPageKit2) {
              const pageOverflowY = metrics.pageScrollHeight - metrics.pageClientHeight;
              if (pageOverflowY > 1) {
                issues.push({
                  severity: 'error',
                  code: 'CONTENT_CLIPPED',
                  message: `${label} 下 fit 页内容超出单屏 ${pageOverflowY}px，底部内容会被裁剪；请删减内容或改用 flow 角色`,
                  selector: '.pg-page',
                  viewport: label
                });
              }
            }

            for (const scrollable of metrics.scrollables.slice(0, 10)) {
              issues.push({
                severity: scrollSeverity,
                code: 'INTERNAL_SCROLL',
                message: `${label} 下存在可滚动的内部容器（${scrollable.axis} 轴溢出 ${scrollable.overflow}px），零滚动要求不允许`,
                selector: scrollable.selector,
                viewport: label
              });
            }
          }

          if (viewportIndex === 0) {
            if (isPageKit2) {
              const minCjk = roleMinCjk[pageRole] ?? 0;
              if (minCjk > 0 && metrics.cjkChars < minCjk) {
                issues.push({
                  severity: 'error',
                  code: 'CONTENT_SPARSE',
                  message: `页面正文约 ${metrics.cjkChars} 个汉字，低于 ${pageRole} 页 ${minCjk} 字的内容下限`,
                  viewport: label
                });
              }
              if (metrics.figureWidth > 0) {
                if (flowMode && metrics.figureWidth > 380) {
                  issues.push({
                    severity: 'error',
                    code: 'FIGURE_TOO_LARGE',
                    message: `flow 页图示宽 ${metrics.figureWidth}px，超过 380px 上限（建议 ≤360px）`,
                    viewport: label
                  });
                } else if (flowMode && metrics.figureWidth > 360) {
                  issues.push({
                    severity: 'warning',
                    code: 'FIGURE_TOO_LARGE',
                    message: `flow 页图示宽 ${metrics.figureWidth}px，建议 ≤360px`,
                    viewport: label
                  });
                }
                if (!flowMode && metrics.figureShare > 0.45) {
                  issues.push({
                    severity: 'error',
                    code: 'FIGURE_TOO_LARGE',
                    message: `fit 页图示占内容区 ${(metrics.figureShare * 100).toFixed(0)}%，超过 45% 上限`,
                    viewport: label
                  });
                } else if (!flowMode && metrics.figureShare > 0.35) {
                  issues.push({
                    severity: 'warning',
                    code: 'FIGURE_TOO_LARGE',
                    message: `fit 页图示占内容区 ${(metrics.figureShare * 100).toFixed(0)}%，建议 ≤35%`,
                    viewport: label
                  });
                }
              }
              if (!flowMode && metrics.contentBottom > 0 && metrics.contentBottom < viewport.height * 0.65) {
                issues.push({
                  severity: 'warning',
                  code: 'WHITESPACE_EXCESS',
                  message: `fit 页正文底部仅到视口 ${(metrics.contentBottom / viewport.height * 100).toFixed(0)}%，留白过多`,
                  viewport: label
                });
              }
            } else {
              if (metrics.cjkChars > 700) {
                issues.push({
                  severity: 'error',
                  code: 'CONTENT_BUDGET_EXCEEDED',
                  message: `页面正文约 ${metrics.cjkChars} 个汉字，超过单页 700 字硬上限；请拆页或改用渐进式披露`,
                  viewport: label
                });
              } else if (metrics.visibleCjkChars > 500) {
                issues.push({
                  severity: 'warning',
                  code: 'CONTENT_LAYER_WARNING',
                  message: `单层可见正文约 ${metrics.visibleCjkChars} 个汉字，建议 ≤500；超出部分用步骤器/折叠承载`,
                  viewport: label
                });
              }
              if (metrics.totalBlocks > 8) {
                issues.push({
                  severity: 'warning',
                  code: 'CONTENT_BLOCKS_WARNING',
                  message: `页内总块数 ${metrics.totalBlocks} 超过 8，建议拆页`,
                  viewport: label
                });
              } else if (metrics.visibleBlocks > 6) {
                issues.push({
                  severity: 'warning',
                  code: 'CONTENT_BLOCKS_WARNING',
                  message: `单层可见块 ${metrics.visibleBlocks} 超过 6，建议分层揭示`,
                  viewport: label
                });
              }
            }
            // 2.0 标签字号下限即 12px，12px 视为合规；1.0 仍保留 12px 建议线。
            const minFontError = isPageKit2 ? 12 : 11;
            if (metrics.minFontSize > 0 && metrics.minFontSize < minFontError) {
              issues.push({
                severity: 'error',
                code: 'MIN_FONT_TOO_SMALL',
                message: `可见文本最小字号 ${metrics.minFontSize.toFixed(1)}px，低于 ${minFontError}px 安全下限`,
                viewport: label
              });
            } else if (!isPageKit2 && metrics.minFontSize > 0 && metrics.minFontSize < 12) {
              issues.push({
                severity: 'warning',
                code: 'MIN_FONT_WARNING',
                message: `可见文本最小字号 ${metrics.minFontSize.toFixed(1)}px，建议 ≥12px`,
                viewport: label
              });
            }
            for (const block of metrics.clippedBlocks.slice(0, 10)) {
              issues.push({
                severity: 'error',
                code: 'CONTENT_CLIPPED',
                message: `内容块被裁剪（横向 ${block.overflowX}px / 纵向 ${block.overflowY}px），请减少内容或改用分层`,
                selector: block.selector,
                viewport: label
              });
            }
          }

          if (!a11yChecked) {
            a11yChecked = true;
            if (metrics.h1Count === 0) {
              issues.push({
                severity: 'warning',
                code: 'A11Y_WARNING',
                message: '页面缺少 h1 标题，标题层级不利于读屏与跳转'
              });
            }
            for (const selector of metrics.unnamedInteractive.slice(0, 10)) {
              issues.push({
                severity: 'warning',
                code: 'A11Y_WARNING',
                message: `交互元素缺少可访问名称（aria-label 或文本）：${selector}`,
                selector
              });
            }
          }

          if (screenshot) {
            const captured = await capture(page, label);
            if (captured.screenshot) screenshots.push(captured.screenshot);
            if (captured.warning) issues.push(captured.warning);
          }

          if (viewportIndex === 0) {
            const interactions = Array.isArray(bundle.manifest?.interactions) ? bundle.manifest.interactions : [];
            for (let index = 0; index < interactions.length; index += 1) {
              const outcome = await runSmokeStep(page, interactions[index], index);
              if (!outcome.ok) {
                issues.push({
                  severity: 'error',
                  code: 'SMOKE_FAILED',
                  message: outcome.message,
                  viewport: label
                });
              }
            }

            if (interactions.length > 0) {
              // 冒烟交互后复测：渐进式披露展开的内容不得破坏零滚动或造成裁剪
              const afterSmoke = await collectMetrics(page);
              if (!isMobile) {
                const overflowXAfter = afterSmoke.documentWidth - afterSmoke.clientWidth;
                const overflowYAfter = afterSmoke.documentHeight - afterSmoke.clientHeight;
                if (overflowXAfter > 1 || (!flowMode && overflowYAfter > 1)) {
                  issues.push({
                    severity: 'error',
                    code: flowMode ? 'SCROLL_POLICY_VIOLATION' : 'ZERO_SCROLL_OVERFLOW',
                    message: flowMode
                      ? `${label} 下冒烟交互后 flow 页横向溢出 ${Math.max(0, overflowXAfter)}px`
                      : `${label} 下冒烟交互后页面溢出（横向 ${Math.max(0, overflowXAfter)}px / 纵向 ${Math.max(0, overflowYAfter)}px），交互展开后仍须零滚动`,
                    selector: 'html',
                    viewport: label
                  });
                }
                const rootAfterX = afterSmoke.rootWidth - afterSmoke.rootClientWidth;
                const rootAfterY = afterSmoke.rootHeight - afterSmoke.rootClientHeight;
                if (rootAfterX > 1 || (!flowMode && rootAfterY > 1)) {
                  issues.push({
                    severity: 'error',
                    code: flowMode ? 'SCROLL_POLICY_VIOLATION' : 'ZERO_SCROLL_OVERFLOW',
                    message: `${label} 下冒烟交互后 #mp-root 溢出（横向 ${Math.max(0, rootAfterX)}px / 纵向 ${Math.max(0, rootAfterY)}px）`,
                    selector: '#mp-root',
                    viewport: label
                  });
                }
              }
              for (const block of afterSmoke.clippedBlocks.slice(0, 10)) {
                issues.push({
                  severity: 'error',
                  code: 'CONTENT_CLIPPED',
                  message: `冒烟交互后内容块被裁剪（横向 ${block.overflowX}px / 纵向 ${block.overflowY}px），请减少内容或改用分层`,
                  selector: block.selector,
                  viewport: label
                });
              }
              const afterMinFont = isPageKit2 ? 12 : 11;
              if (afterSmoke.minFontSize > 0 && afterSmoke.minFontSize < afterMinFont) {
                issues.push({
                  severity: 'error',
                  code: 'MIN_FONT_TOO_SMALL',
                  message: `冒烟交互后可见文本最小字号 ${afterSmoke.minFontSize.toFixed(1)}px，低于 ${afterMinFont}px 安全下限`,
                  viewport: label
                });
              }
            }
          }
        }

        const rejections = (await page.evaluate(() => {
          const store = (window as unknown as { __mpUnhandledRejections?: string[] }).__mpUnhandledRejections;
          return Array.isArray(store) ? store.slice(0, 10) : [];
        })) as string[];
        for (const rejection of rejections) {
          const key = `${label}|rejection|${rejection}`;
          if (seenConsole.has(key)) continue;
          seenConsole.add(key);
          issues.push({
            severity: 'error',
            code: 'CONSOLE_ERROR',
            message: `未处理的 Promise 拒绝：${String(rejection).slice(0, 300)}`,
            viewport: label
          });
        }

        if (blocked.length > 0) {
          for (const url of blocked) {
            if (seenNetwork.has(url)) continue;
            seenNetwork.add(url);
            issues.push({
              severity: 'error',
              code: 'NETWORK_REQUEST',
              message: `出现非 data:/blob: 请求（已阻断）：${url.slice(0, 200)}`,
              viewport: label
            });
          }
        }
      } catch (error) {
        issues.push({
          severity: 'error',
          code: 'BROWSER_CHECK_FAILED',
          message: `${label} 浏览器检查异常：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
          viewport: label
        });
      } finally {
        if (context) await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return { issues, screenshots };
}
