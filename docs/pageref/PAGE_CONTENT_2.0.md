# PageContent 2.0：结构化讲义页

日期：2026-11-08
状态：Phase 1 设计实验室完成（workbench 主基调）；Phase 2 流水线接入完成。

## 1. 目标与边界

2.0 把复习页从「每页手写 HTML/CSS/JS 的演示页」改为「模型只写 `content.json`，构建期统一渲染」：

- **内容可控**：块类型固定、密度有上下限、公式必须 LaTeX、图示只能声明式。
- **排版稳定**：字体、间距、卡片、响应式、暗色由 page-kit 统一提供，页面不能自由写 CSS。
- **图是点缀**：一页最多 1 个图示；flow 页图示在右栏（≤360px），fit 页面积 ≤35%。
- **保留隔离**：产物仍是 `PageBundle{schema_version:"1.1", html, css:"", js:""}`；前端 iframe / Validator / 后端存储不变。
- **旧页不变**：`design_system="1.0"` 的 bundle 渲染与校验逐字节不变；2.0 全部是增量分支。

## 2. 数据流

```text
PageBrief (backend)
  → Pi 只写 content.json
  → builder/src/page-kit/render.ts 构建期渲染
      content → html + 空 css/js + manifest(design_system=2.0, renderer, teaching)
  → collectBundle 静态检查 → Validator（API）→ bundle 存储
  → PageFrame(srcdoc) + shared/page-shell（注入 PAGE_KIT_CSS / PAGE_KIT_JS）
```

`content_schema="2.0"` 时 Builder：

- 只要求 `content.json`，不要求 manifest/page.html/page.css/page.js。
- Guard 扩展只允许写 `content.json`；提示词使用 `build-page-content.md`；角色模板为 `templates/roles/<role>/content.json`。
- manifest 由渲染器生成；`page_id`、主题、知识点 ID、来源引用会从 brief 注入/校正。
- `check_page` 与最终校验仍走同一套 Builder/Validator 链路。

## 3. content.json

字段定义与示例见 [PageContent 2.0 schema](file:///E:/AIWorkspace/Qoder/MockFinal/builder/pi-harness/skills/mockfinal-page-builder/references/content-schema.md)，
机器可读类型见 `builder/src/page-kit/types.ts`。

顶层：

| 字段 | 说明 |
|---|---|
| `content_version` | 固定 `"2.0"` |
| `role` | concept / mechanism / worked_example / practice / compare / summary |
| `title` / `eyebrow` / `lede` | 页面标题、眉题、一句话导语 |
| `objectives` | 1–3 条可检验目标 |
| `prerequisites` | 可选先修 |
| `scroll` | flow / fit；默认由 role 决定 |
| `blocks` | 3–10 个块（fit 角色下限更低） |
| `figure` | 可选，最多 1 个 |
| `check` | 随堂检查（数量按角色） |
| `summary` | key_points / misconceptions / next |
| `source_refs` | 至少 1 条，quote 必须来自资料 |
| `meta` | exam / minutes / source |

块类型：`prose`、`formula`、`callout`、`example`、`compare`、`table`。检查与小结是顶层字段，不混进 blocks。

### 公式

所有数学用 LaTeX：

- 行内 `$...$`，支持在 prose / callout / example / check / table / figure caption 中混排。
- 块级写在 `formula.tex`、`example.problemTex`、`example.steps[].tex`、`check.questionTex`。
- 构建期用 KaTeX `output:'mathml'` 输出 MathML，零字体、零外链、暗色自动继承。
- 禁止 unicode 公式、HTML 上下标与 `\href` / `\includegraphics` 等扩展命令。

### 图示

只允许声明式 widget：

- `complex-plane`：点（point/pole/zero）、圆、线、路径、标签、圆环；等比例坐标，圆是真圆。
- `annulus`：收敛圆环、内外半径、奇点与 2–4 个状态。

一页最多 1 个，2–4 个语义不同的状态；必须有 `caption` 与 `takeaway`。
mechanism 必须有图；practice/summary 不允许图。

## 4. 角色要求

| role | 必须内容 | 图示 | 检查 | 滚动 | 最少正文汉字 |
|---|---|---|---|---|---:|
| concept | 核心结论/定义 + 3–5 块讲解 + 易错 | 建议 | 1 | flow | 300 |
| mechanism | 核心结论 + 3–5 步讲解 + 例题 + 易错 | 必须（2–4 状态） | 1 | flow | 320 |
| worked_example | 题目 + 3–5 步 + 答案 + 易错 | 可选 | 1 | flow | 340 |
| practice | 2–4 题 + 解析（检查承载） | 禁止 | 2–4 | fit | 340 |
| compare | 2–3 对象 + 维度 + 结论 + 易错 | 可选 | 1 | flow | 320 |
| summary | 要点 + 公式/表格 + 易错 | 禁止 | 0–3 | fit | 220 |

密度同时有上限：flow 正文 ≤1800 汉字（建议 500–1100），fit ≤520（practice）/380（summary）；fit 页最多 3 个块。
fit 角色不要求凑满 3 个讲解块（practice 可为 1 个 prose + 2 个检查；summary 建议 3 块 + 右栏要点卡）。

## 5. 主题与布局

统一语义 DOM：`header` → `nav`（本页/解题路线）→ `main`（讲解块 + 检查）→ `aside`（图示 + 速查；summary 页放小结卡）→ `footer`。

三个 CSS 主题（只改布局/字体/间距，不改 HTML）：

| 主题 | 定位 | 正文 |
|---|---|---|
| `editorial` | 纸面讲义，44rem 正文 + 页边注 | 17px / 1.85 |
| `workbench` ✅ 主基调 | 左路线 + 中央正文 + 右速查/图 | 16px / 1.82 |
| `problem` | 题解 hero + 步骤脊柱 | 16.5px / 1.8 |

workbench 细节：

- 路线 sticky（桌面 top 18px，移动端 top 8px），滚动时高亮当前步骤；worked_example 的路线直达每个步骤锚点。
- 亚克力卡片：半透明玻璃底 + blur 24px + 内高光 + 软阴影；页面背景有单色光斑。
- 标题、讲解标题、核心卡标题使用衬线展示字体；正文无衬线；tabular numerals。
- 视口高度 <860px 时右栏改为随正文滚动，避免底部速查不可见。

## 6. 滚动策略

`teaching.scroll` 决定 shell 行为：

- `flow`：`html` 承接纵向滚动，`body` 保持 `overflow:visible`（sticky 才有效）；Space/PageDown/↑/↓ 正常滚动，仅 ArrowLeft/ArrowRight 翻页；禁止横向溢出与内部滚动；总高 ≤2000px 建议 / ≤2200px 硬上限。
- `fit`：保持单屏零滚动；底部内容不得被裁剪；`.pg-page.scrollHeight` 超出视口即 `CONTENT_CLIPPED`。
- 移动端：页面可纵向滚动，禁止横向溢出；长公式可横向滑动并显示提示。

## 7. manifest 映射

渲染器生成的 manifest：

```json
{
  "schema_version": "1.1",
  "design_system": "2.0",
  "renderer": { "kit": "page-kit", "version": "2.0.0", "theme": "workbench" },
  "teaching": {
    "version": "1.0",
    "role": "mechanism",
    "objectives": [],
    "chain": [{ "id": "c1", "title": "…", "block_id": "b1" }],
    "check": [],
    "summary": {},
    "scroll": "flow",
    "content_version": "2.0"
  },
  "interactions": [{ "id": "figure", "type": "step", "smoke": { "...": "..." } }],
  "source_refs": []
}
```

- `teaching.chain[].block_id` 指向 `data-mp-block`，保证教学链与选区/`focus_block` 继续工作。
- worked_example 的链步骤在页面上有额外锚点 `b4-s1…` 供路线跳转，但 manifest 仍引用整个例题块。
- `interactions` 最多包含图示与检查两个冒烟步骤；无交互时声明 `none`。

## 8. 校验

新增/调整的规则：

| 规则 | 行为 |
|---|---|
| `CONTENT_SPARSE` | 按 role 的字数下限；fit summary 220 |
| `CONTENT_CLIPPED` | fit 页 `.pg-page` 内容超出单屏，底部被裁剪 |
| `WHITESPACE_EXCESS` | fit 页正文底部 <65% 视口（warning） |
| `FLOW_PAGE_TOO_LONG` | flow 总高 >2000 建议 / >2200 error |
| `FIGURE_TOO_LARGE` | flow >360 warning / >380 error；fit >35% warning / >45% error |
| `SCROLL_POLICY_VIOLATION` | flow 横向溢出、内部滚动或被 hidden 锁死 |
| `MIN_FONT_TOO_SMALL` | 2.0 可见文本 <12px error；MathML 上下标除外 |

教学评分：summary 页检查可选，未提供检查时不再扣分（仍要求 objectives/chain/misconceptions/sources）。

fixtures：

- `validator/fixtures/good-pg2-{mechanism,worked-example,summary}.bundle.json`
- `validator/fixtures/bad-pg2-{sparse,figure-large,flow-long,fit-overflow,min-font}.bundle.json`

## 9. 如何生成一页 2.0

1. Backend brief 带 `constraints.content_schema="2.0"`、`design_system="2.0"`、`page_theme`（见 `deck_planner.build_page_brief`）。
2. Builder 在构建目录放入 `templates/roles/<role>/content.json`。
3. Pi 按 `build-page-content.md` 只改 `content.json`，调用 `check_page`。
4. Builder 渲染 + Validator 通过后，bundle 正常入库；前端 `PageFrame` 无需改动。
5. 阅读器对 flow 页只拦截左右翻页键，Space/PageDown 交给 iframe。

## 10. 回滚

把 deck 的 `style.design_system` 改回 `"1.0"` 并重新构建，或让 planner 不下发 `content_schema="2.0"`。
shell 的 2.0 分支是加法的，旧 bundle 不受影响。
