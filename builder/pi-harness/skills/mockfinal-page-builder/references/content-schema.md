# PageContent 2.0 内容 schema

> 适用：`brief.constraints.content_schema === "2.0"`。
> 此时只写 `content.json`；manifest、HTML、CSS、JS 全部由构建期 `page-kit` 渲染器生成。
> 1.0 页面仍按 `page-contract.md` 写 4 个文件，本文不适用。

## 1. 顶层字段

```json
{
  "content_version": "2.0",
  "role": "concept | mechanism | worked_example | practice | compare | summary",
  "title": "≤80 字",
  "eyebrow": "章标题 · 小主题（取 brief.deck_context.chapter_title）",
  "lede": "≤120 字",
  "objectives": ["1–3 条"],
  "prerequisites": ["可选，≤6 条"],
  "scroll": "flow | fit",
  "blocks": [],
  "figure": null,
  "check": [],
  "summary": {},
  "source_refs": [],
  "meta": { "exam": "", "minutes": 8, "source": "" }
}
```

校验规则：

- `objectives` 1–3 条；flow 页 `blocks` 3–10 个，fit 页最多 3 个；`figure` 最多 1 个；`check` 数量按角色；`source_refs` 每页至少 1 条。
- `scroll` 默认由角色决定：concept/mechanism/worked_example/compare = `flow`；practice/summary = `fit`。不要随意改。
- 标题、lede、block 内的数学一律 LaTeX；`eyebrow` 必须取 brief 的 `deck_context.chapter_title`，不要用 section_id、页码或资料编号当讲次。

## 2. blocks

### prose

```json
{ "type": "prose", "title": "小标题", "text": "正文，**加粗**、`代码`、行内 $x^2$" }
```

### formula

```json
{ "type": "formula", "title": "公式名", "tex": "u_x=v_y,\\quad u_y=-v_x", "label": "适用条件", "display": true }
```

### callout

`kind` 只能是 `definition | theorem | key | warn | pitfall | note`。

```json
{ "type": "callout", "kind": "key", "title": "核心结论", "text": "..." }
```

### example

3–5 步；`answer` 必填；`problemTex` 是题目下方的展示公式。

```json
{
  "type": "example",
  "label": "例题 · 23-24 Q11",
  "problem": "题干",
  "problemTex": "I=\\oint_{|z|=3}\\frac{z^2+1}{(z-1)(z+2)(z-4)}\\,dz",
  "steps": [
    { "title": "找奇点", "text": "分母为零...", "tex": "z_1=1,\\ z_2=-2,\\ z_3=4" }
  ],
  "answer": "$I=\\pi i/9$",
  "pitfall": "别把圈外的 4 算进去"
}
```

### compare

2–3 列；每列 1–6 项；`verdict` 可选。

```json
{
  "type": "compare",
  "title": "逐项对照",
  "columns": [
    { "title": "A", "items": ["...", "..."] },
    { "title": "B", "items": ["...", "..."] }
  ],
  "verdict": "一句话选择规则"
}
```

### table

`headers` 与每行 `cells` 长度一致；最多 6 列。

```json
{ "type": "table", "title": "识别信号", "headers": ["信号", "A", "B"], "rows": [["...", "...", "..."]], "caption": "可选" }
```

## 3. figure

一页最多 1 个；2–4 个**语义不同**的状态；必须有 `caption` 与 `takeaway`。
mechanism 必须有图；practice/summary 不允许图。

### complex-plane

```json
{
  "kind": "complex-plane",
  "caption": "两条路径的极限必须相等",
  "takeaway": "C-R 方程是两个方向导数的一致条件",
  "view": { "xMin": -5, "xMax": 5, "yMin": -4, "yMax": 4 },
  "points": [
    { "x": 0, "y": 0, "label": "0", "kind": "point" },
    { "x": 1, "y": 0, "label": "1", "kind": "pole" }
  ],
  "circles": [{ "cx": 0, "cy": 0, "r": 3, "label": "|z|=3" }],
  "lines": [{ "from": [0, 0], "to": [1.5, 0], "arrow": true, "label": "Δx", "dashed": false }],
  "paths": [{ "points": [[0, 0], [1, 0], [1, 1]], "arrow": true, "label": "路径" }],
  "states": [
    { "label": "沿实轴", "note": "Δz=Δx", "lines": [{ "from": [0, 0], "to": [1.4, 0], "arrow": true }] },
    { "label": "沿虚轴", "note": "Δz=iΔy", "lines": [{ "from": [0, 0], "to": [0, 1.4], "arrow": true }] }
  ]
}
```

- 坐标必须等比例；圆用 `circles`，不要用椭圆近似。
- `states` 内可覆盖 `lines/paths/labels/rings`；顶层点/圆/线在所有状态可见。
- SVG 内所有 `label` / `text` 只能是普通 Unicode 文本（如 `θ`、`z̄`、`2πi`）；不能写 `$...$` 或 LaTeX 命令，否则校验报 `FIGURE_LABEL_TEX`。
- 标签位置可用 `labelDx/labelDy/labelAnchor` 微调，避免互相遮挡。

### annulus

```json
{
  "kind": "annulus",
  "caption": "收敛域",
  "takeaway": "圆环内可展开",
  "center": [0, 0],
  "innerRadius": 1,
  "outerRadius": 3,
  "points": [{ "x": 2, "y": 0, "label": "奇点" }],
  "states": [{ "label": "1<|z|<3", "note": "..." }, { "label": "|z|>3", "note": "..." }]
}
```

## 4. check

```json
{
  "objective_id": "o1",
  "question": "下列判断正确的是？",
  "questionTex": "I=\\oint_{|z|=3}\\frac{z^2+1}{(z-1)(z+2)(z-4)}\\,dz",
  "options": ["A", "B", "C"],
  "answer_index": 1,
  "explanation": "只有 1 和 -2 在圈内..."
}
```

- 选项 2–6 个；`answer_index` 从 0 开始；`explanation` 必填。
- `objective_id` 绑定 `o1`–`oN`（按 objectives 顺序）。
- concept/mechanism/worked_example/compare 各 1 题；practice 2–4 题；summary 0–3 题。

## 5. summary

```json
{
  "key_points": ["..."],
  "misconceptions": ["..."],
  "next": "下一页承接"
}
```

practice 建议提供；summary 必须提供 `key_points`。

## 6. source_refs

```json
[{ "section_id": 12, "material_id": 3, "heading": "2.2 解析函数", "quote": "资料原文片段（≤240 字）" }]
```

- `section_id` 必须来自 brief 的 `source_excerpts`；`quote` 必须是原文，不得改写或编造。
- 至少 1 条；建议每页 1–3 条。

## 7. 角色最低要求

| role | 必须 | 检查 | 图示 | 滚动 | 最少正文汉字 | fit 上限 / 最多块 |
| --- | --- | --- | --- | --- | --- | --- |
| concept | 核心结论 + 2–3 块讲解 + 易错 | 1 | 建议 | flow | 300 | — / 10 |
| mechanism | 核心结论 + 3–5 步讲解 + 例题 + 易错 | 1 | 必须（2–4 状态） | flow | 320 | — / 10 |
| worked_example | 题目 + 3–5 步 + 答案 + 易错 | 1 | 可选 | flow | 340 | — / 10 |
| practice | 2–4 题 + 解析 | 2–4 | 禁止 | fit | 340 | 520 / 3 |
| compare | 2–3 对象 + 维度 + 结论 + 易错 | 1 | 可选 | flow | 320 | — / 3 |
| summary | 要点 + 公式/表格 + 易错 | 0–3 | 禁止 | fit | 220 | 380 / 3 |

## 8. 长度与排版

渲染器负责排版，作者只控制内容量：

- flow 页目标 2.0–3.0 屏（1280 宽）；单页正文建议 500–1100 汉字，超过 1800 字会警告。
- fit 页必须 1280×720 单屏；最多 3 个块，正文按上表收紧；超出会报 `CONTENT_TOO_LONG`。
- 一页只解决一个认知焦点；宁可少一个次要块，也不要靠缩字号或删检查来硬塞。
- 不要写颜色、字号、间距、布局字段——这些由主题统一决定。

## 9. 常见错误码

| 错误码 | 修复 |
| --- | --- |
| `CONTENT_SPARSE` | 补定义、步骤、例题或易错，不要重复凑字 |
| `ROLE_REQUIREMENT` | 按角色表补块/例题/对照/易错 |
| `FIGURE_REQUIRED` | mechanism 补图；或改为其它角色（需符合页面计划） |
| `FIGURE_NOT_ALLOWED` | practice/summary 删除 figure |
| `FIGURE_INVALID` | 状态 2–4、字段名正确、坐标有限 |
| `FIGURE_LABEL_TEX` | 图示标注改成普通 Unicode 文本，不要 `$...$` / LaTeX |
| `MATH_INVALID` | 去掉不支持的宏，改用基础 KaTeX |
| `CHECK_INVALID` | 修正 answer_index / options / explanation |
| `SOURCE_REFS_INVALID` | quote 非空、≤240 字；section_id 真实 |
| `BLOCK_TOO_MANY` | 合并次要块，单页 ≤10 |
