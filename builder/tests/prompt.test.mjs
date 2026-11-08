import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderBuildPrompt } from "../dist/session.js";

const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "pi-harness");
const BRIEF = {
  page_id: "page_test_1",
  deck_title: "测试 Deck",
  role: "mechanism",
  knowledge_point: { title: "测试知识点", objectives: ["目标一"] },
  teaching_contract: {
    objectives: ["目标一"],
    required: ["hook", "chain", "check"],
    density: { visible_layer_chars: 450, total_page_chars: 700, total_blocks: 8, checks: 1 },
  },
  deck_context: { previous_learning: "上一页", next_hook: "下一页", chapter_index: 1 },
};

test("reuse prompt is a short task card without full rules", async () => {
  const prompt = await renderBuildPrompt({
    harnessDir: HARNESS,
    buildDir: "C:/tmp/mockfinal-test/page_test_1",
    brief: BRIEF,
    reuse: true,
  });
  assert.match(prompt.text, /本页任务卡/);
  assert.match(prompt.text, /page_test_1/);
  assert.doesNotMatch(prompt.text, /## 硬约束/);
  assert.ok(prompt.text.length < 2000, `reuse prompt too long: ${prompt.text.length}`);
});

test("compact profile uses compact English template", async () => {
  const prompt = await renderBuildPrompt({
    harnessDir: HARNESS,
    buildDir: "C:/tmp/mockfinal-test/page_test_1",
    brief: BRIEF,
    profile: "compact",
  });
  assert.match(prompt.text, /MockFinal page builder/);
  assert.match(prompt.text, /## Hard rules/);
  assert.match(prompt.text, /教学契约/);
  assert.doesNotMatch(prompt.text, /\{\{skill_step\}\}/);
});

test("zh profile keeps the full Chinese template", async () => {
  const prompt = await renderBuildPrompt({
    harnessDir: HARNESS,
    buildDir: "C:/tmp/mockfinal-test/page_test_1",
    brief: BRIEF,
  });
  assert.match(prompt.text, /## 硬约束（违反任一即失败）/);
  assert.match(prompt.text, /读 `SKILL\.md`/);
});

test("content 2.0 brief uses content prompt and only content.json", async () => {
  const brief = {
    ...BRIEF,
    role: "concept",
    constraints: {
      content_schema: "2.0",
      design_system: "2.0",
      page_theme: "problem",
      runtime_version: "1.1.0",
    },
  };
  const prompt = await renderBuildPrompt({
    harnessDir: HARNESS,
    buildDir: "C:/tmp/mockfinal-test/page_test_1",
    brief,
  });
  assert.match(prompt.text, /只写 1 个文件：content\.json/);
  assert.match(prompt.text, /角色为 `concept`，主题 `problem`/);
  assert.match(prompt.text, /content-schema\.md/);
  assert.doesNotMatch(prompt.text, /manifest\.json、page\.html/);
  assert.doesNotMatch(prompt.text, /\{\{(role|theme|teaching_block)\}\}/);
  assert.equal(path.basename(prompt.templatePath), "build-page-content.md");
});
