/**
 * P6 验收用假 LLM：OpenAI 兼容 /v1/chat/completions 流式接口。
 *
 * 用途：本地没有真实 LLM 凭据时，验证主 API SSE、上下文组装与前端流式渲染。
 * 启动：node scripts/fake-llm.mjs（默认 :9099，PORT 可覆盖）
 * API 侧：LLM_API_KEY=fake LLM_BASE_URL=http://host.docker.internal:9099/v1
 *
 * 特殊问题「请触发失败测试」返回 500，用于验证前端错误提示与重试入口。
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 9099);

const XSS_ANSWER = [
  "**安全测试**：以下内容应被清洗。\n\n",
  '<script>window.__p6_xss=1</script>\n\n',
  '<img src=x onerror="window.__p6_xss=1">\n\n',
  "[点击](javascript:window.__p6_xss=1)\n",
];

const ANSWER = [
  "根据当前页面与资料，",
  "二分查找每次把搜索区间折半，",
  "时间复杂度为 $O(\\log n)$。\n\n",
  "- 最多比较 $\\lceil \\log_2 n \\rceil$ 次；\n",
  "- 额外空间为 $O(1)$；\n",
  "- 循环不变式保证目标若存在必在区间内。\n\n",
  "以上结论依据页面知识点与所选引用。",
];

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    request.on("error", reject);
  });
}

function chunk(delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-fake-p6",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fake-p6",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", model: "fake-p6" }));
    return;
  }

  if (request.method !== "POST" || !request.url?.startsWith("/v1/chat/completions")) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "invalid json" } }));
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages.filter((message) => message.role === "user").at(-1);
  const question = String(last?.content ?? "");

  if (question.includes("请触发失败测试")) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "fake upstream failure" } }));
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let closed = false;
  request.on("close", () => {
    closed = true;
  });

  const send = (payload, delay = 120) =>
    new Promise((resolve) => {
      if (closed || response.destroyed) return resolve();
      response.write(payload);
      setTimeout(resolve, delay);
    });

  await send(chunk({ role: "assistant", content: "" }), 0);
  await new Promise((resolve) => setTimeout(resolve, 320));
  const pieces = question.includes("请触发 XSS 测试") ? XSS_ANSWER : ANSWER;
  for (const piece of pieces) {
    if (closed) return;
    await send(chunk({ content: piece }));
  }
  await send(chunk({}, "stop"));
  if (!closed) {
    response.write("data: [DONE]\n\n");
    response.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`fake LLM listening on http://0.0.0.0:${PORT}/v1`);
});
