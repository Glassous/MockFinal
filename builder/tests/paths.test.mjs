import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GuardError,
  guardReadPath,
  guardWritePath,
  isInside,
  resolveWithin,
} from "../dist/paths.js";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("路径守卫：拒绝 ../ 越界与绝对路径越界", () => {
  const buildDir = tempDir("mf-guard-");
  assert.throws(() => resolveWithin(buildDir, "../escape.html"), (error) => {
    assert.ok(error instanceof GuardError);
    assert.equal(error.code, "PATH_OUTSIDE_ROOT");
    return true;
  });
  assert.throws(() => resolveWithin(buildDir, path.join(os.tmpdir(), "x", "page.html")), {
    name: "GuardError",
  });
  assert.equal(isInside(buildDir, path.join(buildDir, "page.html")), true);
});

test("路径守卫：write 只允许 4 个产物文件与允许的扩展名", () => {
  const buildDir = tempDir("mf-guard-write-");
  const absolute = guardWritePath({
    buildDir,
    target: "page.html",
    content: "<div class=\"mp-page\"></div>",
  });
  assert.equal(absolute, path.join(buildDir, "page.html"));

  assert.throws(() => guardWritePath({ buildDir, target: "notes.txt" }), (error) => {
    assert.equal(error.code, "PATH_EXTENSION");
    return true;
  });
  assert.throws(
    () => guardWritePath({ buildDir, target: "materials/leak.md" }),
    (error) => {
      assert.equal(error.code, "PATH_EXTENSION");
      return true;
    },
  );
  assert.throws(
    () => guardWritePath({ buildDir, target: "page.js", content: "x".repeat(3 * 1024 * 1024) }),
    (error) => {
      assert.equal(error.code, "FILE_TOO_LARGE");
      return true;
    },
  );
});

test("路径守卫：read 只允许构建目录与只读 Harness", () => {
  const root = tempDir("mf-guard-read-");
  const buildDir = path.join(root, "build");
  const harnessDir = path.join(root, "harness");
  fs.mkdirSync(path.join(buildDir, "materials"), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, "skills"), { recursive: true });
  fs.writeFileSync(path.join(harnessDir, "skills", "SKILL.md"), "# skill\n");
  fs.writeFileSync(path.join(buildDir, "brief.json"), "{}\n");
  fs.writeFileSync(path.join(root, "secret.txt"), "top secret\n");

  assert.equal(
    guardReadPath({ buildDir, harnessDir, target: "brief.json" }),
    path.join(buildDir, "brief.json"),
  );
  assert.equal(
    guardReadPath({ buildDir, harnessDir, target: path.join(harnessDir, "skills", "SKILL.md") }),
    path.join(harnessDir, "skills", "SKILL.md"),
  );
  assert.throws(
    () => guardReadPath({ buildDir, harnessDir, target: path.join(root, "secret.txt") }),
    (error) => {
      assert.equal(error.code, "PATH_OUTSIDE_ROOT");
      return true;
    },
  );
});

test("路径守卫：拒绝符号链接", (t) => {
  const root = tempDir("mf-guard-symlink-");
  const buildDir = path.join(root, "build");
  const outside = path.join(root, "outside");
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "page.html"), "<div></div>\n");
  try {
    fs.symlinkSync(outside, path.join(buildDir, "linked"), "dir");
  } catch (error) {
    t.skip(`当前环境无法创建符号链接：${error.code ?? error.message}`);
    return;
  }
  assert.throws(
    () => guardWritePath({ buildDir, target: "linked/page.html" }),
    (error) => {
      assert.equal(error.code, "PATH_SYMLINK");
      return true;
    },
  );
});
