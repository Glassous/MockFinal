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
