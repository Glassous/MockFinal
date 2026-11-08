import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectBundle } from "../dist/bundle.js";

const BRIEF = {
  page_id: "page_test_001",
  knowledge_point: { title: "测试知识点" },
};

function makeBuildDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-bundle-"));
  const files = {
    "manifest.json": JSON.stringify(
      {
        schema_version: "1.0",
        page_id: "page_test_001",
        title: "测试页面",
        knowledge_point_ids: ["kp_1"],
        importance: "core",
        estimated_minutes: 5,
        layout: "focus",
        interactions: [{ id: "step", type: "simulation", smoke: { action: "click", selector: "[data-mp-action='step']", expect: "[data-mp-state='hit']" } }],
        source_refs: [{ material_id: 1, section_id: 101, quote: "引用" }],
        a11y: { reduced_motion: true },
      },
      null,
      2,
    ),
    "page.html": "<div class=\"mp-page\"><button data-mp-action=\"step\">下一步</button></div>\n",
    "page.css": ".mp-page { height: 100%; }\n",
    "page.js": "const b = document.querySelector('[data-mp-action=\"step\"]');\nb.addEventListener('click', () => {});\nMockFinal.ready({ title: '测试' });\n",
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

test("bundle：4 个合法文件可组装为 PageBundle", async () => {
  const buildDir = makeBuildDir();
  const result = await collectBundle({ buildDir, brief: BRIEF });
  assert.deepEqual(result.issues, []);
  assert.ok(result.bundle);
  assert.equal(result.bundle.schema_version, "1.0");
  assert.equal(result.bundle.runtime_version, "1.0.0");
  assert.equal(result.bundle.manifest.page_id, "page_test_001");
  assert.equal(result.files.length, 4);
  assert.ok(result.totalBytes > 0);
});

test("bundle：缺少必需文件时返回 BUNDLE_FILE_MISSING", async () => {
  const buildDir = makeBuildDir({ "page.js": null });
  const result = await collectBundle({ buildDir, brief: BRIEF });
  assert.equal(result.bundle, null);
  assert.ok(result.issues.some((issue) => issue.code === "BUNDLE_FILE_MISSING"));
});

test("bundle：拒绝 </script 逃逸序列与禁止标签", async () => {
  const buildDir = makeBuildDir({
    "page.js": "MockFinal.ready({ title: 'x' });\nconst x = '</script>';\n",
    "page.html": "<div><script>alert(1)</script></div>\n",
  });
  const result = await collectBundle({ buildDir, brief: BRIEF });
  assert.equal(result.bundle, null);
  assert.ok(result.issues.some((issue) => issue.code === "SHELL_ESCAPE_SEQUENCE"));
  assert.ok(result.issues.some((issue) => issue.code === "FORBIDDEN_HTML_TAG"));
});

test("bundle：manifest 的 page_id 必须与 brief 一致", async () => {
  const buildDir = makeBuildDir({
    "manifest.json": JSON.stringify({
      schema_version: "1.0",
      page_id: "page_other_002",
      title: "x",
      knowledge_point_ids: ["kp_1"],
      importance: "core",
      estimated_minutes: 5,
      layout: "focus",
      interactions: [],
      source_refs: [],
      a11y: { reduced_motion: true },
    }),
  });
  const result = await collectBundle({ buildDir, brief: BRIEF });
  assert.equal(result.bundle, null);
  assert.ok(result.issues.some((issue) => issue.code === "MANIFEST_PAGE_ID_MISMATCH"));
});

test("bundle：单文件超过上限时拒绝打包", async () => {
  const buildDir = makeBuildDir();
  const result = await collectBundle({
    buildDir,
    brief: BRIEF,
    maxBundleBytes: 100,
  });
  assert.equal(result.bundle, null);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "FILE_TOO_LARGE" || issue.code === "BUNDLE_TOO_LARGE",
    ),
  );
});

function teachingManifest(overrides = {}) {
  return {
    schema_version: "1.1",
    design_system: "1.0",
    page_id: "page_test_001",
    title: "教学页",
    knowledge_point_ids: ["kp_1"],
    importance: "core",
    estimated_minutes: 6,
    layout: "split-steps",
    interactions: [
      {
        id: "step",
        type: "simulation",
        smoke: {
          action: "click",
          selector: "[data-mp-action='step']",
          expect: "[data-mp-state='hit']",
        },
      },
    ],
    source_refs: [{ material_id: 1, section_id: 101, quote: "引用" }],
    a11y: { reduced_motion: true },
    teaching: {
      version: "1.0",
      role: "mechanism",
      objectives: ["能解释区间收缩", "能说出不变量"],
      prerequisites: ["数组有序"],
      hook: "为什么要折半？",
      chain: [
        { id: "c1", title: "维护区间", block_id: "b1" },
        { id: "c2", title: "比较中点", block_id: "b2" },
        { id: "c3", title: "排除一半", block_id: "b3" },
      ],
      check: [
        {
          id: "q1",
          objective_id: "o1",
          question: "为什么向下取整？",
          options: ["保证收缩", "更快"],
          answer_index: 0,
          explanation: "保证区间必然收缩。",
        },
      ],
      summary: { key_points: ["不变量"], misconceptions: ["死循环"] },
    },
    ...overrides,
  };
}

test("bundle：1.1 教学页结构完整时通过并写入 schema 1.1", async () => {
  const dir = makeBuildDir({
    "manifest.json": JSON.stringify(teachingManifest(), null, 2),
    "page.html":
      '<div class="mp-page"><section data-mp-block="b1">区间</section><section data-mp-block="b2">中点</section><section data-mp-block="b3">排除</section><button data-mp-action="step">下一步</button></div>\n',
  });
  const result = await collectBundle({
    buildDir: dir,
    brief: { ...BRIEF, teaching_contract: { objectives: ["目标"] } },
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.bundle?.schema_version, "1.1");
});

test("bundle：启用教学页但缺少 teaching 时返回 TEACHING_MISSING", async () => {
  const manifest = teachingManifest();
  delete manifest.teaching;
  manifest.schema_version = "1.0";
  const dir = makeBuildDir({ "manifest.json": JSON.stringify(manifest, null, 2) });
  const result = await collectBundle({
    buildDir: dir,
    brief: { ...BRIEF, teaching_contract: { objectives: ["目标"] } },
  });
  assert.ok(result.issues.some((issue) => issue.code === "TEACHING_MISSING"));
});

test("bundle：chain.block_id 找不到 data-mp-block 时拒绝", async () => {
  const dir = makeBuildDir({
    "manifest.json": JSON.stringify(teachingManifest(), null, 2),
    "page.html":
      '<div class="mp-page"><section data-mp-block="b1">区间</section><button data-mp-action="step">下一步</button></div>\n',
  });
  const result = await collectBundle({
    buildDir: dir,
    brief: { ...BRIEF, teaching_contract: { objectives: ["目标"] } },
  });
  assert.ok(result.issues.some((issue) => issue.code === "TEACHING_BLOCK_MISSING"));
});

const CONTENT_BRIEF = {
  page_id: "page_test_cr",
  knowledge_point: { title: "C-R 条件", importance: "core" },
  knowledge_point_ids: ["kp_1"],
  estimated_minutes: 9,
  role: "mechanism",
  teaching_contract: { objectives: ["目标"] },
  constraints: {
    content_schema: "2.0",
    design_system: "2.0",
    page_theme: "workbench",
    runtime_version: "1.1.0",
  },
  source_excerpts: [
    { material_id: 1, section_id: 22, heading: "2.2 解析函数", text: "资料正文" },
    { material_id: 9, section_id: 901, heading: "期末题归档 23-24 Q11", text: "资料正文" },
  ],
};

function makeContentBuildDir(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-content-"));
  fs.writeFileSync(
    path.join(dir, "content.json"),
    JSON.stringify(content, null, 2),
    "utf8",
  );
  return dir;
}

function designLabContent() {
  return JSON.parse(
    fs.readFileSync(new URL("../../design_lab/content/cr-condition.json", import.meta.url), "utf8"),
  );
}

test("bundle：content 2.0 模式只读 content.json 并渲染 bundle", async () => {
  const dir = makeContentBuildDir(designLabContent());
  const result = await collectBundle({ buildDir: dir, brief: CONTENT_BRIEF });
  assert.deepEqual(result.issues, []);
  assert.ok(result.bundle);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, "content.json");
  assert.equal(result.bundle.schema_version, "1.1");
  assert.equal(result.bundle.runtime_version, "1.1.0");
  assert.equal(result.bundle.css, "");
  assert.equal(result.bundle.js, "");
  assert.equal(result.bundle.manifest.design_system, "2.0");
  assert.deepEqual(result.bundle.manifest.renderer, {
    kit: "page-kit",
    version: "2.0.0",
    theme: "workbench",
  });
  assert.equal(result.bundle.manifest.teaching.scroll, "flow");
  assert.equal(result.bundle.manifest.page_id, "page_test_cr");
  assert.match(result.bundle.html, /<math/);
  assert.ok(result.bundle.manifest.source_refs.every((ref) => ref.section_id > 0));
});

test("bundle：content 2.0 模式缺少 content.json 时返回 BUNDLE_FILE_MISSING", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-content-"));
  const result = await collectBundle({ buildDir: dir, brief: CONTENT_BRIEF });
  assert.equal(result.bundle, null);
  assert.ok(result.issues.some((issue) => issue.code === "BUNDLE_FILE_MISSING" && issue.file === "content.json"));
});

test("bundle：content 2.0 模式内容不合法时返回页内容错误", async () => {
  const content = designLabContent();
  content.role = "mechanism";
  content.figure = null;
  const dir = makeContentBuildDir(content);
  const result = await collectBundle({ buildDir: dir, brief: CONTENT_BRIEF });
  assert.equal(result.bundle, null);
  assert.ok(result.issues.some((issue) => issue.code === "FIGURE_REQUIRED"));
});

test("bundle：content 2.0 模式拒绝非法 JSON", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-content-"));
  fs.writeFileSync(path.join(dir, "content.json"), "{ not json", "utf8");
  const result = await collectBundle({ buildDir: dir, brief: CONTENT_BRIEF });
  assert.equal(result.bundle, null);
  assert.ok(result.issues.some((issue) => issue.code === "CONTENT_JSON_INVALID"));
});
