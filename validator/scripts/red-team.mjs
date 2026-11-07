#!/usr/bin/env node
/**
 * Validator 红队用例执行器（P2）。
 *
 * 用法：
 *   VALIDATOR_URL=http://127.0.0.1:9200 VALIDATOR_TOKEN=... node scripts/red-team.mjs
 *
 * 基于 fixtures/good-basic.bundle.json 注入恶意内容，逐条断言 Validator 拒绝。
 * 路径穿越/符号链接用例在 Builder tests/paths.test.mjs 中覆盖，本脚本不重复。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.VALIDATOR_URL ?? "http://127.0.0.1:9200").replace(/\/+$/, "");
const TOKEN = process.env.VALIDATOR_TOKEN ?? "";
if (!TOKEN) {
  console.error("缺少 VALIDATOR_TOKEN。");
  process.exit(2);
}

const good = JSON.parse(await fs.readFile(path.join(ROOT, "fixtures", "good-basic.bundle.json"), "utf8"));

const cases = [
  ["RT-01 外链图片", { ...good, html: good.html + '<img src="https://example.com/a.png" alt="x">' }, ["HTML_EXTERNAL_URL"]],
  ["RT-02 CSS @import", { ...good, css: good.css + "\n@import url(https://example.com/a.css);" }, ["CSS_EXTERNAL_URL"]],
  ["RT-03 eval", { ...good, js: "eval('1+1');" }, ["JS_FORBIDDEN_API"]],
  ["RT-04 父窗口访问", { ...good, js: "window.parent.document.title;" }, ["JS_FORBIDDEN_API"]],
  ["RT-05 fetch", { ...good, js: "fetch('https://example.com');" }, ["JS_FORBIDDEN_API"]],
  ["RT-06 其他网络 API", { ...good, js: 'new XMLHttpRequest(); new WebSocket("wss://x"); new EventSource("/s"); navigator.sendBeacon("/b");' }, ["JS_FORBIDDEN_API"]],
  ["RT-07 存储与 cookie", { ...good, js: 'localStorage.setItem("a","b"); document.cookie = "a=b";' }, ["JS_FORBIDDEN_API"]],
  ["RT-08 超大 bundle", { ...good, html: good.html + "x".repeat(2 * 1024 * 1024 + 10) }, ["BUNDLE_TOO_LARGE"]],
  ["RT-11 Shell 逃逸", { ...good, js: good.js + '\nvar x = "</script>";' }, ["SHELL_ESCAPE_SEQUENCE"]],
  ["RT-12 javascript: URL", { ...good, html: good.html + '<a href="javascript:alert(1)">x</a>' }, ["HTML_EXTERNAL_URL"]],
  ["RT-12 document.write", { ...good, js: "document.write('x');" }, ["JS_FORBIDDEN_API"]],
  ["RT-13 iframe/object/embed", { ...good, html: good.html + '<iframe src="data:text/html,x"></iframe>' }, ["HTML_FORBIDDEN_TAG"]],
  ["RT-14 form 外发", { ...good, html: good.html + '<form action="https://example.com"><button>go</button></form>' }, ["HTML_FORBIDDEN_TAG"]],
  ["RT-15 meta refresh 外跳", { ...good, html: good.html + '<meta http-equiv="refresh" content="0;url=https://example.com">' }, ["HTML_FORBIDDEN_TAG"]],
  ["RT-16 base 外链", { ...good, html: good.html + '<base href="https://example.com/">' }, ["HTML_FORBIDDEN_TAG"]],
];

let blocked = 0;
for (const [name, bundle, expected] of cases) {
  const response = await fetch(`${BASE}/v1/validate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ bundle, screenshot: false }),
  });
  const report = await response.json();
  const errors = [...new Set((report.issues ?? []).filter((issue) => issue.severity === "error").map((issue) => issue.code))];
  const ok = report.status === "failed" && errors.some((code) => expected.includes(code));
  if (ok) blocked += 1;
  console.log(`${ok ? "BLOCKED" : "MISSED "} ${name}: status=${report.status} codes=[${errors.join(",")}]`);
}

const noAuth = await fetch(`${BASE}/v1/validate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bundle: good }),
});
const authBlocked = noAuth.status === 401;
if (authBlocked) blocked += 1;
console.log(`${authBlocked ? "BLOCKED" : "MISSED "} 未授权请求: http=${noAuth.status}`);

const total = cases.length + 1;
console.log(`\n红队结果：${blocked}/${total} 拦截`);
if (blocked !== total) process.exit(1);
