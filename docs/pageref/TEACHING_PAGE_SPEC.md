# 教学页规范（P9/P10）

> 目标：一页承载一个完整教学闭环，但任一时刻只保留一个认知焦点。
> 契约字段以 `PAGE_CONTRACT.md` §14 为准；本文件规定内容、密度与交互规则。
>
> **2026-11-08 · 2.0 增量**：`design_system="2.0"` 使用结构化 `content.json` 与构建期 page-kit 渲染，允许 concept/mechanism/worked_example/compare 页内纵向滚动（flow），practice/summary 仍单屏（fit）。本文的「桌面零滚动、主视觉占比、单页字数上限」等默认值只适用于 1.0；2.0 的角色、密度上下限、主题与滚动规则见 [PAGE_CONTENT_2.0.md](./PAGE_CONTENT_2.0.md)。

## 1. 2.5 层结构

```text
宿主学习面板（Vue overlay）：目标 / 讲解路线 / 公式 / 易错 / 随堂检查 / 依据 / AI
页面主舞台（Pi 生成）：一个论点 + 1 个主交互 + 3–5 个支撑块（桌面零滚动）
页内分层揭示：步骤器 / 标签页 / 折叠答案 / 预测-观察-解释（任一时刻只显示一层）
```

## 2. 密度预算

计数口径：正文汉字，不含标题、标签、公式、图注、按钮文案与解析。

| 项 | 预算 |
| --- | --- |
| 单层可见正文 | 建议 450–500 字（超出用渐进式披露） |
| 单页总正文（所有层） | ≤700 字（硬上限，超出必须拆页） |
| 可见内容块 | 3–6 个 |
| 页内总块数 | 5–8 个（含隐藏层） |
| 主交互 | 1 个（3–5 个学习状态） |
| 检查/揭示交互 | ≤1 个 |
| 可见公式 | ≤3 个；总公式 ≤6 个 |
| 最小字号 | 12px（<11px 为 error） |
| 视觉层级 | ≤3 层，一页一个“重”元素 |

## 3. 角色

| 角色 | 目的 | 必含 | 主交互 | 典型页数 |
| --- | --- | --- | --- | --- |
| `concept` | 建立正确概念 | 目标、3–4 步讲解链、1 个误区、1 个检查 | 分步揭示/对比切换 | 1 |
| `mechanism` | 理解过程/机制 | 目标、3–5 步链、动态可视化、预测问题、1 个检查 | 模拟/步进/参数调节 | 1 |
| `worked_example` | 会做一类题 | 题目、3–5 步解、答案、常见错误、1 个检查 | 步骤控制 + 答案揭示 | 1 |
| `practice` | 检索练习 | 2–4 题、答案、解析、目标映射 | 作答/揭示/重试 | 1 |
| `compare` | 辨析/选择 | 2–3 个对象、比较维度、结论、1 个误区 | 切换/对照 | 1 |
| `summary` | 记忆与串联 | 要点、公式、误区、下一页预告 | 展开/速查 | 1 |

复杂知识点允许拆成 `mechanism → worked_example → practice` 三页；每页仍遵守单层预算，不把三页内容压成一页。

## 4. 教学交互

| 类型 | 学习目的 | 必需反馈 |
| --- | --- | --- |
| `predict_observe` | 先预测再观察，制造认知冲突 | 预测与结果对照、解释 |
| `step_through` | 降低推导/算法步骤负荷 | 当前步骤、已完成、总步数 |
| `simulate` | 观察参数/输入变化 | 状态变化 + 读出的结论 |
| `compare` | 辨析易混概念 | 差异结论 + 易错提醒 |
| `retrieve` | 检索练习 | 正确性 + 解析 + 目标映射 |
| `summarize` | 组织与记忆 | 要点/公式/口诀 |

规则：每页只有一个主交互；交互必须绑定 `objective_id`；冒烟必须验证可观察状态变化；reduced-motion 下状态立即切换。

## 5. 反模式

- 用 `overflow:auto/scroll` 或缩小字号把 900 字塞进一屏；
- 一页 3 个同等重要的交互；
- 讲解链全部铺开再用淡入动画“装饰”；
- 只有演示没有问题，或只有题目没有讲解；
- 检查题缺少答案/解析，或与目标不对应；
- 页面之间没有承接，每页都是独立 demo。

## 6. 校验

- 结构（error）：`TEACHING_MISSING` / `TEACHING_INVALID` / `TEACHING_BLOCK_MISSING` / `TEACHING_CHECK_MISSING` / `TEACHING_OBJECTIVE_MISMATCH`；覆盖 teaching 必填、role 枚举、objectives 1–3、chain block 引用、检查题答案/解析/目标映射。
- 内容（error）：`CONTENT_BUDGET_EXCEEDED`（整页 >700 汉字）、`CONTENT_CLIPPED`、`MIN_FONT_TOO_SMALL`（<11px）、`ZERO_SCROLL_OVERFLOW` / `INTERNAL_SCROLL`（桌面）、`MOBILE_HORIZONTAL_OVERFLOW` / `MOBILE_SCROLL_BLOCKED`（移动端）。
- 质量（warning）：`CONTENT_LAYER_WARNING`（单层 >500 字）、`CONTENT_BLOCKS_WARNING`（可见块 >6 或总块 >8）、`MIN_FONT_WARNING`（<12px）、`CSS_BUDGET_WARNING`（page.css >4 KiB）、`TEACHING_SCORE_LOW`。
- 教学评分（0–100）：目标 20 / 讲解链 20 / 例题 20（`worked_example`；其他角色提供例题得 10）/ 误区 15 / 检查检索 15 / 来源与承接 10。
- 冒烟交互后复测零滚动、内容裁剪与最小字号；渐进式披露展开后同样必须通过。

## 7. 模板与夹具（P10）

- Builder 角色模板：`builder/pi-harness/templates/roles/<role>/` 各含 `manifest.json/page.html/page.css/page.js`，`prepareWorkspace` 在构建目录预置；Pi 以模板为起点，只改必要文件。
- Golden fixtures：`validator/fixtures/good-teaching*.bundle.json` 覆盖 6 个角色；静态检查 0 error、教学评分 ≥70、1280×720 浏览器检查 0 error；`good-teaching` 另测桌面三视口与 390×844。
- Deck Kit：`manifest.design_system = "1.0"` 时 Shell 注入版本化 `DECK_KIT_CSS`（卡片/步骤器/检查/按钮等基线）；旧 1.0 bundle 不注入，渲染不变。

