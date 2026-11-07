import assert from "node:assert/strict";
import test from "node:test";

import { EventLog, MAX_EVENT_TEXT_BYTES, MAX_EVENTS } from "../dist/events.js";

test("事件：seq 从 1 递增，after 查询只返回增量", () => {
  const log = new EventLog();
  log.add("stage", { text: "开始" });
  log.add("text", { text: "正在编写" });
  log.add("tool", { tool: "write", text: "写入 page.html" });
  assert.equal(log.cursor, 3);

  const first = log.listAfter(0);
  assert.equal(first.events.length, 3);
  assert.deepEqual(first.events.map((event) => event.seq), [1, 2, 3]);
  assert.equal(first.nextSeq, 3);

  const second = log.listAfter(2);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].seq, 3);
});

test("事件：单条文本截断到 4KB", () => {
  const log = new EventLog();
  const event = log.add("text", { text: "中".repeat(5000) });
  assert.ok(event);
  assert.ok(Buffer.byteLength(String(event.payload.text), "utf8") <= MAX_EVENT_TEXT_BYTES);
  assert.ok(String(event.payload.text).endsWith("…"));
});

test("事件：总量不超过上限并折叠后续输出", () => {
  const log = new EventLog();
  for (let index = 0; index < 300; index += 1) {
    log.add("text", { text: `第 ${index} 段输出` });
  }
  assert.ok(log.size <= MAX_EVENTS);
  const all = log.all();
  const folded = all.find((event) => typeof event.payload.folded === "number");
  assert.ok(folded, "应存在折叠摘要事件");
  assert.ok(Number(folded.payload.folded) > 0);
  assert.ok(log.cursor >= MAX_EVENTS);
});
