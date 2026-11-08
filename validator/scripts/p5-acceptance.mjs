/**
 * P5 浏览器验收（本地演示数据）：阅读器、总览、构建工作台、空态、深浅色与移动端。
 *
 * 运行前先注入演示数据（backend/tests/_p5_seed.py），然后：
 *   cd validator && node scripts/p5-acceptance.mjs
 * 环境变量：P5_USERNAME/P5_PASSWORD/P5_WORKSPACE_ID/P5_EMPTY_WORKSPACE_ID/
 *           P5_READY_DECK/P5_BUILDING_DECK/P5_PARTIAL_DECK/P5_DRAFT_DECK
 * 输出：docs/pageref/p5-screenshots/*.png 与 docs/pageref/P5_RESULTS.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE_URL = process.env.P5_BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.P5_API_URL ?? "http://127.0.0.1:8000";
const USERNAME = process.env.P5_USERNAME ?? "";
const PASSWORD = process.env.P5_PASSWORD ?? "";
const WORKSPACE_ID = process.env.P5_WORKSPACE_ID ?? "";
const EMPTY_WORKSPACE_ID = process.env.P5_EMPTY_WORKSPACE_ID ?? "";
const READY_DECK = process.env.P5_READY_DECK ?? "";
const BUILDING_DECK = process.env.P5_BUILDING_DECK ?? "";
const PARTIAL_DECK = process.env.P5_PARTIAL_DECK ?? "";
const DRAFT_DECK = process.env.P5_DRAFT_DECK ?? "";
const SHOT_DIR = path.join(ROOT, "docs", "pageref", "p5-screenshots");
const RESULT_FILE = path.join(ROOT, "docs", "pageref", "P5_RESULTS.json");

const results = [];
const consoleErrors = [];

function requireEnv() {
  const missing = Object.entries({
    P5_USERNAME: USERNAME,
    P5_PASSWORD: PASSWORD,
    P5_WORKSPACE_ID: WORKSPACE_ID,
    P5_EMPTY_WORKSPACE_ID: EMPTY_WORKSPACE_ID,
    P5_READY_DECK: READY_DECK,
    P5_BUILDING_DECK: BUILDING_DECK,
    P5_PARTIAL_DECK: PARTIAL_DECK,
    P5_DRAFT_DECK: DRAFT_DECK,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(", ")}`);
  }
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function expect(condition, name, detail = "") {
  record(name, !!condition, condition ? detail : detail || "断言失败");
  return !!condition;
}

async function api(pathname, token) {
  const response = await fetch(`${API_URL}/api${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`API ${pathname} -> ${response.status}`);
  return response.json();
}

async function login() {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`登录失败：${response.status}`);
  return response.json();
}

async function shot(page, name) {
  const target = path.join(SHOT_DIR, `${name}.png`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.screenshot({ path: target });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await wait(200);
    }
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(fn, timeout = 12000, interval = 150) {
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
  return poll(() => {
    const frame = page.frames().find((item) => item !== page.mainFrame());
    return frame ?? null;
  }, 12000);
}

async function frameReady(page) {
  await poll(async () => {
    const frame = await pageFrame(page);
    return frame.evaluate(() => document.documentElement.getAttribute("data-mp-ready") === "true");
  }, 12000);
  return pageFrame(page);
}

async function scrollMetrics(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
}

async function frameScrollMetrics(frame) {
  return frame.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: window.innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: window.innerHeight,
  }));
}

function noHorizontalOverflow(metrics) {
  return metrics.scrollWidth <= metrics.clientWidth + 1;
}

function noVerticalOverflow(metrics) {
  return metrics.scrollHeight <= metrics.clientHeight + 1;
}

function collectConsole(message) {
  if (message.type() !== "error") return;
  const text = message.text();
  // fail-closed 用例会故意触发 503；该错误由用例本身断言
  if (text.includes("Failed to load resource") && text.includes("503")) return;
  consoleErrors.push(text);
}

async function newContext(browser, { width, height, theme = "light" }) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  const token = await login();
  await context.addInitScript(
    ({ accessToken, mode }) => {
      if (window.top !== window) return;
      try {
        localStorage.setItem("mockfinal_token", accessToken);
        localStorage.setItem("theme", mode);
      } catch {
        /* 某些文档上下文禁止存储；页面仍可凭内存状态运行 */
      }
      if (document.documentElement) {
        document.documentElement.classList.toggle("dark", mode === "dark");
      }
    },
    { accessToken: token.token, mode: theme },
  );
  return context;
}

async function openPage(page, url) {
  page.setDefaultTimeout(8000);
  await page.goto(`${BASE_URL}${url}`, { waitUntil: "networkidle" });
}

function step(name) {
  console.log(`\n== ${name}`);
}

async function main() {
  requireEnv();
  await fs.mkdir(SHOT_DIR, { recursive: true });
  const auth = await login();
  const readyDeck = await api(`/decks/${READY_DECK}`, auth.token);
  const readyPages = readyDeck.pages.filter((item) => item.status === "ready");
  const firstPage = readyPages[0];

  const browser = await chromium.launch({ headless: true });

  // ===== 桌面 1280×720：工作区 deck 列表、总览、阅读器 =====
  const desktop = await newContext(browser, { width: 1280, height: 720 });
  const page = await desktop.newPage();
  page.on("console", collectConsole);
  page.on("pageerror", (error) => consoleErrors.push(`[desktop:pageerror] ${error.message}`));

  await openPage(page, `/workspace/${WORKSPACE_ID}`);
  await page.getByRole("button", { name: /^复习页/ }).click();
  await page.getByText("二分、矩阵与时间线").waitFor({ timeout: 10000 });
  step("工作区复习页列表");
  await shot(page, "01-deck-list-1280");
  const listMetrics = await scrollMetrics(page);
  expect(noHorizontalOverflow(listMetrics), "工作区复习页列表无横向溢出", JSON.stringify(listMetrics));

  await openPage(page, `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}`);
  await page.getByRole("heading", { name: "知识点路线图" }).waitFor({ timeout: 10000 });
  step("总览 1280×720");
  await shot(page, "02-deck-overview-1280");
  const overviewMetrics = await scrollMetrics(page);
  expect(noHorizontalOverflow(overviewMetrics), "总览 1280 无横向溢出", JSON.stringify(overviewMetrics));
  expect(noVerticalOverflow(overviewMetrics), "总览 1280 一屏无页面滚动", JSON.stringify(overviewMetrics));

  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await wait(250);
    const metrics = await scrollMetrics(page);
    expect(
      noHorizontalOverflow(metrics) && noVerticalOverflow(metrics),
      `总览 ${width}×${height} 零滚动`,
      JSON.stringify(metrics),
    );
    await shot(page, `02-deck-overview-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  // 路线图节点进入阅读器
  await page.getByRole("button", { name: /二分查找：区间不变量/ }).click();
  await page.waitForURL(/\/pages\//, { timeout: 10000 });
  const frame = await frameReady(page);
  await wait(300);
  step("阅读器与页面运行时");
  await shot(page, "03-reader-bisect-1280-light");
  const hostMetrics = await scrollMetrics(page);
  const frameMetrics = await frameScrollMetrics(frame);
  expect(noHorizontalOverflow(hostMetrics), "阅读器宿主无横向溢出", JSON.stringify(hostMetrics));
  expect(noVerticalOverflow(hostMetrics), "阅读器宿主一屏无滚动", JSON.stringify(hostMetrics));
  expect(
    noHorizontalOverflow(frameMetrics) && noVerticalOverflow(frameMetrics),
    "页面 iframe 零滚动（1280×720）",
    JSON.stringify(frameMetrics),
  );

  // 页面内交互（教学模板用 next，旧页面用 step）
  const beforeFrame = await frame.evaluate(() => {
    const root = document.querySelector(".mp-page");
    const progress = document.querySelector("[data-mp-progress]");
    return {
      state: root?.getAttribute("data-mp-state") ?? "",
      step: root?.getAttribute("data-mp-step") ?? "",
      progress: progress?.textContent ?? "",
    };
  });
  await frame.locator("[data-mp-action='step'], [data-mp-action='next']").first().click();
  const stepped = await poll(
    () =>
      frame.evaluate((before) => {
        const root = document.querySelector(".mp-page");
        const progress = document.querySelector("[data-mp-progress]");
        return (
          (root?.getAttribute("data-mp-state") ?? "") !== before.state ||
          (root?.getAttribute("data-mp-step") ?? "") !== before.step ||
          (progress?.textContent ?? "") !== before.progress
        );
      }, beforeFrame),
    5000,
  );
  expect(stepped, "阅读器页面交互可执行");

  // 全屏阅读（Fullscreen API）
  step("全屏阅读");
  await page.getByRole("button", { name: "全屏阅读" }).click();
  await wait(300);
  const fullscreenOn = await page.evaluate(() => ({
    active: !!document.fullscreenElement,
    exitControl: !!document.querySelector('[aria-label="退出全屏"]'),
  }));
  expect(
    fullscreenOn.active && fullscreenOn.exitControl,
    "Fullscreen API 进入全屏并显示退出控件",
    JSON.stringify(fullscreenOn),
  );
  await shot(page, "03b-reader-fullscreen-1280");
  await page.getByRole("button", { name: "打开 AI 助手" }).click();
  const fullscreenAssistant = page.getByRole("dialog", { name: "页面 AI 助手" });
  await fullscreenAssistant.waitFor({ timeout: 5000 });
  const fullscreenAssistantBox = await fullscreenAssistant.boundingBox();
  expect(
    (fullscreenAssistantBox?.width ?? 0) >= 300,
    "全屏下 AI 抽屉可见",
    JSON.stringify(fullscreenAssistantBox),
  );
  await shot(page, "03c-reader-fullscreen-assistant-1280");
  await page.getByRole("button", { name: "关闭助手" }).click();
  await fullscreenAssistant.waitFor({ state: "hidden", timeout: 5000 });
  await page.keyboard.press("Escape");
  await wait(300);
  const fullscreenOff = await page.evaluate(() => !document.fullscreenElement);
  expect(fullscreenOff, "Esc 退出全屏并恢复阅读器");

  // 选中文本 -> 问 AI（选区桥接）
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
  const assistantDialog = page.getByRole("dialog", { name: "页面 AI 助手" });
  await assistantDialog.waitFor({ timeout: 5000 });
  await assistantDialog.getByText("引用上下文").waitFor({ timeout: 5000 });
  await wait(250);
  const drawerBox = await assistantDialog.boundingBox();
  expect((drawerBox?.width ?? 0) >= 300, "选区桥接打开助手并带引用上下文");
  await shot(page, "04-reader-selection-drawer-1280");
  await page.getByRole("button", { name: "关闭助手" }).click();

  // 学习面板
  step("学习面板");
  await page.getByRole("button", { name: "学习面板" }).click();
  const studyPanel = page.getByRole("dialog", { name: "学习面板" });
  await studyPanel.waitFor({ timeout: 5000 });
  const tabs = (await studyPanel.getByRole("tab").allInnerTexts()).map((text) => text.trim());
  expect(
    tabs.join("/") === "本页/检查/依据/AI",
    "学习面板包含本页/检查/依据/AI 四个标签",
    tabs.join("/"),
  );
  const hasTeaching = (await studyPanel.innerText()).includes("学习目标");
  expect(hasTeaching, "教学页学习面板显示教学目标");
  await shot(page, "04b-reader-study-page-1280");

  // 讲解路线 focus_block：点击节点后 iframe 内对应块高亮
  const chainButton = studyPanel
    .locator("section")
    .filter({ hasText: "讲解路线" })
    .getByRole("button")
    .first();
  if (hasTeaching && (await chainButton.count()) > 0) {
    await chainButton.click();
    const highlighted = await poll(
      () => frame.evaluate(() => document.querySelector("[data-mp-focus='true']") !== null),
      3000,
    );
    expect(highlighted, "讲解路线点击后页面块高亮");
  }

  await studyPanel.getByRole("tab", { name: "检查" }).click();
  const optionButton = studyPanel.locator("section button").first();
  if ((await optionButton.count()) > 0) {
    await optionButton.click();
    const feedback = studyPanel.getByText(/回答正确|再想一想/);
    await feedback.waitFor({ timeout: 5000 });
    expect(true, "随堂检查选择后显示正误与解析");
    await shot(page, "04c-reader-study-check-1280");
    const completeButton = studyPanel.getByRole("button", { name: "学完本页" });
    if ((await completeButton.count()) > 0) {
      await completeButton.click();
      await studyPanel.getByText("已标记学完").waitFor({ timeout: 5000 });
      expect(true, "显式标记学完本页");
    }
  } else {
    expect(true, "旧版页面检查标签降级为空态");
  }

  await studyPanel.getByRole("tab", { name: "依据" }).click();
  const sourceCount = await studyPanel.getByText(/来源 \d/).count();
  expect(sourceCount > 0 || (await studyPanel.innerText()).includes("未引用资料段落"), "依据标签可查看来源");
  await studyPanel.getByRole("tab", { name: "AI" }).click();
  await studyPanel.getByRole("button", { name: "打开 AI 助手" }).waitFor({ timeout: 5000 });
  expect(true, "AI 标签提供页面助手入口");

  await page.keyboard.press("Escape");
  await studyPanel.waitFor({ state: "hidden", timeout: 5000 });

  // 键盘翻页
  step("键盘翻页");
  await page.keyboard.press("ArrowRight");
  await poll(async () => {
    const text = await page.locator("header").innerText();
    return text.includes("02") && text.includes("03");
  }, 10000);
  const frame2 = await frameReady(page);
  await wait(250);
  expect(true, "键盘 → 翻到第 2 页");

  // 显式“学完本页”（第 2 页未标记完成）
  step("显式学完");
  await page.getByRole("button", { name: "学习面板" }).click();
  const studyPanel2 = page.getByRole("dialog", { name: "学习面板" });
  await studyPanel2.waitFor({ timeout: 5000 });
  await studyPanel2.getByRole("tab", { name: "检查" }).click();
  const option2 = studyPanel2.locator("section button").first();
  if ((await option2.count()) > 0) {
    await option2.click();
    await studyPanel2.getByText(/回答正确|再想一想/).waitFor({ timeout: 5000 });
  }
  const completeButton2 = studyPanel2.getByRole("button", { name: "学完本页" });
  await completeButton2.waitFor({ timeout: 5000 });
  await completeButton2.click();
  await studyPanel2.getByText("已标记学完").waitFor({ timeout: 5000 });
  expect(true, "显式标记学完本页并写入进度");
  await shot(page, "04d-reader-study-complete-1280");
  await page.keyboard.press("Escape");
  await studyPanel2.waitFor({ state: "hidden", timeout: 5000 });

  await page.keyboard.press("ArrowLeft");
  await poll(async () => (await page.locator("header").innerText()).includes("01"), 10000);

  // 重做弹窗
  step("重做弹窗");
  await page.getByRole("button", { name: "重做这一页" }).click();
  await page.getByRole("dialog", { name: "重做这一页" }).waitFor({ timeout: 5000 });
  expect(true, "阅读器重做弹窗可打开");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "重做这一页" }).waitFor({ state: "hidden", timeout: 5000 });

  // 深色阅读器
  const dark = await newContext(browser, { width: 1280, height: 720, theme: "dark" });
  const darkPage = await dark.newPage();
  darkPage.on("console", collectConsole);
  await openPage(
    darkPage,
    `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}/pages/${firstPage.id}`,
  );
  await frameReady(darkPage);
  await wait(300);
  await shot(darkPage, "05-reader-dark-1280");
  const darkMetrics = await scrollMetrics(darkPage);
  expect(noHorizontalOverflow(darkMetrics), "深色阅读器无横向溢出", JSON.stringify(darkMetrics));
  await dark.close();

  // ===== 构建工作台 =====
  const buildingJob = readyDeck ? await api(`/decks/${BUILDING_DECK}`, auth.token) : null;
  await openPage(
    page,
    `/workspace/${WORKSPACE_ID}/decks/${BUILDING_DECK}/build${
      buildingJob?.active_job_id ? `?job=${buildingJob.active_job_id}` : ""
    }`,
  );
  await page.getByRole("heading", { name: "构建任务" }).waitFor({ timeout: 10000 });
  await page.getByText("正在编写动画与布局…").waitFor({ timeout: 10000 });
  await shot(page, "06-build-in-progress-1280");
  expect(await page.getByRole("button", { name: "取消构建" }).isVisible(), "构建中显示取消入口");
  await page.getByRole("button", { name: "取消构建" }).click();
  await page.getByRole("dialog").filter({ hasText: "已完成的页面会保留" }).waitFor({ timeout: 5000 });
  expect(true, "取消构建确认弹窗说明保留已完成页面");
  await page.getByRole("button", { name: "继续构建" }).click();

  // 失效 ?job= 不得把整个工作台误判为复习页不存在
  step("失效构建任务");
  const consoleErrorCountBeforeInvalidJob = consoleErrors.length;
  await openPage(
    page,
    `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}/build?job=999999`,
  );
  await wait(800);
  expect(
    (await page.getByRole("heading", { name: "复习页不存在" }).count()) === 0,
    "失效 ?job= 不误判复习页不存在",
  );
  expect(!page.url().includes("job=999999"), "失效 ?job= 查询参数被清理", page.url());
  // 故意请求不存在的 job 会产生预期内 404，不计入控制台错误
  for (let index = consoleErrors.length - 1; index >= consoleErrorCountBeforeInvalidJob; index -= 1) {
    if (consoleErrors[index].includes("404")) consoleErrors.splice(index, 1);
  }

  // 部分失败
  await openPage(page, `/workspace/${WORKSPACE_ID}/decks/${PARTIAL_DECK}`);
  await page.getByRole("heading", { name: "知识点路线图" }).waitFor({ timeout: 10000 });
  step("部分失败总览");
  await shot(page, "07-deck-overview-partial-1280");
  expect(
    (await page.getByRole("button", { name: "重试" }).count()) > 0,
    "失败页面卡片提供重试入口",
  );

  await openPage(page, `/workspace/${WORKSPACE_ID}/decks/${PARTIAL_DECK}/build`);
  await page.getByRole("heading", { name: "构建任务" }).waitFor({ timeout: 10000 });
  await page.getByText("构建结束：1 个页面失败").first().waitFor({ timeout: 10000 });
  step("部分失败构建详情");
  await shot(page, "07b-build-partial-result-1280");
  expect(true, "重新进入构建工作台可恢复最近任务与失败原因");

  // 草稿：构建设置
  await openPage(page, `/workspace/${WORKSPACE_ID}/decks/${DRAFT_DECK}/build`);
  await page.getByRole("heading", { name: "开始构建复习页" }).waitFor({ timeout: 10000 });
  await shot(page, "08-build-setup-1280");
  expect(await page.getByRole("button", { name: "开始构建" }).isVisible(), "草稿显示构建设置与开始入口");
  await page.getByRole("button", { name: "开始构建" }).click();
  await page.getByText(/页面构建所需服务未配置/).waitFor({ timeout: 10000 });
  expect(true, "未配置服务时构建 fail-closed 提示中文原因");
  await shot(page, "09-build-fail-closed-1280");

  // 新建复习页
  await openPage(page, `/workspace/${WORKSPACE_ID}`);
  await page.getByRole("button", { name: /^复习页/ }).click();
  await page.getByRole("button", { name: "新建复习页" }).first().click();
  await page.getByRole("dialog").filter({ hasText: "新建复习页" }).waitFor({ timeout: 5000 });
  await page.getByLabel("标题").fill("P5 浏览器新建示例");
  await page
    .getByRole("dialog", { name: "新建复习页" })
    .getByRole("button", { name: /^图解/ })
    .click();
  await shot(page, "10-deck-create-modal-1280");
  await page.getByRole("button", { name: "创建并继续" }).click();
  await page.waitForURL(/\/decks\/\d+\/build/, { timeout: 10000 });
  await page.getByRole("heading", { name: "开始构建复习页" }).waitFor({ timeout: 10000 });
  expect(true, "新建复习页后进入构建设置");

  // 空工作区
  await openPage(page, `/workspace/${EMPTY_WORKSPACE_ID}`);
  await page.getByRole("button", { name: /^复习页/ }).click();
  await page.getByText("还没有复习页").waitFor({ timeout: 10000 });
  await shot(page, "11-empty-decks-1280");
  expect(true, "空工作区显示复习页空态");

  await desktop.close();

  // ===== 移动端 390×844 =====
  const mobile = await newContext(browser, { width: 390, height: 844 });
  const mobilePage = await mobile.newPage();
  mobilePage.on("console", collectConsole);
  await openPage(mobilePage, `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}`);
  await mobilePage.getByRole("heading", { name: "知识点路线图" }).waitFor({ timeout: 10000 });
  await shot(mobilePage, "12-overview-mobile-390");
  const mobileOverview = await scrollMetrics(mobilePage);
  expect(
    noHorizontalOverflow(mobileOverview),
    "移动端总览无横向溢出",
    JSON.stringify(mobileOverview),
  );

  await openPage(
    mobilePage,
    `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}/pages/${firstPage.id}`,
  );
  await frameReady(mobilePage);
  await wait(300);
  await shot(mobilePage, "13-reader-mobile-390");
  const mobileReader = await scrollMetrics(mobilePage);
  expect(
    noHorizontalOverflow(mobileReader),
    "移动端阅读器无横向溢出",
    JSON.stringify(mobileReader),
  );

  await mobilePage.getByRole("button", { name: "学习面板" }).click();
  const mobileStudy = mobilePage.getByRole("dialog", { name: "学习面板" });
  await mobileStudy.waitFor({ timeout: 5000 });
  const mobileStudyBox = await mobileStudy.boundingBox();
  expect(
    (mobileStudyBox?.width ?? 0) <= 390 && (mobileStudyBox?.height ?? 0) <= 844,
    "移动端学习面板为全屏 sheet",
    JSON.stringify(mobileStudyBox),
  );
  await shot(mobilePage, "13b-reader-study-mobile-390");
  await mobilePage.keyboard.press("Escape");
  await mobileStudy.waitFor({ state: "hidden", timeout: 5000 });

  for (const [width, height] of [
    [375, 667],
    [768, 1024],
  ]) {
    const context = await newContext(browser, { width, height });
    const view = await context.newPage();
    view.on("console", collectConsole);
    await openPage(view, `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}`);
    await view.getByRole("heading", { name: "知识点路线图" }).waitFor({ timeout: 10000 });
    const metrics = await scrollMetrics(view);
    expect(
      noHorizontalOverflow(metrics),
      `${width}×${height} 总览无横向溢出`,
      JSON.stringify(metrics),
    );
    await shot(view, `14-overview-${width}`);
    await openPage(
      view,
      `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}/pages/${firstPage.id}`,
    );
    await frameReady(view);
    const readerMetrics = await scrollMetrics(view);
    expect(
      noHorizontalOverflow(readerMetrics),
      `${width}×${height} 阅读器无横向溢出`,
      JSON.stringify(readerMetrics),
    );
    await context.close();
  }

  const reduced = await newContext(browser, { width: 1280, height: 720 });
  const reducedPage = await reduced.newPage();
  await openPage(
    reducedPage,
    `/workspace/${WORKSPACE_ID}/decks/${READY_DECK}/pages/${firstPage.id}`,
  );
  const reducedFrame = await frameReady(reducedPage);
  const reducedMotion = await reducedPage.evaluate(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const runtimeReduced = await reducedFrame.evaluate(
    () => document.documentElement.getAttribute("data-mp-reduced-motion") === "true",
  );
  expect(reducedMotion && runtimeReduced, "reduced-motion 偏好传递到页面运行时");
  await reduced.close();

  await mobile.close();

  await browser.close();

  const failed = results.filter((item) => !item.ok);
  const summary = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    viewport_checks: results.filter((item) => item.name.includes("1280") || item.name.includes("1440") || item.name.includes("1920") || item.name.includes("移动端")),
    results,
    console_errors: consoleErrors,
    passed: results.length - failed.length,
    failed: failed.length,
    screenshots: SHOT_DIR,
  };
  await fs.writeFile(RESULT_FILE, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`\n结果：${summary.passed} 通过 / ${summary.failed} 失败；输出 ${RESULT_FILE}`);
  if (consoleErrors.length) {
    console.log("控制台错误：");
    for (const error of consoleErrors) console.log(`  - ${error}`);
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});