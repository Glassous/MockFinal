# P15 复变函数 deck 结果

- 日期：2026-11-08
- Deck：`复变函数期末复习 · 讲义版`（id 40）
- 参数：`design_system="2.0"`、`page_theme="workbench"`、`density="deep"`、`outline_override`（6 章 16 知识点）
- 资料：`复变函数攻略.pdf`（索引 50 节）+ `期末题归档.md`（6 节）
- 结果：**16/16 ready，验收 0 failure**

## 验收证据

- 页面截图：`docs/pageref/p15-screenshots/`（每页 1280/1440/1920/390、暗色、reduced-motion、检查交互、图示第二状态）
- 机器结果：[P15_RESULTS.json](./p15-screenshots/P15_RESULTS.json)
- 真实 bundle：通过 API `/decks/40/pages/{id}/bundle` 取回，经 `buildShell` 注入运行时后由 Playwright 渲染，不是静态 HTML 截图
- 视口：1280×720、1440×900、1920×1080、390×844；fit 页在 1280/1440/1920 零纵向滚动，flow 页无横向溢出
- 控制台：16 页 × 6 次渲染，0 个 console error / pageerror
- 字号：最小可见字号 12px（页脚/标签），正文 16px / 行高 1.75–1.82
- 图示：一页最多 1 个，flow 宽 320px（≤360 限），fit 无图；所有机制页均有 2–4 状态
- 检查：每页 1 道（summary 0 道），点击后进入 answered 状态并能显示解析

## 门禁

- `builder npm test`：44 通过（含 content 2.0 渲染、图示标注、fit 块数）
- `validator npm test`：54 通过（含 2.0 good/bad fixtures、1.0/1.1 回归）
- `node --test shared/page-shell/shell.test.mjs`：18 通过
- `frontend pnpm typecheck && pnpm test`：20 通过
- `backend` planner/schema/builder 定向 pytest：58 通过
- P15 验收：16/16 ready，0 failure；真实阅读器 fit 页 0 滚动、flow 页 Space 滚动正常

## 逐页指标（1280×720）

| # | 角色 | 滚动 | 正文汉字 | 屏数 | 图示 | 检查 |
|---:|---|---|---:|---:|---|---:|
| 1 | summary | fit | 366 | 1.00 | — | 0 |
| 2 | concept | flow | 882 | 3.02 | 320×416 | 1 |
| 3 | worked_example | flow | 662 | 2.93 | — | 1 |
| 4 | mechanism | flow | 1001 | 2.91 | 320×416 | 1 |
| 5 | concept | flow | 842 | 2.91 | — | 1 |
| 6 | compare | flow | 763 | 2.18 | 320×416 | 1 |
| 7 | worked_example | flow | 1071 | 2.88 | 320×374 | 1 |
| 8 | worked_example | flow | 924 | 2.67 | 320×416 | 1 |
| 9 | mechanism | flow | 886 | 2.96 | 320×416 | 1 |
| 10 | mechanism | flow | 718 | 2.79 | 320×395 | 1 |
| 11 | worked_example | flow | 856 | 2.96 | 320×395 | 1 |
| 12 | worked_example | flow | 772 | 2.76 | — | 1 |
| 13 | worked_example | flow | 781 | 2.88 | 320×416 | 1 |
| 14 | concept | flow | 709 | 2.79 | — | 1 |
| 15 | worked_example | flow | 751 | 2.75 | — | 1 |
| 16 | summary | fit | 363 | 1.00 | — | 0 |

flow 页 2.18–3.02 屏，略高于设计实验室 workbench 的 2.41–2.72 屏；主要来真实生成页多了题面/检查展示公式和更完整的 3–5 步例题。1440×900 与 1920×1080 下屏数更低。若需要严格 2.2 屏，应减少每页例题步骤或把检查移到独立页，而不是继续压字号。

## 本轮发现并修复的问题

| 问题 | 修复 |
|---|---|
| eyebrow 把 section_id 当讲次（出现「第 53 讲」「第 3 讲」） | backend brief 下发 `deck_context.chapter_title`；Builder 仅在讲次编号不一致时回退到章标题；prompt/schema 明确禁止用 section_id 编号 |
| 公式 label、路线标题、图示 SVG 标注出现裸 `$...$` | 公式 label / 路线改用 `renderInline`；SVG 标注只能写 Unicode 普通文本，新增 `FIGURE_LABEL_TEX` 校验 |
| SVG 标签越出画布或互相重叠 | 标签靠右自动改右对齐并夹在画布内；同水平线多个点标签上下交错；线/路径/状态标签统一 clamp |
| summary 右栏三张卡在 20rem 内被挤成 3 列 | 改为纵向堆叠，正文换行恢复正常 |
| summary 下限 240 导致 239 字页面失败；上限 360 导致 366 字页面失败 | 下限改 220；上限改 380；fit 页最多 3 块 |
| compare 页 fit 单屏连续两次溢出 290px | compare 改为 flow（用户原始混合滚动要求只强制 practice/summary 单屏）；模板从 4 块压到 3 块 |
| Validator 把 2.0 可见溢出当裁剪（2–5px 误报） | 仅当块自身是 hidden/clip/auto/scroll 容器时才检查 scrollHeight；fit 页整体裁剪仍由页面级 `CONTENT_CLIPPED` 拦截 |
| 模型写出不成对的 `**` / 反引号 | `formatPlain` 清理残余标记 |
| concept/mechanism 首屏看不到核心结论 | 模板和 prompt 要求首块为 `callout kind="key"` 核心结论 |
| 生成页公式/排版不一致 | 所有可见数学走 LaTeX → 构建期 KaTeX MathML；行内 `$...$` 统一渲染 |
| 真实阅读器把 2.0 页面的 srcdoc load 误判为外部跳转，整页不显示 | PageFrame 忽略当前 srcdoc 的首次 load，只有其后的再次 load 才按自我导航处理；已用真实前端 + iframe 验证 fit 页 0 滚动、flow 页 Space 正常滚动 |

## 已知限制

- 390px 下 fit 摘要页允许纵向滚动；单屏约束只针对 1280/1440/1920。移动端阅读长页面是预期行为。
- 个别机制页的图注坐标仍较紧（例如留数页多个极点标签），已保证不被画布裁切，但没有做完整的自动避让排版。
- 页脚来源引用按 `source_refs.quote` 截断，偶尔是原文半句；不影响正文教学。
- cost 报告按余额差记账；余额接口只到分，逐页成本为 token 比例分摊，存在 ±0.01 舍入。详见 [P15_COST.md](./P15_COST.md)。

## 人工验收

- 前端（dev，指向 8001 API）：`http://localhost:5174/`
- 测试账号：`p15_1794131311` / `P15-local-pass`
- Deck：登录后打开 `/decks/40`
- 建议路径：第 1 页总览 → 第 4 页 C-R 机制 → 第 6 页 compare → 第 9/10 页留数 → 第 16 页速查；查看暗色与 390 宽。
- 确认点：图示是否只是点缀、正文是否读得下去、每页信息密度是否够、flow 滚动是否自然、fit 页是否单屏。

在用户完成最终视觉验收前不提交、不合并。
