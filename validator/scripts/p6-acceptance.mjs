/**
 * P6 浏览器验收：页面 AI 助手的流式回答、引用、持久化、错误与移动端。
 *
 * 前置：
 *   1. 假 LLM：node scripts/fake-llm.mjs（默认 :9099）
 *   2. 独立 API：LLM_API_KEY=fake LLM_BASE_URL=http://host.docker.internal:9099/v1
 *      （监听 127.0.0.1:8001）
 *   3. 前端：VITE_PORT=5174 VITE_API_TARGET=http://127.0.0.1:8001 pnpm dev
 *   4. 来源夹具：python tests/fixtures/p6_seed.py（在 API 容器内执行）
 *
 * 运行：cd validator && node scripts/p6-acceptance.mjs
 * 环境变量：P6_BASE_URL/P6_API_URL/P6_USERNAME/P6_PASSWORD/P6_WORKSPACE_ID/
 *           P6_DECK_ID/P6_PAGE_ID
 * 输出：docs/pageref/p6-screenshots/*.png 与 docs/pageref/P6_RESULTS.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE_URL = process.env.P6_BASE_URL ?? "http://localhost:5174";
const API_URL = process.env.P6_API_URL ?? "http://127.0.0.1:8001";
const USERNAME = process.env.P6_USERNAME ?? "p5demo039180";
const PASSWORD = process.env.P6_PASSWORD ?? "Passw0rd!123";
const WORKSPACE_ID = process.env.P6_WORKSPACE_ID ?? "8";
const DECK_ID = process.env.P6_DECK_ID ?? "4";
const PAGE_ID = process.env.P6_PAGE_ID ?? "1";
const SHOT_DIR = path.join(ROOT, "docs", "pageref", "p6-screenshots");
const RESULT_FILE = path.join(ROOT, "docs", "pageref", "P6_RESULTS.json");
const QUESTION = "P6 验收：二分查找为什么是 O(log n)？";
const FAIL_QUESTION = "请触发失败测试";

const results = [];
const consoleErrors = [];
let messageRequests = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function check(condition, name, detail = "") {
  record(name, condition, condition ? detail : detail || "断言失败");
  return !!condition;
}

async function api(pathname, token, options = {}) {
  const response = await fetch(`${API_URL}/api${pathname}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`API ${pathname} -> ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function login() {
  const data = await api("/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  return data.token;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(fn, timeout = 12000, interval = 120) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(interval);
  }
  throw lastError ?? new Error("等待超时");
}

async function pageFrame(page) {
  return poll(() => page.frames().find((item) => item !== page.mainFrame()) ?? null);
}

async function frameReady(page) {
  await poll(async () => {
    const frame = await pageFrame(page);
    return frame.evaluate(
      () => document.documentElement.getAttribute("data-mp-ready") === "true",
    );
  });
  return pageFrame(page);
}

function isExpectedConsoleError(text) {
  return /Failed to load resource: the server responded with a status of 500/.test(text);
}

async function main() {
  await fs.mkdir(SHOT_DIR, { recursive: true });
  const token = await login();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !isExpectedConsoleError(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/pages\/\d+\/messages/.test(request.url())) {
      messageRequests += 1;
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => localStorage.setItem("mockfinal_token", value), token);
    await page.goto(`${BASE_URL}/workspace/${WORKSPACE_ID}/decks/${DECK_ID}/pages/${PAGE_ID}`, {
      waitUntil: "networkidle",
    });
    let frame = await frameReady(page);
    check(true, "阅读器页面就绪");

    await frame.evaluate(() => {
      const target = document.querySelector("p") ?? document.body;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const askButton = page.getByRole("button", { name: "问 AI" });
    await askButton.waitFor({ timeout: 5000 });
    await askButton.click();

    const dialog = page.getByRole("dialog", { name: "页面 AI 助手" });
    await dialog.waitFor({ timeout: 5000 });
    await dialog.getByText("引用上下文").waitFor({ timeout: 5000 });
    check(true, "选区桥接打开助手并显示引用上下文");

    const textarea = dialog.getByPlaceholder(/就当前页面提问/);
    check(await textarea.isEnabled(), "助手输入框已启用");
    const suggested = dialog.getByRole("button", { name: "为什么 mid 要向下取整？" });
    await suggested.waitFor({ timeout: 5000 });
    check(true, "页面建议问题可用");

    await textarea.fill(QUESTION);
    await textarea.press("Enter");
    const streamed = await dialog
      .getByText("回答中", { exact: true })
      .waitFor({ timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    check(streamed, "发送后进入流式回答中状态");

    const markdown = dialog.locator(".markdown-body").last();
    await markdown.getByText(/二分查找每次把搜索区间折半/).waitFor({ timeout: 20000 });
    await dialog.getByText("以上结论依据页面知识点与所选引用。").waitFor({ timeout: 20000 });
    check(true, "流式增量拼接为完整回答");
    const streamingCleared = await dialog
      .getByText("回答中", { exact: true })
      .waitFor({ state: "hidden", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check(streamingCleared, "回答结束后流式状态消失");
    check((await markdown.locator(".katex").count()) > 0, "回答中的公式已渲染为 KaTeX");

    const refLabel = "P6 页面助手演示资料.md · 闭区间写法与循环不变式";
    const refVisible = await dialog
      .getByText(refLabel)
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check(refVisible, "回答展示来源引用", refLabel);
    await shot(page, "01-assistant-answer-1280");

    const history = await api(`/decks/${DECK_ID}/pages/${PAGE_ID}/messages`, token);
    const userIndex = history.findIndex(
      (message) => message.role === "user" && message.content === QUESTION,
    );
    const answer = userIndex >= 0 ? history[userIndex + 1] : null;
    check(
      answer?.role === "assistant" && answer.status === "done" && answer.content.includes("O(\\log n)"),
      "回答已持久化为 done",
    );
    check(
      Array.isArray(answer?.context_refs) && answer.context_refs.length >= 1,
      "回答持久化来源引用",
      `refs=${answer?.context_refs?.length ?? 0}`,
    );

    await page.reload({ waitUntil: "networkidle" });
    frame = await frameReady(page);
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    await dialog.waitFor({ timeout: 5000 });
    await dialog.getByText(QUESTION).waitFor({ timeout: 8000 });
    await dialog.getByText("以上结论依据页面知识点与所选引用。").last().waitFor({ timeout: 8000 });
    check(true, "重新打开助手恢复历史对话");
    await shot(page, "02-assistant-history-1280");

    const textarea2 = dialog.getByPlaceholder(/就当前页面提问/);
    await textarea2.fill(FAIL_QUESTION);
    const before = messageRequests;
    await textarea2.press("Enter");
    await dialog.getByText("页面助手回答失败，请稍后重试").waitFor({ timeout: 15000 });
    check(messageRequests === before + 1, "失败问题触发一次请求");
    check((await dialog.getByText("回答失败", { exact: true }).count()) > 0, "失败消息有明确状态");
    check(
      await dialog.getByRole("button", { name: "重试" }).isVisible(),
      "失败后提供重试入口",
    );
    await shot(page, "03-assistant-error-1280");

    await textarea2.fill("");
    await textarea2.click();
    await textarea2.type("第一行");
    const countBeforeNewline = messageRequests;
    await textarea2.press("Shift+Enter");
    await textarea2.type("第二行");
    const value = await textarea2.inputValue();
    check(value.includes("\n"), "Shift+Enter 插入换行");
    check(messageRequests === countBeforeNewline, "Shift+Enter 不发送请求");
    await textarea2.fill("");

    await page.getByRole("button", { name: "关闭助手" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await wait(300);
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    await dialog.waitFor({ timeout: 5000 });
    await wait(400);
    const box = await dialog.boundingBox();
    check((box?.width ?? 0) >= 380, "移动端助手占满可用宽度", `width=${Math.round(box?.width ?? 0)}`);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    check(overflow.scrollWidth <= overflow.clientWidth, "移动端助手无横向溢出", JSON.stringify(overflow));
    await shot(page, "04-assistant-mobile-390");

    await textarea2.fill("请触发 XSS 测试");
    await textarea2.press("Enter");
    await dialog.getByText("安全测试").waitFor({ timeout: 15000 });
    await wait(500);
    const xssFlag = await page.evaluate(() => window.__p6_xss ?? null);
    check(xssFlag === null, "恶意脚本未执行");
    check((await dialog.locator("script").count()) === 0, "回答中不保留 script 标签");
    check(
      (await dialog.locator("img[onerror]").count()) === 0,
      "回答中不保留 onerror 属性",
    );
    check(
      (await dialog.locator('a[href^="javascript:"]').count()) === 0,
      "回答中不保留 javascript: 链接",
    );
    check(
      (await dialog.locator(".markdown-body strong").count()) > 0,
      "正常 Markdown（加粗）仍可渲染",
    );
    await shot(page, "05-assistant-xss-390");
  } finally {
    await browser.close();
  }
}

main()
  .then(async () => {
    const failed = results.filter((item) => !item.ok);
    const payload = {
      generated_at: new Date().toISOString(),
      base_url: BASE_URL,
      api_url: API_URL,
      username: USERNAME,
      deck_id: Number(DECK_ID),
      page_id: Number(PAGE_ID),
      checks: results,
      console_errors: consoleErrors,
      passed: results.length - failed.length,
      failed: failed.length,
      screenshots: SHOT_DIR,
    };
    await fs.writeFile(RESULT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    console.log(`\n${payload.passed} passed / ${payload.failed} failed`);
    if (consoleErrors.length) console.log("console errors:", consoleErrors);
    process.exit(failed.length || consoleErrors.length ? 1 : 0);
  })
  .catch(async (error) => {
    console.error(error);
    await fs.writeFile(
      RESULT_FILE,
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          base_url: BASE_URL,
          api_url: API_URL,
          checks: results,
          console_errors: consoleErrors,
          error: String(error?.stack ?? error),
          passed: results.filter((item) => item.ok).length,
          failed: results.filter((item) => !item.ok).length + 1,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    process.exit(1);
  });
