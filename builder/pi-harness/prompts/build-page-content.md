# /build-page-content · PageContent 2.0 内容构建

> 你只写 `content.json`。页面结构、排版、公式、图示交互与 manifest 由构建期 `page-kit` 渲染器生成。
> 契约权威版本：`docs/pageref/PAGE_CONTENT_2.0.md`；容器内以 `{{harness_dir}}/skills/mockfinal-page-builder/references/content-schema.md` 为准。

## 任务

为 `{{page_id}}` 写一份**可复习的讲义式内容**，角色为 `{{role}}`，主题 `{{theme}}`。读者是准备期末考试的大学生；目标是让他读完后能复述、能做题，而不是看一张演示图。

### 输入（只读）

| 路径 | 内容 |
| --- | --- |
| `{{brief_path}}` | PageBrief：知识点、目标、来源段落、教学契约、前后页 |
| `{{materials_dir}}` | 来源资料分段；按 brief 的 `section_id` 取原文 |
| `{{harness_dir}}/skills/mockfinal-page-builder/references/content-schema.md` | 字段与校验规则（必读） |
| `{{harness_dir}}/skills/mockfinal-page-builder/references/design-language.md` | 内容与图示语气（只读 2.0 相关章节） |

{{template_notice}}

{{teaching_block}}

### 输出（只允许 1 个文件）

`{{build_dir}}/content.json`，字段如下（全部使用中文内容）：

```json
{
  "content_version": "2.0",
  "role": "concept | mechanism | worked_example | practice | compare | summary",
  "title": "页面标题，≤80 字",
  "eyebrow": "章标题 · 小主题（必须使用 brief.deck_context.chapter_title，禁止用 section_id/页码当讲次）",
  "lede": "一句话说明本页解决什么教学问题，≤120 字",
  "objectives": ["1–3 条可检验的学习目标"],
  "prerequisites": ["可选先修概念"],
  "scroll": "flow | fit",
  "blocks": [
    { "type": "prose", "title": "小标题", "text": "正文，支持 **加粗**、`代码` 与行内 $u_x=v_y$" },
    { "type": "callout", "kind": "key", "title": "核心结论", "text": "..." },
    { "type": "formula", "title": "公式名", "tex": "u_x=v_y,\\quad u_y=-v_x", "label": "可选的适用条件" },
    { "type": "example", "label": "例题 · 23-24 Q11", "problem": "题干", "problemTex": "\\oint_{|z|=3} ...", "steps": [
      { "title": "第一步", "text": "讲解", "tex": "..." }
    ], "answer": "$I=\\pi i/9$", "pitfall": "常见错误" }
  ],
  "figure": {
    "kind": "complex-plane | annulus",
    "caption": "图注",
    "takeaway": "一句话结论",
    "view": { "xMin": -5, "xMax": 5, "yMin": -4, "yMax": 4 },
    "states": [{ "label": "状态名", "note": "状态说明" }]
  },
  "check": [{ "objective_id": "o1", "question": "题干", "questionTex": "可选展示公式", "options": ["A", "B", "C"], "answer_index": 1, "explanation": "为什么" }],
  "summary": { "key_points": ["..."], "misconceptions": ["..."], "next": "下一页承接" },
  "source_refs": [{ "section_id": 12, "heading": "2.2 解析函数", "quote": "资料原文片段" }],
  "meta": { "exam": "对应大题 11", "minutes": 10, "source": "复变函数攻略 · 2.2" }
}
```

实际 figure 字段按 `content-schema.md` 的 `complex-plane` / `annulus` 结构写；不要发明其它 kind。

## 角色要求（由渲染器与校验器共同约束）

| role | 必须内容 | 图示 | 检查 | 滚动 |
| --- | --- | --- | --- | --- |
| concept | 核心结论 + 2–3 块讲解 + 易错 | 建议有，可省略 | 1 | flow |
| mechanism | 核心结论 + 3–5 步讲解 + 例题 + 易错 | 必须有，2–4 状态 | 1 | flow |
| worked_example | 题目 + 3–5 步 + 答案 + 常见错误 | 可选 | 1 | flow |
| practice | 2–4 题 + 解析 | 无 | 2–4 | fit |
| compare | 2–3 对象 + 维度 + 结论 + 易错 | 可选 | 1 | flow |
| summary | 要点 + 公式/表格 + 易错 | 无 | 0 | fit |

fit 页（practice / summary）最多 3 个 blocks；compare 允许滚动但仍保持 3 个 blocks，用 1 个 `compare` 块承载对照，不要再用 table 重复。flow 页的 concept / mechanism 首块用 `callout kind="key"` 写「核心结论」，让首屏先给结论，再展开原因。

## 写作硬约束

1. **内容优先**：每一段都要有信息量。禁止「如图可见」「让我们来看看」这类空话；正文汉字量不低于 300（summary 240），例题页不低于 340。
2. **公式一律 LaTeX**：行内 `$...$`，块级写在 `formula.tex` / `problemTex` / `questionTex` / `step.tex`。不要写 unicode 公式（如 `z²+1`）、不要用 HTML 上下标。可用 `\frac`、`\oint`、`\sum`、`\operatorname{Res}`、`\lim_{z\to z_0}`；禁止 `\htmlClass`、`\includegraphics`、`\href` 等扩展命令。
3. **图示是点缀**：一页最多 1 个 figure，2–4 个真正不同的状态（不是同一张图换颜色）；必须有 caption 与 takeaway。mechanism 必须配图；其余角色无合适图时宁可不放。图示内的 point/line/circle/label 标注只能写普通 Unicode 文本（如 `θ`、`z̄`、`2πi`），不能写 `$...$` 或 LaTeX 命令。
4. **教学闭环**：每页有目标、讲解/例题、易错、检查；检查必须有答案索引与解析，objective_id 绑定 `o1`–`oN`。summary 页可以没有检查。
5. **来源真实**：`source_refs` 至少 1 条，`section_id` 必须是 brief 中出现的 id，`quote` 必须是资料原文片段，不得编造。
6. **不写代码**：不要写 `page.html` / `page.css` / `page.js` / `manifest.json`；不要写 HTML 标签、内联样式、外链、图片或字体。
7. **长度**：flow 页目标 2.0–3.0 屏（1280 宽），fit 页必须 1280×720 单屏；fit 页最多 3 个块、正文按角色上限收紧（practice 520 字、summary 380 字）。宁可少一个次要段落，也不要塞满到需要滚动。
8. **单一认知焦点**：一页解决一个问题；标题写「要查什么/怎么做」，不要写「知识点一」。`eyebrow` 取 brief 的 `deck_context.chapter_title`，不要自行编号；section_id、页码、资料编号都不是讲次。

## 工作流

1. 读 `content-schema.md`、`{{brief_path}}` 与对应角色骨架 `content.json`；列出本页要回答的 1 个核心问题、3–5 个讲解块、1 个例题/检查。
2. 从 `{{materials_dir}}` 找到 brief 的 `section_id`，摘录 1–3 条原文写入 `source_refs`；公式与事实不改写。
3. 先写 `prose` / `callout` / `formula` 骨架，再补 `example` 的 3–5 步与 `check`，最后写 `figure`（如需要）。
4. 用 `edit` 修改构建目录已有的 `content.json` 骨架，不要整文件重写。
5. 调用 `check_page`；按 issues 修复（≤2 轮），最后一次必须 `passed`。
6. 结束只返回文件清单与校验结论（≤5 行），不输出 Markdown 解释。

## 常见失败与修复

- `ROLE_REQUIREMENT` / `FIGURE_REQUIRED`：按角色表补块或补图，不要删除要求来绕过。
- `DENSITY_TOO_LOW`：合并空泛段落，补定义、步骤、例题或易错；不要靠重复凑字数。
- `BLOCK_TOO_MANY` / `DENSITY_TOO_HIGH`：合并或删次要块，保持一页一个焦点。
- `FIGURE_INVALID`：状态数 2–4、字段名按 schema、点/线坐标必须是有限数字。
- `MATH_INVALID`：去掉不支持的宏，改用基础 KaTeX 命令。
- `CHECK_INVALID`：answer_index 从 0 开始且落在 options 内；explanation 不能为空。
- `CONTENT_JSON_INVALID`：检查 JSON 逗号、引号与反斜杠；LaTeX 反斜杠必须写成 `\\`（JSON 字符串内）。
