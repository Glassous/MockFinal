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
  scrollables: Array<{ selector: string; axis: string; overflow: number }>;
  unnamedInteractive: string[];
  h1Count: number;
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
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 1) {
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

    return {
      documentWidth: documentElement.scrollWidth,
      documentHeight: documentElement.scrollHeight,
      clientWidth: documentElement.clientWidth,
      clientHeight: documentElement.clientHeight,
      rootWidth: root ? root.scrollWidth : 0,
      rootHeight: root ? root.scrollHeight : 0,
      rootClientWidth: root ? root.clientWidth : 0,
      rootClientHeight: root ? root.clientHeight : 0,
      scrollables,
      unnamedInteractive,
      h1Count: document.querySelectorAll('h1').length
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

          const overflowX = metrics.documentWidth - metrics.clientWidth;
          const overflowY = metrics.documentHeight - metrics.clientHeight;
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

          for (const scrollable of metrics.scrollables.slice(0, 10)) {
            issues.push({
              severity: scrollSeverity,
              code: 'INTERNAL_SCROLL',
              message: `${label} 下存在可滚动的内部容器（${scrollable.axis} 轴溢出 ${scrollable.overflow}px），零滚动要求不允许`,
              selector: scrollable.selector,
              viewport: label
            });
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
