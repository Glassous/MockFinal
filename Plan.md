# PageRef v2 · 教学化高密度页面与体验精修

> 本文件已**覆盖**旧版 `Plan.md`。旧版 P0–P7（去 Embedding、Pi Builder、Deck 领域、构建集成、阅读器、AI 助手、加固）已完成，历史证据保留在 `docs/pageref/P2_REPORT.md`、`P3_REPORT.md`、`P4_REPORT.md`、`P5_REPORT.md`、`P6_REPORT.md`、`P7_REPORT.md` 与对应截图/结果 JSON 中；本文件只保留继续生效的安全与工程不变量，不再重复旧路线。
>
> **状态**：方案调研完成（2026-11-08），待维护者确认后实施。**本轮不修改代码、不触发真实模型构建。**
>
> **基线**：`main` + `feat/pageref` P0–P7；真实 Pi 14 页 E2E 为 15m11s / ¥1.69 / 14 页全部 ready（DeepSeek Flash，见 `P4_REAL_E2E.json`）。
>
> **目标读者**：项目维护者、后端/前端开发者、Builder/Validator 维护者。

---

## 0. 结论摘要

### 0.1 问题诊断

单页信息密度低，不是模型“不会写”，而是三处结构性约束共同造成的：

1. **页面契约把“演示”写成了硬预算**：每页 1 个核心观点、3–5 个内容块、1 个主交互、正文 ≤250 中文字符（`builder/pi-harness/skills/mockfinal-page-builder/references/design-language.md:57-71`）。这套预算能保证桌面零滚动，但结构上排斥讲解链、例题、检查题和章节小结。
2. **每页一个 Pi 会话**：`builder/src/session.ts:639-714` 每页重新创建 ModelRuntime、ResourceLoader、Session；每页重读约 56KB 的 Skill/References/Templates；`SessionManager.inMemory(task.buildDir)` 使页与页之间没有上下文。P2 实测每页输入 20.7k–22.4k tokens、输出 13.1k–26.5k tokens（`docs/pageref/P2_REPORT.md`），且 `usageFromSession` 丢弃 `cacheRead/cacheWrite`（`builder/src/session.ts:612-623`），无法证明缓存收益。
3. **宿主没有教学层**：大纲里的 `objectives/key_points/formulas/misconceptions` 已进入 Page Brief（`backend/app/services/deck_planner.py:708-718`），但阅读器只展示页面 iframe、依据资料和 AI 助手；目标、要点、易错、公式、检查题均未呈现。阅读器还在停留 3 秒后自动把页面标为“已读”（`frontend/src/views/DeckReaderView.vue:208-227`），这不是学习完成。

结论：需要同时改**页面形态、构建框架、宿主呈现**，只加字数或只换模型都不会得到“有密度且有教学感”的页面。

### 0.2 选定方案：2.5 层教学页

```text
第 0.5 层：宿主教学工作台（Vue）
  └─ 本页目标 / 讲解路线 / 公式 / 易错点 / 随堂检查 / 依据 / AI
第 1 层：页面主舞台（Pi 生成；桌面零滚动，移动端可滚动）
  └─ 一个核心论点 + 一个主视觉/交互 + 3–5 个支撑块
第 2 层：页内分层揭示（Pi 生成）
  └─ 步骤器 / 标签页 / 折叠答案 / 预测-观察-解释
```

- **主舞台**负责“讲清楚 + 看得见 + 动手做”，保持一个认知焦点。
- **分层揭示**让同一屏承载完整讲解链，但任一时刻只显示一层，避免视觉拥挤。
- **宿主教学工作台**承担元学习信息（目标、要点、公式、易错、检查、来源），并让 AI 助手围绕本页教学上下文回答。
- **角色化页面**把“一页一个知识点”升级为“一页一个教学环节”：概念、机制、例题、练习、对比、小结；复杂知识点允许拆 2–3 页，而不是把所有内容硬塞进一页。

### 0.3 关键决策

| # | 决策 | 结论 | 主要理由 |
| --- | --- | --- | --- |
| D1 | 单页密度方案 | **分层揭示 + 宿主教学工作台 + 角色化页面**；不为增密缩小字号或恢复桌面页面滚动（移动端允许纵向滚动） | 保持桌面零滚动与可读性，同时把整页教学内容从约 250 字提升到最多 700 字（约 3 倍） |
| D2 | 教学契约 | `manifest.teaching` 成为新页面的必填结构；缺失/不完整由 Validator 与 Builder 双重拦截 | 让“教学”可验证，而不是靠提示词祈祷 |
| D3 | 页面设计系统 | 由宿主 Shell 注入版本化 `DECK_KIT_CSS`，Bundle 只写语义结构与局部样式 | 统一视觉、降低输出 token、避免每页重复造轮子；Validator 与阅读器共用同一份 |
| D4 | Pi 会话 | **Deck 级 lane 会话**（默认 2 条 lane，按章节分配页面，lane 内串行），页级失败隔离与轮换 | 复用稳定前缀与上下文缓存，降低费用；保留并发与失败隔离 |
| D5 | Prompt 结构 | 稳定前缀 + 每页短任务卡 + 模板起步 + “只改必要文件”；合并三份重复硬约束 | 降低输入 token，减少长篇复述与整页重写 |
| D6 | 思考档位 | 接线 `PAGE_BUILDER_THINKING`；默认 `low`/`minimal`，复杂机制页可升 `medium`，练习/小结可 `off` | 模板与 Validator 足够强时，思考成本可以显著下降 |
| D7 | 教学校验 | 结构完整性为 error；教学质量指标先 warning，校准后升级为门禁 | 先保证“教学生成得了”，再保证“教得好” |
| D8 | 前端呈现 | 统一右侧“学习面板”（本页/检查/依据/AI），显式“学完本页”；不再 3 秒自动完成 | 减少浮层割裂，建立真实学习闭环 |
| D9 | 兼容与发布 | 新旧 Bundle/Runtime 并存；Feature Flag 可回退到逐页会话 | 不破坏已生成页面，允许逐步放量 |
| D10 | 真实模型验证预算 | 本轮方案实施阶段的真实模型验证总预算 **≤ ¥6**，超出前暂停并汇报 | 遵守维护者的付费 API 预算约束 |

### 0.4 预期结果

| 维度 | 当前 | 目标 |
| --- | --- | --- |
| 单页教学信息量 | 约 250 字 / 3–5 块 / 1 交互 | 页内总正文 450–700 字 / 5–8 块（分层）/ 1 主交互 + 1 检查；宿主教学层再承载 300–600 字 |
| 可见视觉密度 | 低，演示感强 | 单层建议 450–500 字、可见块 3–6；用渐进式披露控制单屏节奏，整页有完整讲解链与检查 |
| Deck 构建成本 | 14 页约 ¥1.69 | 同规模 ≤ ¥1.0–1.2（目标 -30%～-40%） |
| 单页输入 token | 20.7k–22.4k | 首屏后 ≤8k，缓存命中率可观测且 ≥40% |
| 首轮校验通过率 | 3/3（P2 小样本） | 黄金集 ≥75%，修复 1 轮后 ≥95% |
| 教学结构完整率 | 未度量 | 新页面 100% 具备角色、目标、讲解链、检查 |
| 桌面零滚动 | 100% | 100%（1280/1440/1920 + 阅读器内容视口）；移动端允许纵向滚动、禁止横向溢出 |
| 安全 | P7 基线 | 不放宽任何 CSP/沙箱/外链/HTML 禁用规则 |

---

## 1. 现状审计（代码事实）

### 1.1 页面形态：为“演示”优化，而非“教学”

- 契约规定的页面预算是“一屏一个论点 + 3–5 块 + 1 个主交互 + ≤250 字正文”（`design-language.md:57-71`；`docs/pageref/PAGE_CONTRACT.md` §9）。这适合做“动态 PPT 的一页”，不适合承载“目标 → 讲解 → 例题 → 检查 → 小结”的完整教学闭环。
- 页面骨架只有 `mp-head / mp-body / mp-foot`，模板的侧栏最多放 3 条速查信息（`builder/pi-harness/templates/page-base/page.html`）。没有“例题步骤”“检查题”“讲解链”的语义位置。
- 黄金示例的正文约 356–511 字符、1 个主交互；学习目标、检查题、答案均未进入页面或宿主（`builder/fixtures/golden/*/bundle.json`）。
- 当前的“动态性”主要是单个演示的状态切换；没有“先预测、再观察、再解释”的教学交互，也没有把交互结果反馈到学习判断。

### 1.2 构建成本：每页从零开始

- `runPiBuild` 每页执行：准备独立 cwd → 渲染完整 build-page prompt → 新建 ModelRuntime → 新建 ResourceLoader → `createAgentSession` → prompt → 修复（`builder/src/session.ts:639-714`）。
- 每页被要求读 `SKILL.md`、`page-contract.md`、`design-language.md`，按需读 `layouts.md`、`animation-recipes.md`、`validation.md` 和 4 个模板文件（`builder/pi-harness/skills/mockfinal-page-builder/SKILL.md:25,38-45`）。合计约 56KB，约 1–2 万 token，每页重复读入。
- Model 配置写死 `reasoning: false`、`cost` 全 0、`contextWindow: 128000`、`maxTokens: 16384`（`builder/src/session.ts:282-290`）；`PAGE_BUILDER_THINKING` 虽在配置里（`builder/src/config.ts:100`），但从未传给 `createAgentSession`，实际无效。
- `usageFromSession` 只取 input/output，丢弃 `cacheRead/cacheWrite` 与 `cost`（`builder/src/session.ts:612-623`），无法验证会话复用与缓存收益。
- 修复策略要求整页文件重写，而非局部 `edit`；输出 token 高（13.1k–26.5k/页），bundle 却只有约 15–17KB。
- 主 API 每页一个 `POST /v1/builds`，并发 2；Builder 队列同样并发 2（`builder/src/server.ts:77-113,318-385`）。没有 Deck 级会话概念。

### 1.3 教学信息：数据已有，呈现缺失

- 大纲结构已包含 `objectives / key_points / formulas / misconceptions / interaction_idea / page_count`（`backend/app/services/deck_planner.py:61-81`），Page Brief 也已完整传入（`:708-718`）。
- 但页面计划只按“知识点 × 密度”分配页数（`:503-588`），没有角色、先修、讲解链、例题、检查的概念；`kind` 仅在 `interactive/concept/summary` 三值间映射（`:492-500`）。
- 合并知识点时只把额外 KP 放进 `kp_indices`，Brief 仍只取 primary KP（`backend/app/services/deck_builder.py:1484-1495`），被合并的知识点内容会丢失。
- 前端 `DeckPageSummary` 虽有 `manifest_title/title/kind`，但没有角色、目标、检查、教学完整度；阅读器也没有展示 `objectives/key_points/formulas/misconceptions`。
- 阅读器的“已读”由停留 3 秒触发（`frontend/src/views/DeckReaderView.vue:208-227`）；`PageFrame` 丢弃 `progress` 事件（`frontend/src/components/deck/PageFrame.vue:137-143`）；runtime 只允许 `interaction/complete/error` 等少数事件。

### 1.4 前端体验：Deck 与主应用是两套语言

- `DESIGN.md` 尚无 Deck 阅读器/总览/构建台专章；Deck 使用了大量 `text-[10px]`（`DeckRoadmap.vue`、`DeckWorkbench.vue`、`BuildTimeline.vue`、`DeckAssistantDrawer.vue`、`DeckReaderView.vue`），低于 DESIGN.md 的 11px 下限。
- `DeckAssistantDrawer.vue` 使用不存在的 `border-danger/40 bg-danger-soft` token，失败气泡实际无样式。
- 阅读器 header 为 `h-14`，Deck 其他顶栏为 `py-3`；标题字号、容器宽度、图标按钮圆角/尺寸不统一；Deck 不套 `AppLayout`，没有主题切换、移动菜单与统一品牌区。
- 阅读器切换页面时整页 iframe 重建、bundle 置空，出现白底 loading 闪烁；没有方向感或淡入过渡；没有相邻页内容预取之外的阅读体验优化。
- 总览页 1440 宽度与全局 `max-w-5xl` 不一致；非 404 错误只 toast，正文空白；状态“已就绪/已阅读”混用；`PageFrame` 8s 超时短于 Validator 的 10s。
- 上传/生成/资料页与 Deck 页的按钮、卡片、空态、间距各自实现；缺少统一的 icon button、空态、错误态与页面容器规范。

### 1.5 Validator 与契约：只保证“不溢出”，不保证“教会”

- 静态检查禁止 `overflow:auto|scroll` 的正则会命中隐藏面板、媒体查询甚至注释（`validator/src/static-check.ts:131`）；浏览器零滚动只测 `documentElement` 与 `#mp-root`，在 `ready` 后两帧就测量（`validator/src/browser-check.ts:352-408`），入场动画中间态可能误报。
- 内部滚动检查只对“可见且实际溢出”的元素生效，`display:none` 会被排除；这给分层揭示留下了实现空间，但也意味着隐藏内容不会被完整校验。
- 交互冒烟只等待 `expect` 元素 `state:'attached'`（`validator/src/browser-check.ts:165`），隐藏标签页内容也可能算通过；冒烟只在第一个视口执行，分步展开后的高密度布局不会复测。
- a11y 仅检查 h1 与无名称交互，且为 warning（`:410-427`）；没有检查最小字号、内容裁剪、教学结构、目标与交互绑定。
- `shared/page-shell/shell.mjs` 只注入 reset 与 token（`:28-61`），没有组件基线；每个页面重复写 13–17KB CSS。
- 现有测试对 shell 的 `</style>`/`</script>` 数量、runtime 版本、schema 版本有硬断言；改契约必须同步测试与 Golden fixtures。

### 1.6 结论

- **页面层**：需要从“单点演示”升级为“分层教学单元”，但必须保持单层可见内容克制，否则桌面零滚动和可读性都会崩。
- **构建层**：需要 Deck 级会话复用、共享资料包、模板/设计系统、Prompt 压缩与 thinking 控制；否则教学化带来的内容增长会直接放大成本。
- **呈现层**：需要宿主教学工作台与显式学习完成，否则页面再密也只是“会动的 PPT”。

---

## 2. 调研：单页如何平衡效果与信息密度

### 2.1 先区分三种密度

| 密度 | 定义 | 当前问题 | 目标 |
| --- | --- | --- | --- |
| 视觉密度 | 同一时刻屏幕上可见的字数、块数、图形密度 | 低；页面像一张演示卡 | 保持中等：单层建议 450–500 字、可见块 3–6，留白不被挤掉 |
| 教学密度 | 一页承载的学习结构：目标、讲解链、例题、误区、检查、小结 | 很低；只有演示与少量侧注 | 约 3 倍（250→700 字）：角色化页面 + 分层揭示 + 宿主教学层 |
| 交互密度 | 有学习目的的操作与反馈状态 | 1 个演示交互，缺少预测/检查 | 1 个主交互（3–5 状态）+ 1 个检索检查；不为装饰加交互 |

核心原则：**同一时刻只保留一个认知焦点，但整页可以承载一个完整教学闭环。** 增密靠“层”和“结构”，不靠缩小字号或恢复桌面滚动；移动端允许纵向滚动，作为阅读模式的补充。

### 2.2 候选方案对比

| 方案 | 做法 | 信息密度 | 动态性 | 零滚动风险 | 成本 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| A. 单屏增密 | 直接增加文字/块，缩小字号与间距 | 高 | 低 | 高 | 低 | **不采用**；违反可读性与 DESIGN.md，容易变成“塞满的网页” |
| B. 分层揭示 | 步骤器、标签页、折叠答案、预测-观察-解释；一次只显示一层 | 高（总量） | 高 | 低 | 中 | **采用**；是页内增密的主手段 |
| C. 舞台 + 教学侧栏 | iframe 负责讲解/视觉/操作，宿主侧栏负责目标/要点/公式/易错/检查/来源 | 高（整页） | 中 | 低（侧栏 overlay，不改变 stage） | 中 | **采用**；补足元学习信息，降低 Pi 输出负担 |
| D. 微课拆页 | 一个知识点拆成概念→例题→练习 2–3 页 | 中（单页） | 中 | 低 | 高（页数与构建成本） | **选择性采用**；只给 core/难知识点，不默认全局拆页 |
| E. 宿主设计系统 | Shell 注入统一 CSS 组件基线，Bundle 只写语义结构 | 不直接增密 | 中 | 低 | 降低输出 token | **采用**；作为 B/C/D 的实现基础 |

**选定：B + C + 选择性 D，加上 E 作为工程底座；A 只保留“在不缩小字号前提下的排版压缩”。**

### 2.3 2.5 层教学页模型

```text
┌─────────────────────────────────────────────────────────────┐
│ 宿主阅读器                                                   │
│  ┌──────────────────────────────┐  ┌──────────────────────┐ │
│  │ 页面主舞台（iframe）          │  │ 学习面板（overlay）   │ │
│  │  标题 / 一句论点              │  │ 本页目标             │ │
│  │  主视觉或主交互               │  │ 讲解路线             │ │
│  │  3–5 个支撑块（分层显示）     │  │ 公式 / 易错          │ │
│  │  例题步骤 / 检查入口          │  │ 随堂检查             │ │
│  │  来源与操作                   │  │ 依据 / AI            │ │
│  └──────────────────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **页内**：一个主舞台 + 一个主交互 + 3–5 个支撑块；支撑块通过步骤器/标签页/折叠答案分层出现。
- **页外**：宿主学习面板承载“目标、讲解路线、公式、易错、检查、来源、AI”，不占用 iframe 内容视口，因此不破坏桌面零滚动校验；移动端允许页面纵向滚动。
- **页面之间**：页 Brief 带上一页“已学什么”和下一页“将学什么”，页面用一句话承接；Deck 计划保证章节内有教学顺序。
- **复杂知识点**：允许拆成 `mechanism → worked_example → practice` 三页；但每页仍然遵守单层预算，而不是把三页内容压成一页。

### 2.4 密度预算（新契约）

> 计数口径：正文汉字数，不含标题、标签、公式、图注、按钮文案、答案解释。Validator 做近似统计，预算主要用于 warning 与提示词约束；桌面零滚动仍是硬门禁，移动端允许纵向滚动但禁止横向溢出。

| 项 | 硬上限/目标 | 说明 |
| --- | --- | --- |
| 单层可见正文 | 建议 450–500 汉字（非硬上限） | 超过时用渐进式披露；零滚动/内容裁剪仍由 Validator 硬门禁兜底 |
| 单页总正文（所有层） | **≤ 700 汉字（硬上限）** | 概念/机制/对比 450–600；例题/练习 500–700；小结 350–500；超过 700 必须拆页 |
| 可见内容块 | 3–6 个 | 不含标题与页脚；超过 6 个必须分层 |
| 页内总块数 | 5–8 个 | 含隐藏层；超过 8 个提示拆页 |
| 主交互 | 1 个 | 3–5 个学习状态；可带重置/上一步 |
| 检查/揭示交互 | ≤1 个 | 随堂检查或答案揭示；可与主交互合并 |
| 可见公式 | ≤3 个 | 总公式 ≤6 个；长公式必须换行/缩放 |
| 宿主教学层 | 300–600 字 | 目标 1–3 条、要点 3–6 条、易错 1–3 条、检查 1–2 题 |
| 最小字号 | 12px | 正文建议 14–16px；标签 11–12px |
| 视觉层级 | ≤3 层 | 一页一个“重”元素（反转块/主视觉） |

**关键：** 700 字是**整页总预算**，不是要求一次铺满。单层建议控制在 450–500 字；超过时用步骤器、标签页、折叠答案等渐进式披露拆分。Validator 以整页 700 字为硬上限、单层 500 字为 warning，零滚动与内容裁剪继续兜底。

### 2.5 教学页契约

新增 `manifest.teaching`（新页面必填；旧页面可选）：

```json
{
  "version": "1.0",
  "role": "mechanism",
  "objectives": [
    "能说出二分查找的循环不变量",
    "能解释为什么每次排除一半"
  ],
  "prerequisites": ["数组有序", "区间概念"],
  "hook": "如果每次只能排除一个元素，10 亿个数要试多久？",
  "chain": [
    { "id": "c1", "title": "维护搜索区间", "block_id": "b1" },
    { "id": "c2", "title": "比较中点", "block_id": "b2" },
    { "id": "c3", "title": "排除一半", "block_id": "b3" }
  ],
  "worked_example": {
    "problem": "在 [1,3,5,7,9,11] 中查找 7",
    "steps": [
      { "id": "s1", "title": "确定区间", "body": "left=0, right=5" },
      { "id": "s2", "title": "取中点", "body": "mid=2，值为 5" },
      { "id": "s3", "title": "缩小右半区", "body": "left=3" }
    ],
    "answer": "第 4 个元素（下标 3）",
    "common_error": "把 mid 向下取整写成向上取整，导致死循环"
  },
  "check": [
    {
      "id": "q1",
      "objective_id": "o2",
      "question": "为什么 mid 要向下取整？",
      "options": ["保证区间收缩", "让结果更快", "避免数组越界", "没有原因"],
      "answer_index": 0,
      "explanation": "向下取整保证 left/right 至少移动一格，区间必然收缩。"
    }
  ],
  "summary": {
    "key_points": ["区间不变量", "每次排除一半", "O(log n)"],
    "misconceptions": ["mid 向上取整导致死循环"],
    "next": "下一节：二分查找的边界写法"
  }
}
```

按角色要求：

| 角色 | 页面目的 | 必含 | 可选 | 主交互 | 典型页数 |
| --- | --- | --- | --- | --- | --- |
| `concept` | 建立正确概念 | 目标、3–4 步讲解链、1 个误区、1 个检查 | 对比、公式 | 分步揭示/对比切换 | 1 |
| `mechanism` | 理解过程/机制 | 目标、3–5 步链、动态可视化、预测问题、1 个检查 | 例题 | 模拟/步进/参数调节 | 1 |
| `worked_example` | 会做一类题 | 题目、3–5 步解、答案、常见错误、1 个检查 | 变式 | 步骤控制 + 答案揭示 | 1 |
| `practice` | 检索练习 | 2–4 题、答案、解析、目标映射 | 提示 | 作答/揭示/重试 | 1 |
| `compare` | 辨析/选择 | 2–3 个对象、比较维度、结论、1 个误区 | 表 | 切换/对照 | 1 |
| `summary` | 记忆与串联 | 要点、公式、误区、下一页预告 | 检查 | 展开/速查 | 1 |

**角色不是标题装饰**：它决定页面计划、Brief 字段、模板选择、Validator 必填项与前端徽章。

### 2.6 教学交互分类

| 交互类型 | 学习目的 | 允许的形态 | 必需反馈 |
| --- | --- | --- | --- |
| `predict_observe` | 先预测再观察，制造认知冲突 | 选一个预测 → 播放/推进 → 显示结果 | 预测与结果对照、解释 |
| `step_through` | 降低推导/算法步骤的认知负荷 | 上一步/下一步/直达结论 | 当前步骤、已完成、总步数 |
| `simulate` | 观察参数或输入变化 | 滑块/预设案例/点击节点 | 状态变化 + 读出的结论 |
| `compare` | 辨析易混概念 | A/B 切换或并排 | 差异结论 + 易错提醒 |
| `retrieve` | 检索练习 | 选项/填空/判断/揭示答案 | 正确性 + 解析 + 目标映射 |
| `summarize` | 组织与记忆 | 展开/折叠速查卡 | 要点/公式/口诀 |

规则：

- 每页只有一个“主交互”；检查/揭示是辅助交互，不与主交互争夺视觉权重。
- 交互必须绑定 `objective_id`，至少绑定 1 个学习目标；没有目标映射的交互视为装饰。
- 冒烟必须验证“状态发生可观察变化”，不能只验证元素挂载。
- 不用自动轮播、无限循环、打字机、随机动画作为教学交互。
- reduced-motion 下状态仍立即生效，动画只是过渡。

### 2.7 反模式

- 用 `overflow:auto/scroll` 或更小字号把 900 字塞进一屏。
- 一页放 3 个同等重要的交互，用户不知道先点哪个。
- 把讲解链全部铺开，再用淡入动画“装饰”。
- 只有演示、没有问题；或只有题目、没有讲解。
- 检查题答案与解析缺失，或答案与题目不在同一目标上。
- 为了“看起来密度高”堆卡片、标签、图标，实际没有增加教学信息。
- 页面之间没有承接，每页都像独立 demo。

---

## 3. 产品设计

### 3.1 一页一个学习闭环

每页按角色组合以下环节，至少 4 个环节可见/可展开：

```text
先问（hook） → 讲清（chain） → 看见（visual/simulate）
→ 跟着做（worked example/step） → 自己试（check） → 记住（summary/misconception）
```

- `concept/mechanism`：先问 → 讲清 → 看见 → 自己试 → 记住。
- `worked_example`：题目 → 步骤 → 答案 → 易错 → 变式检查。
- `practice`：题目 → 作答 → 解析 → 目标回指。
- `compare`：对象 → 维度 → 差异 → 易错 → 判断。
- `summary`：要点 → 公式 → 误区 → 下一页预告。

宿主学习面板负责“先问/记住/自己试”的元信息与检查；页面主舞台负责“讲清/看见/跟着做”。这样既不牺牲页面专注度，也不让教学结构消失。

### 3.2 阅读器布局

桌面保持现有零滚动 stage 尺寸，不新增加高行；移动端进入可滚动阅读模式：

```text
┌──────────────────────────────────────────────────────────────┐
│ 返回   Deck 标题 / 页面标题      ‹ 3/12 ›   [本页] [AI] [⛶] │ 56px
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │ iframe stage（桌面零滚动；移动端可纵向滚动）          │   │
│   │                                                      │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│                              [学习面板 overlay 380–420px]     │
└──────────────────────────────────────────────────────────────┘
```

- **顶部栏统一**：复用 `DeckTopBar` 的视觉语言，56px 高；左侧返回 + 标题；中间页码/已学；右侧“本页”“AI”“主题”“全屏”“更多（重做/返回总览）”。
- **不新增常驻导读条**：那会压缩 stage 高度并破坏已验证的桌面零滚动视口。改为标题旁的“角色徽章 + 检查数”小标签，点击打开学习面板。
- **学习面板 overlay**：不改变 iframe 尺寸；桌面右侧滑入，移动端底部全屏 sheet；打开时保留页面可读背景，Esc 关闭，焦点管理完善。
- **页面切换**：相邻页预取 + 180ms 淡入/6px 方向位移；加载时显示与 stage 同尺寸骨架，不白屏；reduced-motion 直接切换。
- **移动端滚动**：`<768px` 时页面进入阅读模式，允许 iframe 文档纵向滚动，宿主顶栏固定；禁止横向溢出，不承诺单屏。学习面板改为全屏 sheet，避免与页面滚动竞争手势。
- **全屏**：保持现有 Fullscreen API；在全屏下学习面板仍可用。
- **来源**：从独立 Modal 移入学习面板的“依据”标签，减少浮层种类。

### 3.3 学习面板（Study Panel）

一个面板，四个标签：

| 标签 | 内容 | 数据来源 |
| --- | --- | --- |
| 本页 | 角色、预计分钟、学习目标、讲解路线、要点、公式、易错、小结、上一页/下一页 | `manifest.teaching` + 后端合并的知识点 |
| 检查 | 1–2 道随堂题；选项/揭示/解析；目标回指；立即反馈 | `manifest.teaching.check` |
| 依据 | 页面摘要、来源分节标题与引用、待核对标记 | `manifest.assistant` + `source_refs` |
| AI | 现有页面助手；快捷动作改为教学导向 | `DeckAssistantDrawer` 复用 |

交互细节：

- “讲解路线”节点可点击：宿主通过 `postMessage` 发送 `focus_block`，页面高亮对应块；不要求页面滚动。
- 检查题默认不显示答案；选择后显示正误与解析；“再做一次”重置；不做自动跳页。
- 本页目标用 1–3 条 checkbox 样式（仅展示，不强制勾选）；完成检查后提示“可以标记学完”。
- 公式使用 KaTeX 渲染，但 `html:false` + 文本清洗；不把 manifest 当 HTML。
- 旧页面没有 `teaching` 时，面板降级为“依据 + AI”，并提示“这是旧版页面，暂无教学目标”；不伪造目标。

### 3.4 进度与“学完”

- **移除 3 秒自动完成**。停留时长不等于学习完成。
- 页面 runtime 上报 `progress({step,total})`；宿主显示本页步骤进度。
- 当页面 `emit('complete')` 或用户完成随堂检查时，顶部出现“学完本页”主按钮；点击后才写入 `completed_page_ids`。
- 顶部进度区分“已构建（ready）”与“已学完（learned）”；总览工作台同样区分。
- 可选“需复习”标记（P12 拉伸项）：需要后端新增 `review_page_ids` 或 `progress` JSONB；MVP 先不做，避免扩大契约。

### 3.5 总览与工作台

- **路线图**：章节列 + 节点；节点显示角色（概念/机制/例题/练习/对比/小结）、核心标记、页数、检查数、构建状态与学习状态；已构建≠已学完，用不同图标/文案而不是颜色。
- **工作台**：
  - 主进度：“已学完 / 总页数”（不是“就绪进度”冒充学习进度）；
  - 继续学习：定位到第一个“ready 且未学完”的页面；
  - 统计：已构建、失败、已学完、随堂检查数；
  - 资料覆盖与教学完整度（来自 Validator 报告摘要）；
  - 重建/重新规划/查看最近构建。
- **页面卡片**：角色徽章、预计分钟、检查数、教学完整度、状态、缩略图（懒加载）。
- **构建工作台**：
  - 设置面板解释密度差异：精简=每页一个闭环；标准=核心知识点加例题；深入=更多例题/练习；
  - 预计页数与角色分布预览；
  - 时间线：整理资料 → 规划教学结构 → 规划页面 → 构建页面 → 校验教学完整性 → 完成；
  - 控制台按页面分组，不展示原始 prompt/终端；展示校验问题摘要与教学评分；
  - 页面卡片完成后即可阅读；失败卡片给“重试”“拆页/降密度”建议；
  - 构建统计：页数、耗时、ready/failed；成本仅内部记录，不向普通用户展示。

### 3.6 全局视觉统一

这一轮不只修 Deck，还要统一主应用与 Deck 的“同一套语言”。

**可复用组件**

- `AppIconButton.vue`：统一 32/36/40px、圆角、ghost/secondary、`aria-label`/`title`；替换阅读器、TopBar、卡片里的手写 icon button。
- `DeckTopBar.vue`：统一 Deck 总览/构建/阅读器顶栏高度、内边距、标题层级、返回与操作区。
- `EmptyState.vue`、`ErrorState.vue`：统一空态/错误态（图标底、标题、说明、下一步 CTA）。
- `LoadingSkeleton.vue`：与真实行同高的骨架，不用 spinner 占满页面。
- `PageContainer.vue`（或统一 class 规范）：明确 `max-w-5xl` 与 Deck 总览 `max-w-[1440px]` 的例外，避免每页各写一套。

**具体修复清单**

- 所有 `text-[10px]` → 最小 11px；正文/说明按 DESIGN.md 重新分级。
- 删除不存在的 `danger` token 用法，统一用 `border-border-strong`、`text-ink`、反转表达风险。
- 统一图标按钮圆角（`rounded-2xl` 或 `rounded-full` 二选一，按场景规则）与 hover/focus。
- Deck 阅读器接入主题切换、移动端菜单/返回；Deck 与 AppLayout 的顶栏高度/品牌区对齐。
- 统一页面切换过渡与 `aria-live` 页面标题播报；修复白屏 loading。
- 总览非 404 错误改为内联错误卡 + 重试，不只 toast。
- `PageFrame` 超时与 Validator 对齐（10s），并显示可重试错误卡。
- 缩略图懒加载 + 数量限制；bundle 缓存设上限（LRU），避免长会话内存膨胀。
- 移动端：阅读器标题/进度不消失；学习面板全屏 sheet；导航、全屏、重做可发现；**允许页面纵向滚动**，但禁止横向溢出，不承诺单屏。
- 可访问性：进度条 `role="progressbar"`；面板焦点陷阱/返回焦点；弹窗/抽屉 `aria-modal`；禁用节点仍可读状态；图标按钮 aria。
- 统一文案：`已就绪`（构建完成）/`已学完`（学习完成）/`需复习`（后续）；`重做本页` vs `重建整册`；`本页导读`。

**Home / Workspace / Auth**

- Home：引导卡与工作区列表保持现有结构，统一标题、间距、空态与按钮；补充“复习页”在产品流程中的一句话说明。
- Workspace：Deck 列表卡片与资料/工件列表统一边框、圆角、hover、状态徽章；Tab 计数与空态统一。
- Auth：只做间距、焦点与文案一致性修正，不扩展功能。
- `DESIGN.md` 新增 Deck 章节（阅读器、总览、构建台、学习面板、页面角色、密度规则、过渡），并记录 Deck 总览宽度的有意例外。

### 3.7 动效与视觉效果

遵守 DESIGN.md 的单色纸感，不引入彩色、渐变、玻璃拟态、循环装饰。新增动效只用于解释状态变化：

| 场景 | 效果 | 时长 |
| --- | --- | --- |
| 页面切换 | 淡入 + 6px 方向位移 | 180ms |
| 学习面板 | 右侧滑入 / 移动端底部 sheet | 220ms |
| 检查题反馈 | 边框加强 + 解析展开 | 150–200ms |
| 构建页面卡片出现 | 淡入 + 轻微上移 | 240ms |
| 骨架/构建中 | 呼吸/脉冲 | 1.3–1.4s，仅加载 |
| hover/focus | 边框/底色/反转 | 150ms |

- 页面内部由设计系统提供统一的步骤/揭示过渡；reduced-motion 下全部立即切换。
- 禁止页面切换时整屏白闪；禁止骨架屏伪装成内容；禁止自动播放的装饰动画。
- 视觉层级继续靠字号、字重、留白、1px 边框；一个视图一个主按钮。

### 3.8 文案与呈现

- 面向用户使用“复习页”“本页导读”“随堂检查”“学完本页”“需复习”等教学语言，不出现“session/lane/token/缓存”等内部术语。
- 构建设置解释“密度”对学习的影响，而不只是页数。
- 页面角色用中文短标签：概念、机制、例题、练习、对比、小结。
- 错误文案必须可行动：例如“本页校验未通过：内容超出单屏，请拆成两页或减少一个例子”，而不是“VALIDATION_FAILED”。

---

## 4. 技术方案

### 4.1 页面契约 v1.1

**版本策略**

- 新页面：`bundle.schema_version = "1.1"`，`runtime_version = "1.1.0"`。
- 旧页面：`1.0` / `1.0.0` 继续可读；Shell、Validator、前端同时支持两代。
- 新页面要求 `manifest.teaching`；旧页面缺失时走 `TEACHING_LEGACY` 降级。
- 新增 `manifest.design_system = "1.0"`，表示页面使用宿主设计系统基线。

**Runtime 1.1.0 增量**

- 保留现有 7 个 API：`ready/emit/next/prev/requestAssistant/getTheme/onHostMessage`。
- `emit` 增加 `progress`（`{step,total,label?}`），宿主据此显示本页进度；`complete` 语义不变。
- `onHostMessage` 增加 `focus_block`（`{block_id}`），用于学习面板“讲解路线”定位/高亮。
- 不新增网络、存储、父窗口、eval 能力；CSP 与 sandbox 完全不变。

**Manifest 新增字段**

```json
{
  "schema_version": "1.1",
  "design_system": "1.0",
  "teaching": {
    "version": "1.0",
    "role": "mechanism",
    "objectives": ["..."],
    "prerequisites": ["..."],
    "hook": "...",
    "chain": [{ "id": "c1", "title": "...", "block_id": "b1" }],
    "worked_example": { "problem": "...", "steps": [], "answer": "...", "common_error": "..." },
    "check": [{ "id": "q1", "objective_id": "o1", "question": "...", "options": [], "answer_index": 0, "explanation": "..." }],
    "summary": { "key_points": [], "misconceptions": [], "next": "..." }
  }
}
```

- 字符串长度、数组长度、`answer_index` 范围由 schema 校验。
- `chain[].block_id` 必须对应 HTML 中的 `data-mp-block`；不允许编造。
- `source_refs` 仍来自资料；教学目标、公式、易错可由后端用知识点权威数据补全/校正。

**兼容与安全**

- 不放宽 CSP、`sandbox="allow-scripts"`、无外链、无网络、无存储、无 `eval`、无父窗口、2MB bundle 上限。
- 教学文本、检查题、解析一律按不可信文本渲染；宿主不 `v-html`，公式走 KaTeX + DOMPurify。
- 旧 Bundle 不重新校验；新构建缺失教学结构直接失败（Builder 侧 `TEACHING_INCOMPLETE`，Validator 返回 error）。

### 4.2 宿主页面设计系统（DECK_KIT）

**为什么放 Shell，而不是每页 Bundle**

- 阅读器与 Validator 共用 `shared/page-shell/shell.mjs`，设计系统只有一份，避免“校验时通过、真实渲染漂移”。
- 统一字号、间距、网格、卡片、步骤器、检查、公式/图表容器，减少每页重复 CSS。
- 降低 Pi 输出：页面只写结构与局部布局，CSS 从 13–17KB 降到目标 ≤6KB。
- 安全边界不变：纯内联 CSS，无外部字体/图片/脚本。

**注入方式**

- `SHELL` 中新增版本化 `DECK_KIT_CSS`，并入现有 `<style>`（不新增 `<style>` 标签，避免破坏 shell 测试的标签计数）。
- 仅当 `manifest.design_system` 存在且版本受支持时注入；旧页面渲染完全不变。
- 移动端滚动规则属于 Shell 基础层（所有页面生效）：`@media (max-width: 767px)` 下把 `html/body/#mp-root` 与页面根改为可纵向滚动，覆盖页面固定的 `100dvh/overflow:hidden`；桌面零滚动规则不变。页面不得用内联样式阻断该移动规则。
- `shared-shell.ts` 导出 `DECK_KIT_VERSION`，Validator 检查；前端通过 `?raw` 复用同一份源码。

**Kit 内容（建议）**

- 布局：`.mp-page`、`.mp-head`、`.mp-body`、`.mp-foot`、`.mp-layout-focus/split/steps/cards/compare`。
- 排版：`.mp-title`、`.mp-sub`、`.mp-section-title`、`.mp-text`、`.mp-caption`、`.mp-label`、`.mp-formula`。
- 组件：`.mp-card`、`.mp-callout`、`.mp-quote`、`.mp-figure`、`.mp-legend`、`.mp-badge`、`.mp-stepper`、`.mp-step`、`.mp-tabs`、`.mp-panel`、`.mp-check`、`.mp-option`、`.mp-btn`。
- 状态：`[data-mp-state="idle|active|done|hidden"]`、`[data-mp-block]`、`[aria-current]`、`[hidden]`。
- 响应式：`max-width: 900px` 单列；可选侧栏折叠；桌面不引入页面滚动，移动端允许纵向滚动（由 Shell 移动规则接管）。
- reduced-motion：统一关闭过渡/动画，状态立即生效。
- 不包含外部资源、字体、图标库；图标仍用内联 SVG。

**页面模板**

- `templates/roles/concept|mechanism|worked-example|practice|compare|summary/`：每种角色一套语义 HTML + Kit class + 最小 JS + manifest 骨架。
- Builder 在 prompt 前把对应模板复制到 `pages/{page_id}/`；Prompt 要求“在模板上 `edit`，不要整页重写”。
- 模板含教学骨架（目标占位、链、例题/检查区域），但不含虚构内容；Pi 填真实资料。
- 旧的 `templates/page-base` 保留给 legacy/mock 测试。

### 4.3 大纲、页面计划与 Page Brief

**大纲（`deck_planner.py`）**

- `OutlineKnowledgePoint` 增加（均可选、限长）：
  - `prerequisites: list[str]`
  - `teaching_role_hint: Literal["concept","mechanism","worked_example","practice","compare","summary"]`
  - `hook: str`
  - `worked_example_idea: str`
  - `check_idea: str`
- 大纲 Prompt 要求：
  - 每个知识点标注“最适合的教学角色”，并给出一个具体检查点；
  - 章节内至少为 core 知识点规划一个例题/练习方向；
  - 仍然只依据资料，不编造引用。
- 保持 3–6 章、6–16 知识点、每 KP ≤3 页的硬约束。

**页面计划（`plan_pages`）**

- 由“按重要度轮转加页”升级为“按教学角色序列”：
  - core + 有交互建议 → `mechanism`；额外页 → `worked_example` 或 `practice`；
  - core 无交互建议 → `concept`；额外页 → `worked_example`；
  - normal → `concept` 或 `compare`；minor → `summary` 或合并；
  - 页数允许时，每章最后一页优先 `summary`；否则全册最后一页 `summary`。
- 返回字段新增 `role`（与 `kind` 对齐；`kind` 继续供前端兼容）。
- 合并知识点时，Brief 必须覆盖全部 `kp_indices`；不能只取 primary。`knowledge_point` 保留主 KP，新增 `merged_knowledge_points[]`。
- 页数区间保持 `concise 6–9 / standard 10–14 / deep 14–16`；不靠扩容页数解决密度，而靠角色与分层。

**Page Brief 新增**

```json
{
  "page_id": "page_12",
  "deck_title": "...",
  "chapter_title": "...",
  "role": "mechanism",
  "teaching_contract": {
    "objectives": ["..."],
    "prerequisites": ["..."],
    "required": ["hook", "chain", "worked_example", "check", "misconception"],
    "density": {
      "visible_layer_chars": 450,
      "total_page_chars": 700,
      "visible_blocks": 6,
      "total_blocks": 8,
      "primary_interactions": 1,
      "checks": 2
    }
  },
  "knowledge_point": { "...": "..." },
  "merged_knowledge_points": [],
  "source_excerpts": [],
  "source_meta": {},
  "style": {},
  "deck_context": {
    "previous_learning": "上一页已经讲清区间不变量",
    "next_hook": "下一页做一道边界题",
    "chapter_index": 2,
    "chapter_total": 4
  },
  "constraints": {}
}
```

- `source_excerpts` 在会话模式下可缩短为“引用摘要 + section_id”，完整资料放共享 `materials/`；非会话模式保持现有 12k 预算。
- `teaching_contract` 是硬约束，用户 `custom_prompt` 只能影响表达，不得覆盖教学结构或安全规则。

**后端补全**

- 构建成功后，后端用 KP 的权威 `objectives/misconceptions/formulas` 校正 `manifest.teaching` 中缺失或空白的字段；不覆盖页面实际讲解。
- 合并 KP 的教学目标去重后进入 `teaching.objectives`，保证被合并知识点不会消失。
- `DeckPageSummary` 增加：`teaching_role`、`estimated_minutes`、`check_count`、`teaching_score`（来自校验报告）；用于总览/工作台，不必加载 bundle。

### 4.4 Validator 演进

**静态检查新增**

- `manifest.teaching` 结构校验：角色枚举、目标 1–3、链 3–5、检查 1–3、答案/解析必填、`chain[].block_id` 在 HTML 中存在且唯一。
- `design_system` 版本校验；Kit 版本受支持。
- 页面 CSS/JS/HTML 大小预算 warning（如 CSS >6KB、JS >10KB、HTML >16KB），硬上限仍为 2MB。
- 修复 `overflow:auto|scroll` 正则误伤：改为对 CSS 规则块做定向解析，只禁止桌面“可见、可滚动且会溢出”的声明；隐藏面板/`display:none` 层与移动端（`max-width: 767px`）纵向滚动允许。
- 冒烟 `expect` 必须初始不存在或状态不同；禁止恒真选择器。

**浏览器检查新增**

- 教学结构：每个 `chain[].block_id` 对应元素存在；目标/检查/例题的 required 项存在（角色相关）。
- 内容裁剪：所有 `[data-mp-block]` 的 `scrollHeight/scrollWidth` 不得超过自身 `clientHeight/clientWidth`（即使 `overflow:hidden` 也算裁剪）。
- 最小字号：可见文本 computed font-size <12px → warning；<11px → error（安全下限）。
- 内容预算：按 `data-mp-text` 或主内容容器统计，整页正文 >700 汉字 → error `CONTENT_BUDGET_EXCEEDED`；单层可见 >500 汉字或可见块 >6 → warning（提示渐进式披露/拆页）；页内总块数 >8 → warning。
- 冒烟覆盖：对主交互执行 smoke 后，桌面重新测量零滚动与内容裁剪；移动端检查纵向可滚动与无横向溢出；分步展开后的最终状态也要检查。
- 等待策略：`ready` 后等待动画稳定（例如两个 rAF + 最长 400ms），避免中间态误报。
- a11y：检查检查题的标签、按钮名称、焦点可见、reduced-motion。
- 教学评分（0–100）：
  - 目标清晰度 20；
  - 讲解链完整性 20；
  - 例题/应用 20；
  - 误区 15；
  - 检查/检索 15；
  - 来源与页间承接 10。
  - 缺失结构项 → error；质量不足 → warning。
- 报告新增 `teaching: { score, criteria, metrics, warnings }`，不影响现有 `status` 语义；后端可据此设置门禁阈值。
- 移动端校验：新增 390×844 视口，允许 `scrollHeight > clientHeight`，但要求 `scrollWidth <= clientWidth + 1`；若页面根 `overflow:hidden` 导致内容被裁剪，返回 `MOBILE_SCROLL_BLOCKED`。

**阶段策略**

1. P9–P10：结构必填项为 error，质量评分为 warning；先把“教学生成出来”。
2. P11 黄金集校准后：`teaching.score < 70` 可作为 Builder 重试条件；连续失败则页面 `failed`，并在工作台显示原因。
3. 不把主观“讲得好不好”直接做成 error；用结构 + 启发式评分 + 人工抽检。

### 4.5 Builder：Deck 级会话复用

#### 目标

- 同一 Deck 的连续页面共享 Pi 会话，利用稳定前缀与上下文缓存，降低输入 token。
- 保持页级任务、页级事件、页级校验、页级失败隔离与主 API 状态机不变。
- 不在页面之间泄漏事实、布局或错误上下文；必要时轮换会话。

#### 方案对比

| 方案 | 缓存收益 | 上下文污染风险 | 并发/延迟 | 失败隔离 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 每页独立会话（现状） | 无 | 无 | 好 | 好 | 保留为回退模式 |
| 整个 Deck 一个会话 | 最高 | 高（14 页累积、错误/取消毁整册） | 串行，延迟高 | 差 | 不采用 |
| **Deck 分 lane 会话** | 高 | 低（lane 内有限、可轮换） | 2 lane 并行，lane 内串行 | 较好 | **采用** |
| 章节一会话 | 高 | 中 | 取决于章节大小 | 中 | 作为 lane 的分配依据 |

#### 布局

```text
主 API Deck job
  ├─ lane 0 → 第 1 章页面 → page_1 → page_4 → page_7 ...
  └─ lane 1 → 第 2 章页面 → page_2 → page_5 → page_8 ...
```

- 默认 `lane_count = min(PAGE_BUILDER_CONCURRENCY, 2)`；按章节分组并平衡页数，lane 内按 `ordinal` 顺序构建。
- 同一 lane 的页面共享一个 Pi 会话；不同 lane 并行。
- 单页重建使用独立的 repair 会话（或空闲 lane 会话），不打断正在构建的 lane。

#### 工作目录

```text
/tmp/mockfinal-sessions/{deck_id}/
├── deck/
│   ├── context.json          # 大纲、style、页面序列、教学约定
│   └── handoff-lane-0.md     # 会话轮换时的交接摘要
├── materials/
│   ├── index.md
│   └── {section_id}-{slug}.md
├── pages/
│   └── page_12/
│       ├── brief.json
│       ├── manifest.json
│       ├── page.html
│       ├── page.css
│       └── page.js
└── scaffold/                 # 角色模板副本（只读参考）
```

- Pi 会话 `cwd = deck 根目录`，所有页面通过 `pages/{page_id}/` 子目录隔离。
- `materials/` 在整个 Deck 内共享，只写一次；页面 brief 只引用 `section_id` 与短引用。
- `deck/context.json` 包含章节、style、页面序列、上一页/下一页摘要、教学约定；lane 首次启动时读取。

#### Guard 改造

当前 guard 把写权限锁死在“cwd 根下 4 个文件”（`builder/pi-harness/extensions/mockfinal-guard/index.ts:96-122`），需要改为：

- Guard binding 以 **deck 根** 为 key，绑定当前 `active_page_id`。
- `write/edit` 只允许 `pages/{active_page_id}/{manifest.json,page.html,page.css,page.js}`；禁止写其他页面、共享 materials、deck context。
- `read` 允许 deck 根、`materials/`、`harness/`、已完成的页面目录（用于风格参考）；禁止越过 deck 根。
- `check_page` 增加可选 `page_id`；必须等于 active page，调用页面目录的 bundle 收集。
- `agent_end` 记录当前页文件清单，不扫描整个 deck。
- 保留符号链接、路径穿越、大小、扩展名检查；不因会话复用放宽。

#### Builder 请求/状态

- `CreateBuildRequest` 增加可选：

```json
{
  "build_id": "bld_page_12_v1_xxx",
  "page_brief": { "page_id": "page_12", "...": "..." },
  "session": {
    "key": "deck_9_lane_0",
    "lane": 0,
    "page_index": 2,
    "page_total": 7,
    "first": false
  },
  "deck_context": { "...": "..." },
  "feedback": null
}
```

- 无 `session` 字段时走旧的每页模式（兼容测试/回退）。
- Builder `SessionPool`：
  - key → `{session, model, loader, settings, cwd, activePageId, pagesBuilt, contextUsage}`；
  - 同一 key 的页面任务串行（进程内 mutex/队列）；
  - `first=true` 时创建会话并写入 deck context/materials；
  - 每次页面任务前更新 guard 的 active page；
  - 页面完成/失败后记录摘要；超过轮换条件则关闭会话，写 handoff，创建新会话。
- 事件：`task` 仍是页面级；`agent_start/tool/check/page_done` 只映射到当前页；切换页面前清空文本缓冲，避免串页。
- 取消：取消页面 → abort 当前 prompt；会话标记为 dead，后续页面新建会话并从 handoff 恢复；Deck 取消 → 主 API 取消所有在途页面，Builder 清理会话与目录。
- 失败隔离：单页最终失败不销毁 lane；若失败原因是会话级异常（模型/工具/上下文），关闭会话，下一页重开；失败页本身由主 API 决定重试或标记 failed。
- 清理：主 API 在 job 结束尽力调用 `DELETE /v1/sessions/{key}`；Builder TTL（默认 30 分钟）兜底清理；不跨 Deck 复用。

#### 会话轮换

触发任一条件即轮换：

- 本会话已构建 `BUILDER_SESSION_PAGES_PER_LANE` 页（默认 3）；
- 进入新章节；
- `getContextUsage()` 超过上下文窗口的 `BUILDER_SESSION_CONTEXT_RATIO`（默认 0.6）；
- 页面失败/取消/模型异常后。

轮换时写入 `handoff-lane-{n}.md`：

- deck 目标与风格；
- 已完成页面标题、角色、关键概念、交互模式；
- 已发现的易错/布局问题；
- 下一页的承接点；
- 不包含原始页面代码与完整资料，避免上下文膨胀。

新会话首条 prompt 只带 handoff + 当前页任务；需要具体代码时由模型 `read` 已完成页面文件。

#### 缓存与上下文

- 稳定前缀顺序：system（Pi 基座 + 工具 + Skill 描述）→ SKILL/契约摘要 → deck context → 设计系统说明。所有动态内容（页面 brief、反馈）放在用户消息，不修改 system。
- 避免在 system 中放时间戳、build_id、随机数；它们会破坏前缀缓存。
- `before_agent_start` 的 guard 提醒要么只在首次会话注入，要么保持逐字稳定；不要每页生成不同文本。
- `DefaultResourceLoader`、`ModelRuntime`、Skill/Reference 只在会话创建时加载一次，不每页 `reload()`。
- 对支持显式 `cache_control` 的网关，按网关能力配置 `promptCache`/`compat.cacheControlFormat`；对 DeepSeek 等自动前缀缓存网关，靠“稳定前缀 + 会话连续 + 追加式消息”命中，不假设 100% 命中。
- `getSessionStats()` 是累计值；每页记录 before/after 差值，写入 `BuildUsage` 的 `cache_read_tokens/cache_write_tokens/cost`。
- 自动压缩作为安全网：`compaction.enabled=true`，`reserveTokens=24000`，`keepRecentTokens=20000`；优先靠轮换而非压缩，避免压缩重写前缀导致缓存失效。

#### 会话复用不改变的安全边界

- 一个会话只属于一个 Deck、一个 lane；不允许跨用户/跨 Deck。
- 页面目录、materials、handoff 均在 deck 根内；Guard 继续拒绝越界与符号链接。
- 页面代码不在 Builder 执行；仍只由 Validator 执行。
- Builder 仍不持有 DB/OSS/JWT 密钥。

### 4.6 Prompt、缓存、思考与成本

#### Prompt 结构

```text
[稳定前缀]
System：Pi 基座 + 工具约束
Skill：mockfinal-page-builder（只读一次）
Contract：页面契约 + 设计系统 + 教学页规范（合并后的单一版本）
Deck context：大纲、风格、页面序列、教学约定（每 lane 一次）

[每页任务卡]
page_id / role / brief 路径 / materials 路径 / scaffold 路径
本页教学重点（3–5 条）
上一页学完什么 / 下一页将学什么
验收清单（结构、密度、桌面零滚动/移动端可滚动、必调 check_page）
输出协议（只改必要文件，不写说明）

[反馈/修复]
只带结构化问题与相关片段，不重发整份资料
```

- 合并当前三份重复约束（`FALLBACK_PROMPT_HEADER`、`build-page.md`、guard reminder）为一份 `CONTRACT`；guard 只保留 5–8 行安全提醒。
- 首次 prompt 可要求模型读 SKILL 与契约；后续页面不再重复“读 Skill”，直接给任务卡。
- `build-page.md` 改成“页面任务模板”，不重复技能全文。
- 语言策略：
  - Profile `zh`：保留中文说明 + 中文内容；
  - Profile `compact`：技术规则/契约用紧凑英文，示例与面向用户的内容用中文；
  - 用黄金集 A/B，比较 token、首轮通过率、教学评分；默认按模型选择更优者。
- 输出协议：
  - 以脚手架为基础，优先 `edit`，禁止整页重写；
  - 不输出 Markdown 说明、代码解释、总结；
  - `page.css` 目标 ≤6KB，`page.js` 目标 ≤10KB，`page.html` 目标 ≤16KB；超出时提示精简而非硬截断；
  - 复用 Kit class，不自造基础按钮/卡片/排版。

#### 思考档位

- 修复 `reasoning: false`：由 `PAGE_BUILDER_REASONING`（默认 true，若网关模型不支持则 false）控制；只有支持 thinking 的模型才传 `thinkingLevel`。
- 接线 `PAGE_BUILDER_THINKING`，默认 `low`；按角色调整：
  - `mechanism` / 首次章节页：`low`（必要时 `medium`）；
  - `concept` / `compare`：`low`；
  - `practice` / `summary`：`off` 或 `minimal`；
  - 修复轮：`low`；复杂布局修复可 `medium`。
- 通过模板、Kit、Validator 降低对“自由发挥”的依赖，再用 A/B 证明低思考不降低首轮通过率与教学评分。
- `PAGE_BUILDER_THINKING` 必须真正传给 `createAgentSession` / `setThinkingLevel`，并记录每页实际档位。

#### 成本核算

- 扩展 `BuildUsage`：`input_tokens/output_tokens/cache_read_tokens/cache_write_tokens/cost/duration_ms/model_calls/thinking_level`。
- `resolveModel` 的价格从环境变量读取（input/output/cache read/cache write，按 1M tokens），让 `SessionStats.cost` 有意义；未配置时只记 token。
- 主 API 的 `deck_build_jobs` 增加 `usage` JSONB（P8，lifespan 幂等 DDL）；页面级 usage 可放 `deck_pages.validation` 或新增 `build_usage` JSONB（二选一，优先 job 级 + 日志，减少表变更）。
- 日志字段：`deck_id/job_id/page_id/session_key/lane/page_index/input/output/cache_read/cache_write/cost/teaching_score/rotation_reason`。
- 不在日志中记录 prompt 全文、资料正文、用户选中文本、密钥。

#### 成本目标与验证

| 指标 | 当前 | 目标 |
| --- | --- | --- |
| 14 页 Deck 模型成本 | ¥1.69 | ≤¥1.0–1.2 |
| 每页输入 token | 20.7k–22.4k | 首屏后 ≤8k；缓存命中可观测 |
| 每页输出 token | 13.1k–26.5k | ≤10k（教学内容增加但代码/说明减少） |
| 单页 p90 | 157s（P2） | ≤6 分钟 |
| Deck 总时长 | 15m11s（14 页） | ≤20 分钟（2 lane） |

如果会话复用导致质量下降或延迟不可接受，回退到逐页模式，但保留 Prompt/模板/设计系统带来的成本优化。

### 4.7 主 API 编排

- `run_deck_build_job` 的页面执行从“Semaphore(2) + 每页独立调用”改为“lane worker”：
  - `assign_lanes(pages, lane_count, outline)`：按章节分组、平衡页数，保持 lane 内顺序；
  - 每个 lane 顺序执行页面：组装 brief → 调 Builder（带 session 元数据）→ 轮询 → 主 API 最终校验 → 写 bundle/进度；
  - 两个 lane 并发，页级事件、进度、取消、重试语义不变。
- 首次 lane 请求带 `deck_context` 与共享 materials；后续页面只带 brief/session 元数据。
- 单页重建：`session.key = deck_{id}_repair_{uuid}` 或空闲 lane；不重规划，不改变其他页面。
- `rebuild_all`：复用页面计划，lane 会话全部重建；旧版本保持 current 直到新页 ready。
- 取消/超时：主 API 设置 `cancel_requested`，lane worker 取消当前 Builder 请求并停止取下一页；已 ready 页面保留。
- 失败：页级失败不终止 lane；失败页按 `DECK_PAGE_MAX_ATTEMPTS` 重试；连续会话级失败则重建 lane。
- 兼容：`BUILDER_SESSION_MODE=page` 时保留现有逐页路径；FakeBuilder 测试可只断言 page_id/brief，不受 session 字段影响。

### 4.8 前端架构

**类型/契约**

- `types/index.ts` 新增 `TeachingRole`、`TeachingManifest`、`TeachingCheck`、`PageTeachingSummary`；`DeckPageSummary` 增加可选 `teaching_role/estimated_minutes/check_count/teaching_score`。
- `PageBundle` 支持 `schema_version: '1.0' | '1.1'`、`manifest.design_system?`、`manifest.teaching?`。
- `api/decks.ts` 无新端点；进度 API 复用 `PATCH /progress`。

**组件**

- `DeckStudyPanel.vue`：右侧 overlay，tabs 本页/检查/依据/AI；桌面 380–420px，移动全屏 sheet。
- `TeachingRail.vue`：目标、路线、要点、公式、易错、小结、上下页。
- `LessonCheck.vue`：选项、判定、解析、重试；本地状态，不持久化。
- `DeckReaderToolbar.vue` 或统一 `DeckTopBar`：角色徽章、页码、已学、本页/AI/主题/全屏/更多。
- `AppIconButton.vue`、`EmptyState.vue`、`ErrorState.vue`、`LoadingSkeleton.vue`：全局复用。
- `PageFrame.vue`：处理 `progress` 事件；暴露 `post('focus_block', ...)`；超时 10s；错误卡可重试。

**状态与轮询**

- 阅读器：`bundleCache` 设 LRU 上限（如 6 页）；相邻页预取；缩略图懒加载。
- 移动端：iframe 内部纵向滚动，宿主顶栏固定；学习面板全屏 sheet；`PageFrame` 不设置 `scrolling="no"`，禁止横向溢出。
- 学习面板开关/宽度存 Pinia/`localStorage` 仅作展示偏好；学习状态以后端 `completed_page_ids` 为准。
- 页面切换后设置 `aria-live` 标题、焦点到 stage/标题；键盘左右/空格保留；面板内输入不触发翻页。
- 构建轮询保持 1s/隐藏 5s；事件按页分组；失败页可重试/查看原因。

**测试**

- Vitest：teaching 映射、检查判定、进度显式完成、角色标签、LRU、版本兼容。
- P5/P6 Playwright：更新 header/选择器；新增学习面板打开/关闭、检查题、focus_block、移动 sheet、深色、reduced-motion；保持桌面零滚动断言，并新增移动端纵向滚动/无横向溢出断言。
- 旧页面（无 teaching）降级测试。

### 4.9 兼容、迁移与发布

- **数据**：不删除旧表/旧页面；新增列仅用 lifespan `ADD COLUMN IF NOT EXISTS`（如 job usage）。旧 `manifest` 无 teaching 时前端降级。
- **版本**：新 Bundle 1.1 / Runtime 1.1.0；Shell、Validator、前端同时支持 1.0 与 1.1；新构建由 Builder 写 1.1。
- **部署顺序**：
  1. 前端/Validator/Shell 先支持双版本（旧页面不受影响）；
  2. 后端规划/契约/教学字段上线（teaching flag 默认关）；
  3. Builder 模板/Kit/Prompt 上线（session mode 默认 page）；
  4. 黄金集通过后开启 `BUILDER_SESSION_MODE=deck` 与 `DECK_TEACHING_ENABLED=true`；
  5. 观察一版 Deck，再设为默认。
- **回退**：
  - 关闭 teaching flag → 新构建回到旧契约（不建议长期）；
  - `BUILDER_SESSION_MODE=page` → 回退到逐页会话；
  - 前端回退仍能读 1.1 页面（双版本支持）；
  - 已生成页面不回滚、不删除；失败页保留旧 current。
- **HMAC/内部 API**：新增字段不改变签名算法；主 API 与 Builder 同版本部署，旧 Builder 忽略未知字段，新 Builder 兼容旧请求。

### 4.10 配置新增（草案）

| 配置 | 默认 | 所属 | 说明 |
| --- | --- | --- | --- |
| `DECK_TEACHING_ENABLED` | `false` → 门禁后 `true` | backend | 启用教学契约/规划/校验 |
| `DECK_TEACHING_MIN_SCORE` | `70` | backend | 教学评分门禁阈值（校准后启用） |
| `DECK_VISIBLE_LAYER_CHARS` | `450` | backend/builder | 单层可见正文建议值（非硬门禁，超出提示渐进披露） |
| `DECK_TOTAL_PAGE_CHARS` | `700` | backend/builder | 单页总正文硬上限（超出必须拆页） |
| `DECK_MAX_PAGE_BLOCKS` | `8` | backend/builder | 页内总块数上限 |
| `BUILDER_SESSION_MODE` | `page` → `deck` | builder | 逐页/Deck lane |
| `BUILDER_SESSION_PAGES_PER_LANE` | `3` | builder | 轮换页数 |
| `BUILDER_SESSION_CONTEXT_RATIO` | `0.6` | builder | 上下文轮换阈值 |
| `BUILDER_SESSION_TTL_SECONDS` | `1800` | builder | 会话/目录清理 TTL |
| `BUILDER_LANE_COUNT` | `2` | builder | lane 上限（与主 API 并发一致） |
| `PAGE_BUILDER_THINKING` | `low` | builder | off/minimal/low/medium/high |
| `PAGE_BUILDER_REASONING` | `true`（按模型） | builder | 是否声明 reasoning 能力 |
| `PAGE_BUILDER_PROMPT_PROFILE` | `compact`（待 A/B） | builder | `zh` / `compact` |
| `PAGE_BUILDER_CACHE_SHORT/LONG` | 空 | builder | 显式缓存网关可选 |
| `PAGE_BUILDER_COST_INPUT/OUTPUT/CACHE_READ/CACHE_WRITE` | 空 | builder | 每 1M token 价格，用于成本统计 |
| `PAGE_BUILDER_TIMEOUT_SECONDS` | `480` | builder | 单页超时（保持） |
| `DECK_PAGE_MAX_ATTEMPTS` | `2` | backend | 页级总尝试（保持） |
| `DECK_JOB_TIMEOUT_SECONDS` | `1800` | backend | 整 job 超时（保持/按 lane 调整） |

> 所有新变量必须同步 `backend/.env.example`、`builder/README.md`、`README.md` 环境变量表与 AGENT.md。

---

## 5. 实施路线（P8–P13）

> 旧 P0–P7 已完成；以下是本轮新增阶段。估算为单人、不含评审等待。P10 与 P12 可在 P9 后并行。

### P8 · 基线与度量（2–3 天）

**目标**：先把“现在到底是什么样”量化，避免凭感觉优化。

- [ ] 用现有 14 页 Deck 记录基线：每页正文/块数/交互数（从 bundle 解析）、构建耗时、输入/输出 token、成本、Validator 报告。
- [ ] 补齐 `BuildUsage` 的 cache/cost 字段与日志（不改变构建行为）；`deck_build_jobs` 增加 `usage` JSONB（lifespan DDL）。
- [ ] 增加一个只读的基线统计脚本（`builder/scripts/` 或 `backend/tests/fixtures/`），输出 `docs/pageref/P8_BASELINE.md` 与 JSON。
- [ ] 截图审计：阅读器、总览、构建台在 1280/1440/1920、深浅色、移动端；标出现有视觉问题。
- [ ] 冻结 P5/P6 验收基线，记录将被新设计改变的断言。

**验收**：基线报告可复现；成本/token 有逐页数据；后续改动可对比。

### P9 · 教学契约与规划（4–5 天）

**目标**：让“教学结构”成为数据与契约的一部分。

- [ ] 后端 `OutlineKnowledgePoint` / `plan_pages` / `build_page_brief` 增加角色、先修、hook、教学契约、密度预算、合并 KP。
- [ ] `manifest.teaching` schema、bundle 1.1、runtime 1.1.0 的文档与类型（先不要求真实 Pi 生成）。
- [ ] Validator 静态检查：teaching 必填、block 引用、检查题结构；Builder `checkManifest` 同步。
- [ ] 前端类型与 `DeckPageSummary` 教学摘要（角色/分钟/检查数/评分占位）。
- [ ] 单元测试：角色分配、Brief 字段、合并 KP、teaching schema、旧 bundle 兼容。
- [ ] 用 mock/fake builder 跑通“创建 Deck → 角色计划 → 教学 Brief → 页面 ready（mock）”。

**验收**：规划输出包含角色序列；Brief 含教学目标与密度预算；Validator 能拒绝缺失教学结构的页面；旧页面不被误伤。

### P10 · 页面设计系统与教学模板（5–7 天）

**目标**：让页面“有密度、有教学骨架、又少写代码”。

- [ ] Shell 注入 `DECK_KIT_CSS`（版本化、条件注入、双版本兼容），更新 shell 测试与 Validator shared-shell。
- [ ] 六套角色模板（concept/mechanism/worked-example/practice/compare/summary），每套含语义 HTML、Kit class、步骤器/检查骨架、manifest 骨架。
- [ ] 重写 Skill/References：合并硬约束、更新密度预算、加入教学角色与检查题写法、加入正反例；保留按需读取的 recipes。
- [ ] Prompt 改为“模板起步 + 只改必要文件 + 每页任务卡”，减少重复 skill 全文。
- [ ] Validator 浏览器检查：内容裁剪、最小字号、教学结构、评分、动画稳定等待、smoke 后复测。
- [ ] Golden fixtures 升级：每个角色至少 1 个手写/半手写 bundle，覆盖 1.1 契约与教学评分；保留 1.0 legacy 样例。
- [ ] 真实 Pi 小样验证：先跑 3 页（mechanism/worked_example/practice），检查教学结构与 token；预算 ≤¥1。

**验收**：6 个角色页桌面零滚动、移动端可纵向滚动且无横向溢出、结构完整；Pi 能在模板上完成教学页；每页 CSS 明显下降；教学评分可解释。

### P11 · Builder 会话复用与成本（6–8 天）

**目标**：把“每页一个会话”改为“Deck lane 会话”，并证明成本/质量。

- [ ] Builder `SessionPool`、lane 串行、deck 根 cwd、页面子目录、guard active page、页面级 bundle 收集。
- [ ] 主 API lane 分配、session 元数据、共享 materials/deck context、cancel/timeout/retry 适配。
- [ ] 会话轮换与 handoff；失败/取消后的会话恢复；TTL 清理；`DELETE /v1/sessions/{key}`。
- [ ] Prompt 压缩：合并约束、任务卡、模板起步、compact profile；稳定前缀与缓存配置。
- [ ] 接线 `PAGE_BUILDER_THINKING`/`reasoning`；角色化档位；记录实际档位与 token/cache/cost。
- [ ] A/B：逐页 vs lane；zh vs compact；off/minimal/low；黄金集 8–10 页；记录成本、延迟、首轮通过率、教学评分。
- [ ] 失败注入：lane 中单页失败、会话异常、取消、超时、Builder 重启；确认不污染后续页。

**验收（门禁）**：教学结构完整率 100%；首轮通过率 ≥75%（修复后 ≥95%）；桌面零滚动/安全 100%；移动端无横向溢出且可纵向滚动；14 页成本 ≤¥1.2；Deck 时长 ≤20 分钟；无跨页内容/事实污染。

### P12 · 阅读器与全局体验（6–8 天）

**目标**：把教学结构以舒服、统一的方式呈现给用户。

- [ ] 学习面板（本页/检查/依据/AI）、角色徽章、目标/路线/公式/易错/小结；focus_block 桥接。
- [ ] 显式“学完本页”、步骤进度、去掉 3 秒自动完成；总览/工作台区分 ready/learned。
- [ ] 统一 `DeckTopBar`、`AppIconButton`、`EmptyState`、`ErrorState`、`LoadingSkeleton`；修复 10px、danger token、z-index、容器宽度。
- [ ] 页面切换过渡/骨架/预取/LRU/缩略图懒加载；10s 超时与错误卡。
- [ ] 总览路线图角色/检查/学习状态；工作台教学进度；构建台角色分布、教学评分、失败建议。
- [ ] 全局 Home/Workspace/Auth 视觉一致性；深色、移动端（允许纵向滚动、无横向溢出）、reduced-motion、焦点/aria。
- [ ] 更新 `DESIGN.md` Deck 章节与文件落地地图。
- [ ] P5/P6 验收脚本更新并执行；新增学习面板/检查/移动端截图。

**验收**：浏览器验收全绿；0 控制台错误；375–1920、深浅色、reduced-motion 可用；移动端纵向滚动与无横向溢出验证通过；学习闭环可完成；视觉与主应用统一。

### P13 · 回归、成本与发布（3–4 天）

**目标**：证明没有破坏旧能力，并把发布/回滚写清楚。

- [ ] 后端 pytest / 前端 Vitest+typecheck+build / Validator / Builder 全量回归。
- [ ] 红队回归：外链、eval、父窗口、超大 bundle、路径穿越、prompt injection、XSS 检查题/教学文本。
- [ ] 真实 14 页 E2E：记录 ready/failed、教学评分、首轮通过、成本、cache hit、时长；输出 `P13_RESULTS.json`。
- [ ] 旧页面兼容：1.0 bundle 阅读器/Shell 正常；旧 Deck 不因新前端报错。
- [ ] 成本报告：DeepSeek 余额前后、逐页 usage、总成本；确认 ≤ 预算。
- [ ] 更新 README/AGENT/RULE/DESIGN/PAGE_CONTRACT/INTERNAL_API/新增 `TEACHING_PAGE_SPEC.md`、`SESSION_REUSE.md`、`P8–P13` 报告。
- [ ] 发布/回滚手册；等待维护者审阅；**不擅自 push/merge**。

**验收**：DoD 全部满足；维护者签收；可一键回退 session/teaching flag。

---

## 6. 调研实验与门禁

### 6.1 黄金集（10 个 brief）

| # | 角色 | 主题 | 关键交互 | 教学检查 |
| --- | --- | --- | --- | --- |
| 1 | mechanism | 二分查找 | 区间收缩/预测 | 循环不变量 |
| 2 | worked_example | 矩阵变换 | 分步推导 | 列向量含义 |
| 3 | concept | 时间复杂度 | 曲线/分类 | O 与 Θ 区别 |
| 4 | compare | 进程 vs 线程 | 切换对照 | 共享资源 |
| 5 | worked_example | 概率条件 | 步骤计算 | 条件概率陷阱 |
| 6 | mechanism |  TCP 握手 | 状态推进 | 为什么三次 |
| 7 | practice | 错题辨析 | 选项/解析 | 检索练习 |
| 8 | summary | 章节速查 | 展开卡片 | 公式/误区 |
| 9 | concept | 指针与引用 | 图示 | 语义差异 |
| 10 | compare | 排序稳定性 | 对照 | 稳定性的代价 |

每个 brief 含 2–4 个来源分节、3–5 条目标/要点、1–3 条误区、1–2 个检查点。

### 6.2 A/B 矩阵

| 组 | 会话 | Prompt | Thinking | 目的 |
| --- | --- | --- | --- | --- |
| A | 逐页 | zh（现状精简） | off | 当前基线 |
| B | Deck lane | zh | off | 纯会话复用收益 |
| C | Deck lane | compact | low | 目标方案 |
| D | Deck lane | compact | minimal | 成本下限/质量边界 |

可选 E：Deck lane + Kit/模板关闭，用于隔离设计系统收益（仅工程实验，不交付）。

### 6.3 指标

- 首轮 Validator 通过率、修复 1 轮后通过率；
- 教学结构完整率、教学评分分布；
- 桌面零滚动（3 桌面 + 阅读器内容视口）、移动端纵向可滚/无横向溢出、内容裁剪、最小字号；
- 冒烟通过率、检查题结构正确率；
- 每页 input/output/cache read/cache write/cost、每 Deck 总成本；
- 每页 p50/p90 时长、Deck 总时长；
- 跨页事实/布局污染人工抽检；
- 安全红队 0 通过。

### 6.4 决策规则

- **必须**：教学结构 100%、桌面零滚动 100%、移动端无横向溢出且可纵向滚动、安全 0 违规、旧页面可读。
- **质量**：首轮 ≥75%，修复后 ≥95%；教学评分中位数 ≥75。
- **成本**：14 页 ≤¥1.2；若 C 组不达标，尝试 D；仍不达标则回退 B，保留 Prompt/模板收益。
- **延迟**：单页 p90 ≤6 分钟；Deck ≤20 分钟；否则调整 lane 数/页数/轮换策略。
- **模型**：DeepSeek Flash 为基线；如有可用 Qwen Coder 等模型，做一次对照，不无限扩模型矩阵。

### 6.5 预算

- P10 小样：≤¥1；
- P11 A/B：≤¥3；
- P13 全量：≤¥2；
- 合计 **≤¥6**；每次真实调用前记录余额，结束后报告实际消耗；超出前暂停。

---

## 7. 验收矩阵

| 场景 | 验收 |
| --- | --- |
| 新建 Deck（standard） | 角色序列合理；核心 KP 有机制/例题；章节有小结；页数 10–14 |
| 构建 14 页 | 全部 ready 或明确 failed；教学结构完整；进度真实 |
| 单页内容 | 页内总正文 450–700 字；单层建议 ≤450–500 字，超出用渐进式披露；1 主交互 + 1 检查；无裁剪 |
| 页面角色 | concept/mechanism/worked_example/practice/compare/summary 均能生成并通过 |
| 教学检查 | 每题有答案/解析/目标映射；宿主可作答/揭示/重试 |
| 桌面零滚动 | 1280×720、1440×900、1920×1080、阅读器内容视口全部通过 |
| 移动端 | 375/390 宽度允许纵向滚动，无横向溢出；学习面板为全屏 sheet |
| 构建中刷新/断线 | 后台继续；重进恢复 job/page；0 订阅者仍完成 |
| 取消 | 未完成页取消；已 ready 保留；会话/目录清理 |
| 单页重建 | 不重规划；旧版本保持 current；新版本通过后切换 |
| 整册重建 | lane 重建；失败页保留旧 ready；最终 ready/partial 正确 |
| 会话复用 | 同 lane 页面共享会话；稳定前缀；无跨页事实/布局污染；轮换可解释 |
| 成本 | 14 页 ≤¥1.2；cache 指标可观测 |
| 旧页面 | 1.0 bundle 在阅读器/Shell 正常；无 teaching 时面板降级 |
| 前端 | 375/768/1024/1280/1440/1920；深浅色；reduced-motion；0 控制台错误 |
| 可访问性 | 键盘翻页/面板/检查；焦点可见；aria-live；按钮有名称 |
| 教学面板 | 目标/路线/公式/易错/检查/依据/AI 可用；移动端 sheet；关闭回焦 |
| 安全 | 外链/eval/父窗口/存储/网络/路径穿越/prompt injection 全部拦截；检查题 XSS 清洗 |
| 文案 | 全中文、可行动；不出现内部术语；ready/learned 不混淆 |

---

## 8. 成本预算与观测

### 8.1 当前基线

- P2：3 页，输入 65,153 / 输出 56,390 tokens，成本 ¥0.14，p90 157.2s。
- P4：14 页，15m11s，¥1.69（含规划）。
- 当前每页输入约 20.7k–22.4k，输出 13.1k–26.5k；成本几乎全在重复上下文与输出。

### 8.2 目标

- 输入：会话复用 + 只读一次 Skill + 共享 materials + 稳定前缀，目标首屏后 ≤8k/页。
- 输出：模板/Kit 起步 + 只改必要文件 + 禁止说明文，目标 ≤10k/页。
- 14 页总成本：≤¥1.0–1.2（-30%～-40%）。
- 不把成本目标建立在“缓存一定命中”的假设上；以 `cacheRead` 实测为准。

### 8.3 观测

- 每页：`input/output/cache_read/cache_write/cost/duration/thinking_level/rotation_reason`。
- 每 Deck：页数、lane 数、轮换次数、总成本、p50/p90、首轮通过率、教学评分。
- 报告：`docs/pageref/P8_BASELINE.md`、`P11_COST.md`、`P13_RESULTS.json`。
- 不记录 prompt/资料正文/密钥；成本数据只做内部统计与工作台摘要（普通用户不展示具体金额）。

---

## 9. 风险与回滚

| # | 风险 | 概率 | 影响 | 缓解 | 触发/回退 |
| --- | --- | --- | --- | --- | --- |
| R1 | 分层隐藏内容导致“看不见的教学” | 中 | 中 | 每层有明确入口与进度；宿主面板承载元信息；Validator 检查入口存在 | 用户反馈“找不到内容”→ 提高默认展开层/优化标签 |
| R2 | 教学内容增加导致输出 token 上升 | 高 | 中 | 模板/Kit/只改文件/输出预算；单层字数限制 | 成本超目标 → 降页数/降密度/压缩 Prompt |
| R3 | 会话复用造成跨页污染 | 中 | 高 | lane 轮换、handoff、active page guard、页面目录隔离 | 抽检发现污染 → 缩短轮换页数/回退逐页 |
| R4 | 缓存不命中（网关差异） | 中 | 中 | 稳定前缀、会话连续、实测 cacheRead；不承诺固定折扣 | 命中率低 → 调 Prompt 顺序/换模型/回退 |
| R5 | 教学校验误伤/阻塞 | 中 | 高 | 结构 error、质量 warning；先 mock/小样校准；可关 flag | 失败率高 → 放宽 warning/修规则 |
| R6 | Validator 规则误伤分层布局 | 中 | 中 | 隐藏层用 `display:none`；动画稳定等待；smoke 后复测 | 误报 → 修规则并加 fixture |
| R7 | 设计系统限制创作 | 中 | 中 | Kit 只提供基础组件，页面 CSS 可覆盖；模板可扩展 | 需要新组件 → 版本化加入 Kit |
| R8 | 学习面板遮挡/打断阅读 | 中 | 低 | overlay 不改变 stage；默认关闭；移动 sheet；可固定偏好 | 反馈遮挡 → 默认半透明/可拖拽/关闭记忆 |
| R9 | 前端改动破坏 P5/P6 | 中 | 中 | 双版本、验收脚本更新、逐项回归 | 回归失败 → 回退前端变更 |
| R10 | 旧页面/旧 Bundle 不兼容 | 低 | 高 | Shell/Validator/前端双版本；旧页面不重校验 | 兼容问题 → 关闭新版本渲染/回退 |
| R11 | 部署版本错配 | 中 | 高 | HMAC 不变、字段向后兼容、同版本部署、feature flag | 错配 → 回退 Builder/API 同版本 |
| R12 | 预算超支 | 中 | 中 | ≤¥6 硬上限；每阶段记录余额；超限暂停 | 超限 → 停止真实调用，改 mock/局部验证 |

**回滚顺序**：`BUILDER_SESSION_MODE=page` → `DECK_TEACHING_ENABLED=false` → 前端/Validator 回退到双版本兼容版本 → 不删除任何已生成页面/数据。

---

## 10. 文档义务

| 改动 | 必须更新 |
| --- | --- |
| 页面契约/教学字段/Runtime | `docs/pageref/PAGE_CONTRACT.md`、`docs/pageref/INTERNAL_API.md`、`AGENT.md` §5.5/§5.6 |
| Builder 会话/Guard/内部 API | `builder/README.md`、`docs/pageref/SESSION_REUSE.md`、`AGENT.md` §4 |
| 教学页规范/密度/角色 | 新增 `docs/pageref/TEACHING_PAGE_SPEC.md`；`DESIGN.md` Deck 章节 |
| 前端视觉/组件/动效 | `DESIGN.md`（阅读器、学习面板、TopBar、IconButton、过渡、移动端） |
| 新增配置 | `backend/.env.example`、`builder/README.md`、`README.md` 环境变量表 |
| 新依赖/版本 | `requirements.txt` / `package.json` + 说明（尽量不新增） |
| 测试/验收 | `AGENT.md` §3.3、`RULE.md` §7、P5/P6 脚本说明 |
| 成本/缓存/Prompt 策略 | `P8_BASELINE.md`、`P11_COST.md`、`P13_RESULTS.json`、`P13_REPORT.md` |

---

## 11. 决策记录与已确认事项

### 已定（本方案建议）

1. 单页采用“页内分层 + 宿主教学面板 + 角色化”的混合方案，不采用单屏硬塞。
2. 新页面必须带 `manifest.teaching`；旧页面降级可读。
3. 宿主 Shell 注入版本化设计系统；Bundle 只写语义结构与局部 CSS。
4. Pi 采用 Deck lane 会话（默认 2 lane），lane 内串行、按章节分配；保留逐页回退。
5. Prompt 采用稳定前缀 + 每页短任务卡 + 模板起步 + 只改必要文件。
6. 思考档位默认 `low`，练习/小结可 `off/minimal`，复杂机制可 `medium`。
7. 前端用统一学习面板替代“依据 Modal + AI 抽屉”的割裂浮层；显式“学完本页”。
8. 真实模型验证预算 ≤¥6。
9. 移动端允许纵向滚动；桌面 1280/1440/1920 与阅读器内容视口继续零滚动，移动端禁止横向溢出。

### 维护者已确认（2026-11-08）

| # | 问题 | 结论 |
| --- | --- | --- |
| Q1 | 默认密度档位与页数 | 保持 `standard`（10–14 页）；`deep` 作为重课程选项 |
| Q2 | 检查题结果是否持久化 | MVP 先本地状态 + 显式学完；下阶段再存分数/需复习 |
| Q3 | 学习面板默认打开还是关闭 | 默认关闭，标题旁显示角色/检查数；用户可记忆偏好 |
| Q4 | 移动端滚动策略 | **允许移动端纵向滚动**；桌面（发布门禁 1280/1440/1920 + 阅读器内容视口）保持零滚动；移动端禁止横向溢出，不承诺单屏 |
| Q5 | 教学评分门禁 | P11 校准后设 `≥70` 为 Builder 重试条件，不直接判死 |
| Q6 | 真实模型验证预算 | ¥6 上限；超出前暂停并汇报 |
| Q7 | 默认模型/Prompt 语言 | 以 DeepSeek Flash 基线；compact 英文规则 + 中文内容按 A/B 结果决定 |

---

## 附录 A · 教学 Manifest 示例（mechanism）

```json
{
  "schema_version": "1.1",
  "design_system": "1.0",
  "page_id": "page_012",
  "title": "二分查找：每次排除一半",
  "subtitle": "维护区间不变量，直到命中或为空",
  "knowledge_point_ids": ["kp_12"],
  "importance": "core",
  "estimated_minutes": 7,
  "layout": "split-steps",
  "interactions": [
    {
      "id": "bisect-demo",
      "type": "simulate",
      "label": "拖动目标值，观察区间收缩",
      "objective_id": "o2",
      "smoke": {
        "action": "click",
        "selector": "[data-mp-action='step']",
        "expect": "[data-mp-state='stepped']"
      }
    }
  ],
  "teaching": {
    "version": "1.0",
    "role": "mechanism",
    "objectives": [
      "能说出二分查找的循环不变量",
      "能解释每次排除一半的原因"
    ],
    "prerequisites": ["数组有序", "区间概念"],
    "hook": "如果每次只排除一个元素，10 亿个数要试多久？",
    "chain": [
      { "id": "c1", "title": "维护搜索区间", "block_id": "b1" },
      { "id": "c2", "title": "比较中点", "block_id": "b2" },
      { "id": "c3", "title": "排除一半", "block_id": "b3" }
    ],
    "check": [
      {
        "id": "q1",
        "objective_id": "o2",
        "question": "为什么 mid 要向下取整？",
        "options": ["保证区间收缩", "让结果更快", "避免数组越界", "没有原因"],
        "answer_index": 0,
        "explanation": "向下取整保证 left/right 至少移动一格。"
      }
    ],
    "summary": {
      "key_points": ["区间不变量", "每次排除一半", "O(log n)"],
      "misconceptions": ["mid 向上取整导致死循环"],
      "next": "下一节：边界写法"
    }
  },
  "source_refs": [
    { "material_id": 3, "section_id": 42, "quote": "二分查找每次将搜索区间缩小一半……" }
  ],
  "assistant": {
    "summary": "本页讲解二分查找的区间不变量与复杂度。",
    "key_facts": ["循环不变量", "O(log n)", "边界条件"],
    "suggested_questions": ["为什么 mid 要向下取整？", "什么时候会死循环？"]
  },
  "a11y": { "reduced_motion": true }
}
```

## 附录 B · Page Brief 示例（节选）

```json
{
  "page_id": "page_012",
  "deck_title": "数据结构 · 复习页",
  "chapter_title": "查找算法",
  "role": "mechanism",
  "teaching_contract": {
    "objectives": ["能说出循环不变量", "能解释排除一半"],
    "prerequisites": ["数组有序"],
    "required": ["hook", "chain", "worked_example", "check", "misconception"],
    "density": {
      "visible_layer_chars": 450,
      "total_page_chars": 700,
      "visible_blocks": 6,
      "total_blocks": 8,
      "primary_interactions": 1,
      "checks": 2
    }
  },
  "knowledge_point": {
    "title": "二分查找",
    "summary": "在有序数组中折半查找",
    "objectives": ["..."],
    "key_points": ["..."],
    "formulas": ["$O(\\log n)$"],
    "misconceptions": ["mid 向上取整导致死循环"]
  },
  "merged_knowledge_points": [],
  "source_excerpts": [
    { "section_id": 42, "heading": "二分查找", "text": "……" }
  ],
  "style": { "preset": "blueprint", "content": ["concept", "formula"], "density": "standard", "custom_prompt": "" },
  "deck_context": {
    "previous_learning": "上一页已经讲清有序数组与区间",
    "next_hook": "下一页做边界题",
    "chapter_index": 2,
    "chapter_total": 4
  },
  "constraints": {
    "viewport": ["1280x720", "1440x900", "1920x1080"],
    "no_scroll": true,
    "no_network": true,
    "max_bundle_bytes": 2097152,
    "runtime_version": "1.1.0",
    "language": "zh-CN"
  }
}
```

## 附录 C · Builder 会话请求示例

```json
{
  "build_id": "bld_page_012_v2_7f3a",
  "page_brief": { "page_id": "page_012", "role": "mechanism", "...": "..." },
  "session": {
    "key": "deck_9_lane_0",
    "lane": 0,
    "page_index": 2,
    "page_total": 7,
    "first": false
  },
  "deck_context": {
    "deck_title": "数据结构 · 复习页",
    "style": { "preset": "blueprint", "density": "standard" },
    "pages": [{ "page_id": "page_010", "role": "concept", "title": "有序数组" }],
    "previous_learning": "上一页已经讲清有序数组与区间",
    "next_hook": "下一页做边界题"
  }
}
```

## 附录 D · 每页任务卡（Prompt 骨架）

```text
你是 MockFinal 页面构建代理。本页是 Deck 的第 {page_index}/{page_total} 页，角色：{role}。

只改 pages/{page_id}/ 下的 4 个文件；以 scaffold 为基础，优先 edit，不整页重写。
读 briefs/{page_id}.json 与 materials/index.md；只引用 brief 指定的 section_id。
本页教学重点：
- 目标：{objectives}
- 讲解链：{chain}
- 必须包含：{required}
密度预算：整页总正文 ≤700 字；单层建议 ≤450–500 字，超出用渐进式披露；可见块 3–6、主交互 1、检查 1–2。
使用 Kit class（mp-kit-*），不要自造按钮/卡片/排版；不要写说明文。
完成后调用 check_page(page_id="{page_id}")；按问题修复；通过后结束。
```

## 附录 E · 文件落地地图

| 改动 | 文件 |
| --- | --- |
| 大纲/角色/页计划/Brief | `backend/app/services/deck_planner.py`、`deck_builder.py`、`schemas.py`、`types/index.ts` |
| 教学契约/Validator | `docs/pageref/PAGE_CONTRACT.md`、`validator/src/static-check.ts`、`browser-check.ts`、`shared/page-shell/shell.mjs` |
| 设计系统/模板 | `shared/page-shell/shell.mjs`、`builder/pi-harness/templates/roles/*`、`pi-harness/skills/*` |
| 会话复用/Guard | `builder/src/session.ts`、`server.ts`、`task-store.ts`、`pi-harness/extensions/mockfinal-guard/index.ts` |
| 主 API lane | `backend/app/services/deck_builder.py`、`page_builder_client.py`、`models.py`、`main.py`（DDL） |
| 阅读器/学习面板 | `frontend/src/views/DeckReaderView.vue`、`components/deck/DeckStudyPanel.vue`、`TeachingRail.vue`、`LessonCheck.vue`、`PageFrame.vue` |
| 总览/构建台 | `DeckOverviewView.vue`、`DeckBuildView.vue`、`DeckRoadmap.vue`、`DeckWorkbench.vue`、`DeckPageCard.vue`、`BuildSetupPanel.vue` |
| 全局视觉 | `frontend/src/style.css`、`AppIconButton.vue`、`EmptyState.vue`、`ErrorState.vue`、`DeckTopBar.vue`、`DESIGN.md` |
| 测试/验收 | `backend/tests`、`builder/tests`、`validator/src/tests`、`frontend/src/**/*.test.ts`、`validator/scripts/p5-acceptance.mjs`、`p6-acceptance.mjs` |

---

## 附：继续生效的旧版不变量

以下来自旧 Plan/P7，不在本轮修改范围内，但任何新改动必须继续满足：

- 页面在 `sandbox="allow-scripts"` iframe 中运行，`srcdoc` 注入，CSP 禁止网络；不得添加 `allow-same-origin`。
- HTML 禁止 `script/style/iframe/object/embed/link/form/meta/base` 与内联事件；JS 禁止网络、存储、eval、父窗口；CSS 禁止 `@import` 与外部 `url()`。
- 只有 Builder 交付 bundle 且主 API 独立 Validator 通过后，页面才能 `ready`；不得伪造 bundle 或跳过最终校验。
- Builder/Validator 未配置、超时、连接失败、503/504 → 页面 `failed`（fail-closed），不降级跳过。
- 单页重建/整册重建失败时保留旧 `current_version`/`bundle_key`；新版本通过后才切换。
- 同一 Deck 最多一个活跃 job；客户端断开不取消；取消只由独立接口触发。
- 所有资源访问校验归属；他人资源 404；不泄露存在性。
- LLM 输出、教学文本、检查题、AI 回答一律视为不可信；前端 `html:false` + DOMPurify，不得为视觉效果放宽。

---

> 本方案的实施以 P11 黄金集门禁与维护者审阅为准；未通过门禁不进入默认放量。所有真实模型验证费用按 §6.5 上限执行，超出前暂停并汇报。
