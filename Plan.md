# PageRef · 动态复习页与 Pi Agent 构建流水线

> 本文是 `feat/pageref` 分支的方案调研、架构决策与开发路线图。
> 状态：**方案已确认（2026-11-07）；P0–P7 已完成；真实 Pi 门禁与真实 14 页 E2E 均已通过（DeepSeek Flash，总成本 ¥1.83）；人工发布审阅待办**。
> 基线：`main` @ `cea3a1f`（2026-11-07）。
> 目标读者：项目维护者、后端/前端开发者、Agent 开发者。

> **实施进度（2026-11-07）**
> - P0 已完成：页面契约、内部接口契约、黄金 brief、最小测试栈、Builder/Validator 骨架（`docs/pageref/`）。
> - P1 已完成：`material_sections` + 解析分节 + 去 Embedding；pytest 6 项、接口上传/分节、旧资料懒回填均实测通过。
> - P2 已完成（Gate **Go**）：共享运行时/Shell、Validator、Builder（Pi 1.5.0 适配 + Guard Extension）、Harness 与黄金示例；真实 Pi 3 页门禁通过（DeepSeek 官方 `deepseek-flash`，3/3 首轮校验、p90 157.2s、成本 ¥0.14），红队 16/16，详见 `docs/pageref/P2_REPORT.md` 与 `POC_ACCEPTANCE.md`。
> - P3 已完成：Deck 六表、大纲规划/页面计划/Page Brief、事件与取消；隔离库集成测试 49 项通过，详见 `docs/pageref/P3_REPORT.md`。
> - P4 已完成：Builder HMAC 客户端、主 API 最终校验门禁、bundle/缩略图存储与版本切换、并发/重试/超时/取消/自愈；默认 69 项、P4 集成 3 项（P7 扩至 6 项）通过。**真实 Pi 14 页 E2E 通过**：14/14 ready、0 failed、全部 Validator passed、0 issues，耗时 15m11s，成本 ¥1.69，详见 `docs/pageref/P4_REPORT.md` 与 `P4_REAL_E2E.json`。
> - P5 已完成：复习页入口/总览路线图/工作台、构建设置与实时工作台、全屏阅读器、选区桥接与依据资料、深色/响应式/reduced-motion；前端 16 项、浏览器验收 34 项全部通过（0 控制台错误，含 Fullscreen API、全屏 AI 抽屉与失效 job 恢复），详见 `docs/pageref/P5_REPORT.md`。页面 AI 助手当时为 P6 占位。
> - P6 已完成：页面助手 SSE、上下文预算、来源引用、20 次/分限流、消息持久化/断线自愈、侧栏流式 UI 与 XSS 清洗；前端 20 项、后端默认 74 项、隔离库集成 4 项、浏览器验收 24 项全部通过（0 控制台错误），P5 回归 29/29；真实模型质量因无 LLM 凭据未评估，详见 `docs/pageref/P6_REPORT.md`。
> - P7 已完成：三路安全审计与修复（上传路径/错误泄露/Validator 门禁/阅读器视口/提示词随机边界/Shell 标签（含 meta/base）/JS 外链/助手硬预算/启动自愈 select 缺失/单页重试状态收敛/HMAC method+path 绑定/阅读器与工作台竞态/全屏浮层）、结构化日志、迁移/发布/回滚手册；后端 87、集成 6（含 12 页断线恢复与启动自愈）、前端 20、Validator 44、红队 16/16、Builder 22、P5 34/34、P6 24/24，详见 `docs/pageref/P7_REPORT.md` 与 `P7_RELEASE.md`。
> - 下一步：人类维护者审阅 P2/P4/P7 证据与截图后决定合并（不自行 push/merge）；模型密钥仅存于被忽略的 `backend/.env`。

---

## 0. 结论摘要

**总体可行性：可行，但必须先通过一个 Pi 页面构建 PoC 门禁。**

- **去 Embedding：低风险、高确定性。** 当前向量库只服务于「资料取块」与一次 RAG 补充；课程资料是工作区内的封闭语料，知识点与资料段落可以通过结构化分节 + 显式 `section_id` 引用稳定绑定，不需要语义向量。移除后反而减少一个外部依赖、一类配置与一条失败链路。
- **模拟考试保留：** 已确认继续提供旧模拟卷的生成与展示，仅改为 sections 驱动；复习 Markdown 由 Deck 取代，旧工件迁移期只读。
- **动态页面：中等偏高风险，但可控。** 页面不是固定 JSON 模板，而是由 Pi 生成 `HTML/CSS/JS` 代码包，在严格沙箱 iframe 中运行；通过「页面契约 + 运行时 API + Playwright 校验器 + 最多 2 轮修复」把不可控的代码生成收敛为可验收的产物。
- **Pi 容器化：高确定性。** Pi 1.5.0（MIT）提供 SDK、RPC、JSON 事件流、Skills、Prompt Templates、Extensions、自定义 Provider，官方文档给出了 Docker 隔离方式。主项目通过内部 HTTP 接口与 builder 容器通信，符合需求中的三阶段设计。
- **最重要的产品决策：** 总览页由 Vue 原生实现（稳定、可访问、可做路线图）；只有具体复习页交给 Pi 生成。这样「工作台/路线图」不依赖代码生成质量，风险集中在可控的页面层。
- **关键门禁：** Phase 2 用 3 个代表性知识点（二分查找动画、公式推导、时间线叙事）跑通 Pi 构建、校验与修复闭环。若首轮通过率/零滚动率/交互可用性达不到阈值，退回 Plan B（受控组件 DSL + 自定义 CSS/JS 插槽），不把风险带入完整产品开发。

### 0.1 可行性矩阵

| 需求 | 可行性 | 依据 | 主要风险 |
| --- | --- | --- | --- |
| 移除 Embedding | 高 | 向量仅用于取块与一次 RAG；课程资料封闭；可改为分节 + 显式引用 | 失去语义检索；用结构化来源与后续关键词检索补偿 |
| 按章节/知识点生成 | 高 | 现有 LLM + 摘要流水线可改造成结构化大纲；Pydantic 校验成熟 | 大纲质量依赖资料质量；需要 source_refs 约束 |
| Pi 容器化 | 高 | Pi 1.5.0 提供 SDK/RPC、事件流、Skills、Templates、Extensions、Docker 指南 | 版本 API 变化；需锁定与适配层 |
| 生成动态页面 | 中高 | Pi 是编码 Agent，可写 HTML/CSS/JS；沙箱 iframe + Validator 可约束 | 页面质量/零滚动/交互一致性；需 PoC Gate |
| 每页全屏一屏 | 中高 | 固定 stage + clamp + Playwright 多视口测量 + 修复闭环 | 真实字体/缩放边界；需内容预算与拆页 |
| 侧边 AI 助手 | 高 | 现有 LLM + MarkdownView + SSE；选区经 postMessage 桥接 | 上下文裁剪、引用准确性、断线语义 |
| 构建过程可见 | 高 | Pi 事件流 + DB 事件表 + 轮询/重连；符合长任务规范 | 事件过多/敏感信息；需白名单与截断 |
| 渐进交付/单页重做 | 高 | 页面独立构建、独立版本、独立存储；Deck 聚合状态 | 编排复杂度；需失败隔离与幂等 |

### 0.2 推荐实现顺序

去 Embedding → Pi Builder PoC → Deck 领域模型 → 构建集成 → 阅读器/工作台 → AI 助手 → 加固发布。

---

## 1. 现状调查

### 1.1 当前主链路

```text
上传资料（OSS 直传 / 本地 multipart）
  → 后台解析（pdfplumber / python-docx / python-pptx / 文本）
  → 分块 1000 / overlap 200
  → Embedding → pgvector(material_chunks)
  → 生成任务：取向量块 → 每份资料摘要子代理（Semaphore 4）
  → RAG 补充（工作区名+描述检索 top-8）
  → 复习代理 + 出卷代理并行
  → 两份 Markdown 写入存储 → artifacts 落库
  → 前端 ArtifactPanel 用 MarkdownView 展示
```

### 1.2 Embedding 耦合点（必须全部拆除）

| 位置 | 现状 | 处理方向 |
| --- | --- | --- |
| `backend/app/config.py` | `EMBED_BASE_URL / EMBED_API_KEY / EMBED_MODEL / EMBED_DIM`、`embed_configured` | 删除 |
| `backend/app/services/indexer.py` | `PGEngine` / `PGVectorStore` / `material_chunks` / 向量检索 / 向量清理 | 替换为「解析分节」服务 |
| `backend/app/services/generator.py` | `fetch_chunks_from_db()` 取块；`retrieve_workspace_chunks()` 做 RAG | 改为取 `material_sections`；删除 RAG 补充 |
| `backend/app/main.py` | 启动时建向量表、Embedding 未配置告警 | 删除向量初始化 |
| `backend/app/routers/workspaces.py` | 删除工作区时 best-effort 清向量 | 仅删分节与存储 |
| `backend/app/routers/materials.py` | 删除资料时清向量 | 仅删分节与存储 |
| `backend/requirements.txt` | `langchain-postgres==0.0.19`、`pgvector<0.4` | 删除；保留 chat LLM 与文本分节依赖 |
| `docker-initdb.d/01-init.sql` | `CREATE EXTENSION vector` | 新库不再启用；旧库保留但不再使用 |
| `docker-compose.yml` | `pgvector/pgvector:pg17` | 可在清理阶段换回 `postgres:17` |
| `README.md / AGENT.md / backend/.env.example` | Embedding 环境变量与向量说明 | 同步移除/改写成「解析分节」 |
| 前端 `MaterialStatus` | `indexing / indexed` 文案「索引中 / 已就绪」 | **保留枚举**，只改用户文案为「解析中 / 已就绪」 |

### 1.3 当前生成链路与产品瓶颈

1. **输出是长 Markdown**：信息密度高，但不可交互、不可分页，无法承载「一屏一个知识点」的节奏。
2. **生成粒度是「整份文档」**：一次生成两份长文，无法按知识点增量交付，也无法只重做某一页。
3. **展示方式是被动阅读**：没有动画、没有可操作示例、没有针对单个知识点的即时问答。
4. **Embedding 带来不必要的运维面**：维度、模型、向量表、外部网关、删库重建等问题，与当前课程资料的封闭范围不匹配。
5. **长任务已有基础**：现有 `GenerationJob + tasks.spawn() + 2s 轮询` 与 RULE.md §3.7 的长任务约束可以直接复用为 Deck 构建任务模型。

### 1.4 结论

- 删除 Embedding 是**净简化**，可以在第一阶段独立完成并验证。
- 新复习页需要一个新的领域模型（Deck / KnowledgePoint / Page / BuildJob / BuildEvent），而不是继续堆在 `Artifact` 上。
- Pi 的产物不应是「一段 Markdown」，而应是**受契约约束的页面代码包**；主项目负责编排、校验、存储与展示。

---

## 2. 目标与非目标

### 2.1 目标

1. **彻底移除 Embedding 依赖**：无 `EMBED_*` 配置、无 pgvector 运行时依赖、无向量表读写；资料解析后以结构化分节持久化。
2. **以知识点为中心生成复习资料**：章节/知识点划分 → 页面规划 → 每个知识点 1–3 页 → 逐页构建与放行。
3. **新的复习体验**：总览页（路线图 + 工作台）+ 若干全屏复习页；桌面全屏下每页一屏展示，不出现页面滚动。
4. **深度个性化**：用户选择风格、内容偏好并填写自定义提示词；页面根据具体知识点生成定制动画、示例、图示与交互。
5. **Pi Agent 容器化**：Pi 运行在独立 builder 容器中，通过内部接口接收资料与页面 brief，返回页面产物；主项目负责最终格式校验与放行。
6. **构建过程可见**：构建工作台实时展示阶段、Pi 输出摘要、页面完成进度与校验结果；离开页面不影响任务。
7. **页面 AI 助手**：选中文本 + 上下文发送给侧边助手，流式回答，带来源引用。
8. **保留模拟考试**：继续提供现有模拟卷的生成与阅读，仅将资料取用改为分节驱动；本期不将其纳入 Deck 页面化改造。

### 2.2 非目标（本期不做）

- 不做多人协作、分享链接、评论、云端同步（仍为单用户工作区）。
- 不做 PDF/PPT 导出（可作为后续独立任务）。
- 不重做模拟试卷的产品形态；**模拟考试保留**，继续以旧 Markdown 视图呈现并改造为 sections 驱动；旧复习 Markdown 工件在迁移期保持可读。
- 不做多租户/多副本构建队列；MVP 为单 builder 实例 + 进程内并发控制。
- 不做页面内自由联网、外部 npm 包、CDN、Web Font；页面必须是自包含产物。
- 不做可视化编辑器；用户通过预设 + 自定义提示词影响生成，通过反馈重做单页。

### 2.3 成功指标（在 Phase 2 门禁后校准）

| 维度 | 目标 |
| --- | --- |
| 页面构建 | 12 页标准 Deck 的 p90 完成时间 ≤ 25 分钟 |
| 页面质量 | 首轮校验通过率 ≥ 70%；最多 1 轮修复后 ≥ 90% |
| 布局 | 1280×720 / 1440×900 / 1920×1080 下零纵向滚动通过率 100% |
| 交互 | 每个非纯总结页至少 1 个可操作的交互/动画，且冒烟操作通过 |
| 稳定性 | 单页最终失败率 < 5%；单页失败不影响其他页交付 |
| 安全 | 校验器拦截 100% 外链/外部请求；沙箱逃逸红队用例 0 通过 |
| 助手 | 选中文本后首 token < 3s；回答必须引用页面/资料上下文 |
| 迁移 | 旧资料无需重新上传即可完成分节回填；旧复习 Markdown 只读可读；模拟考试继续可用 |

---

## 3. 产品设计

### 3.1 用户旅程

```text
工作区（已有资料）
  → 点击「生成复习页」
  → 构建设置：风格预设 + 内容偏好 + 页面密度 + 自定义提示词
  → 启动构建（后台任务）
  → 构建工作台：大纲形成 → 页面逐页出现 → 实时输出/校验
  → 总览页：知识点路线图 + 工作台（可开始阅读已就绪页面）
  → 复习页：全屏动态页面，键盘/点击翻页
  → 选中文本 → 侧边 AI 助手问答
  → 对某页不满意 → 带反馈重做该页
```

### 3.2 信息架构

```text
/workspace/:id
  ├─ 学习资料（保留）
  ├─ 复习页（新主入口）
  │    ├─ /decks/:deckId            总览页（路线图 + 工作台）
  │    ├─ /decks/:deckId/build      构建工作台（进行中/失败重试）
  │    └─ /decks/:deckId/pages/:pageId  全屏复习页
  ├─ 模拟考试（保留，继续使用旧 Markdown 视图）
  └─ 旧版资料（旧复习 Markdown，迁移期只读）
```

### 3.3 总览页（原生 Vue，不交给 Pi）

总览页承担两个角色：

1. **知识点路线图**：按章节分组的节点图；节点大小/描边表达重要度，连线表达先修/递进关系；节点状态（未开始/进行中/已就绪/构建中/失败）用图标 + 文案 + 反转/描边表达，不靠颜色。
2. **工作台**：继续上次、总进度、页面清单、资料覆盖情况、风格摘要、重建入口、失败页重试。

约束：

- 桌面端一屏内完成，不滚动；最多 5 章 × 3 个知识点、16 页，超出时采用紧凑布局/缩放控制。
- 移动端允许纵向滚动（明确例外），但不得横向溢出。
- 路线图数据来自后端 `knowledge_points`，不在前端推断。

### 3.4 复习页（Pi 生成）

- **一页一个主知识点**；复杂知识点可拆 1–3 页；非重要知识点可合并到一页。
- **动态 PPT 形态**：大标题 + 少量内容块 + 一个主要视觉/交互；页面内部可以有步骤、动画、拖拽、滑块、折叠、SVG/Canvas 演示。
- **桌面全屏一屏展示**：页面只使用 `100dvh` 内的网格布局，禁止 `window.scrollTo` 与纵向滚动容器。
- **非纯文字**：至少一个与知识点相关的视觉化/交互元素；例如二分查找的区间收缩动画、矩阵变换的网格、时间线的逐步展开、公式的推导步骤。
- **内容来源可追溯**：manifest 中带 `source_refs`，页面底部/侧边可查看「依据资料」摘要。
- **可重做**：阅读页提供「这一页需要调整」入口，附带用户反馈重建单页；旧版本在新版本就绪前仍可阅读。

### 3.5 构建工作台

构建设置（开始前）：

- 风格预设：`讲义 / 图解 / 冲刺 / 叙事`（均为单色体系，详见 §9.6）。
- 内容偏好（多选）：概念定义、公式推导、例题、易错点、记忆口诀、对比表、练习。
- 页面密度：精简（6–9 页）/ 标准（10–14 页）/ 深入（14–16 页）。
- 自定义提示词（≤ 500 字）：例如「多用生活类比」「公式推导要一步步来」。
- 预计页数、预计耗时、当前使用模型（只读）。

构建中工作台：

- 阶段时间线：`整理资料 → 规划知识点 → 生成页面 brief → 构建页面 → 校验 → 完成`。
- 实时输出：Pi 的**可见文本增量**、工具动作摘要（如「正在编写第 3 页的动画」「正在自检布局」），不展示隐藏推理、不展示原始 bash 输出（本方案禁用 bash）。
- 进度：真实页级计数 + 当前页状态；禁止伪造百分比。
- 页面卡片：每页完成后即时出现缩略图/标题/状态，可提前阅读。
- 可离开：关闭页面/刷新不影响后台构建；重新进入按 `job_id` 恢复。
- 失败处理：显示中文原因、失败页列表、重试单页/取消任务。

### 3.6 风格与个性化

MVP 的风格差异通过**排版、网格、密度、动效、交互隐喻**实现，不引入彩色渐变、AI 光晕、玻璃拟态等与 DESIGN.md 冲突的元素。

| 预设 | 气质 | 典型布局 | 动效 |
| --- | --- | --- | --- |
| 讲义 Editorial | 安静、纸感、适合长读 | 大标题 + 边注 + 单栏 | 段落淡入、重点下划线 |
| 图解 Blueprint | 结构、网格、推演 | 网格/坐标/分步图示 | 线条绘制、步骤高亮 |
| 冲刺 Drill | 高密度、考点导向 | 卡片 + 公式 + 速查 | 快速切换、强调反转 |
| 叙事 Story | 场景、类比、时间线 | 横向时间线/场景块 | 逐步揭示、路径移动 |

- 预设与本项目 DESIGN.md 的语义 token 对齐；页面只使用 `ink/muted/faint/panel/raised/border` 等语义色。
- 若未来需要彩色主题，必须在 `DESIGN.md` 先增加「Deck 视觉扩展」并通过设计评审；本期不做。
- 用户自定义提示词的优先级低于页面契约、安全约束与设计硬规则；它只能影响内容与表达，不得要求外链、联网、eval、绕过校验。

### 3.7 页面 AI 助手

- 侧边抽屉（overlay，不改变页面布局，避免页面重排导致溢出）。
- 选中文本后出现「问 AI」动作；打开助手时自动引用选中文本 + 所在块上下文。
- 快捷动作：解释这段 / 举个例子 / 帮我记 / 考考我 / 和上一页有什么关系。
- 回答流式输出；使用 MarkdownView（`html:false` + DOMPurify）渲染。
- 回答必须优先依据当前页面 manifest 摘要、选中上下文与 `source_refs` 对应的资料段落；找不到依据时明确说「资料中未覆盖」。
- 每个页面对应一个会话线程；刷新后可恢复历史（持久化到后端）。

### 3.8 全屏与响应式

| 视口 | 行为 |
| --- | --- |
| ≥ 1280×720 桌面全屏 | **必须零滚动**；页面 stage 16:9 适配 |
| 1024–1279 宽 | 允许页面 stage 等比缩放；仍以零滚动为目标 |
| 768–1023 宽 | 阅读器缩放/紧凑布局；零滚动为建议目标 |
| < 768 宽 | 明确降级为「阅读模式」：允许纵向滚动，隐藏全屏翻页手势；不做零滚动承诺 |

- 使用 Fullscreen API 隐藏浏览器 chrome；Esc 退出。
- 页面 iframe 监听宿主 resize，runtime 提供当前视口尺寸；页面用 `clamp()`/`minmax()`/容器查询适配，不依赖固定 px。
- 顶部仅保留：返回、Deck 标题、页码/进度、全屏、AI 助手。
- 键盘：←/→/空格翻页，Esc 退出全屏/关闭助手；焦点可见。

---

## 4. 总体架构

### 4.1 组件图

```mermaid
flowchart LR
    subgraph Browser["浏览器（Vue 3）"]
        UI["工作区 / 总览 / 构建工作台"]
        Reader["全屏阅读器"]
        Frame["沙箱 iframe<br/>页面运行时"]
        Assistant["AI 助手侧栏"]
        UI --> Reader
        Reader --> Frame
        Reader --> Assistant
    end

    subgraph Backend["FastAPI + PostgreSQL"]
        API["API / 鉴权 / 归属校验"]
        Planner["大纲与 Page Brief 规划"]
        Orches["Deck 构建编排"]
        Chat["AI 助手上下文与流式接口"]
        API --> Planner
        API --> Orches
        API --> Chat
    end

    subgraph Builder["Pi Builder 容器（Node 24）"]
        BHTTP["内部 HTTP 接口"]
        SDK["Pi SDK Session"]
        Guard["MockFinal Harness<br/>Skill / Template / Extension"]
        BHTTP --> SDK --> Guard
    end

    subgraph Validator["Page Validator 容器（Playwright）"]
        VHTTP["内部 HTTP 接口"]
        Headless["Headless Chromium<br/>布局 / 交互 / 网络 / 控制台"]
        VHTTP --> Headless
    end

    DB[("PostgreSQL<br/>materials / sections<br/>decks / pages / jobs / events")]
    Store[("OSS / 本地存储<br/>页面 bundle / 缩略图")]
    LLM["LLM 网关<br/>OpenAI 兼容"]

    UI -->|REST + SSE| API
    Reader -->|REST| API
    Assistant -->|SSE| API
    API --> DB
    API --> Store
    Orches -->|HMAC 内部 HTTP| BHTTP
    BHTTP -->|Pi events| Orches
    Orches -->|最终校验| VHTTP
    SDK -->|页面自检| VHTTP
    Planner --> LLM
    Chat --> LLM
    SDK --> LLM
    Store -->|bundle JSON| Reader
```

### 4.2 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| FastAPI API | 鉴权、资源归属、Deck 领域、编排、最终校验门禁、存储、聊天上下文 | 生成页面代码、运行生成代码 |
| Pi Builder | 接收 brief/资料包；驱动 Pi 会话；文件约束；页面自检；打包 bundle | 访问业务库、OSS、用户 token、主项目密钥 |
| Page Validator | 在隔离 Chromium 中加载页面；零滚动/交互/网络/控制台/截图检查 | 生成内容、持有业务数据 |
| 前端阅读器 | 组装沙箱 shell；iframe 生命周期；翻页；选区桥；全屏 | 生成页面、执行未校验代码 |
| 页面运行时 | iframe 内的 API、选区/错误/尺寸上报、主题注入 | 访问网络、访问父页面 DOM |

### 4.3 三阶段时序

```mermaid
sequenceDiagram
    autonumber
    participant API as FastAPI 编排
    participant B as Pi Builder
    participant P as Pi Session
    participant V as Page Validator

    Note over API: 阶段一：获取资料
    API->>API: 取 material_sections + 知识点 + 风格 spec
    API->>API: 组装 source_pack / page_brief / 约束

    Note over API,B: 阶段二：页面构建
    API->>B: POST /v1/builds（brief + 资料 + 约束 + HMAC）
    B->>P: createAgentSession + /build-page
    P->>P: 读取资料与 runtime 文档
    P->>P: write page.html / page.css / page.js / manifest.json
    P->>V: check_page 工具（经 Builder 调用）
    V-->>P: 结构化问题列表
    P->>P: 最多 2 轮修复
    P-->>B: agent_settled
    B->>V: 最终校验（layout / interaction / network / console）
    V-->>B: validation_report
    B-->>API: bundle + report + usage

    Note over API: 阶段三：页面交付
    API->>V: 独立最终门禁（不信任 Builder 报告）
    V-->>API: pass / fail
    API->>API: 保存 bundle + thumbnail + page_ready
    API-->>API: 推进 Deck 进度，事件落库
```

### 4.4 关键设计决策

| 编号 | 决策 | 理由 | 备选/后果 |
| --- | --- | --- | --- |
| D1 | 删除 Embedding，改为 `material_sections` + 显式引用 | 课程资料封闭、知识点可结构化；减少依赖与运维 | 失去语义检索；用分节元数据、标题匹配、Postgres 全文/trigram（后续可选）弥补 |
| D2 | Deck 取代「期末终极复习」Markdown；旧 review/exam 工件迁移期只读 | 新产品形态需要分页与增量交付 | 旧生成接口保留一个迁移期；后续单独下线 |
| D3 | 总览页原生 Vue；复习页由 Pi 生成 | 路线图/工作台必须稳定可访问；把生成风险限制在页面层 | 总览风格与页面风格需共享 token；不追求完全由 Agent 生成 |
| D4 | 页面产物是 `manifest + html + css + js` 代码包，不是固定 JSON 字段 | 满足自定义动画/交互；JSON DSL 无法覆盖深度定制 | 需要严格沙箱、静态检查、Playwright 校验与修复闭环 |
| D5 | 页面在 `sandbox="allow-scripts"` iframe 中运行，`srcdoc` 注入，CSP 禁止网络 | 生成代码视为不可信；隔离父页面、cookie、存储与网络 | 页面不能请求外部资源；复杂第三方库不可用 |
| D6 | Pi 使用 SDK 在 Builder 容器内运行；禁用 bash；仅 `read/write/edit + 自定义工具` | Node 进程内事件与自定义工具最直接；无 bash 即无代码执行面 | Pi 版本升级需适配；Builder 与 Pi 共享容器，但页面代码不在其中执行 |
| D7 | 独立 Validator 容器作为最终门禁 | 主项目不信任 Builder 自检；Playwright 能真实测布局 | 多一个服务；Validator 不可用时构建 fail-closed |
| D8 | 页面渐进交付，单页失败不拖垮整册 | 12 页构建时间长；用户可以先读已完成页 | Deck 状态可能为 `partial`；需要失败重试 UI |
| D9 | MVP 保持单色纸感，风格差异靠排版/网格/动效 | 与 DESIGN.md 一致，避免品牌漂移 | 彩色主题需设计评审后另开 |
| D10 | 大纲与资料 brief 由 Python LLM 生成；Pi 只做页面构建 | 结构化规划更适合主后端；减少 Pi 上下文与不确定性 | 两个模型配置；需要保证 brief 质量 |
| D11 | 构建事件落库，前端轮询/重连；任务不绑定连接 | 符合 RULE.md §3.7；刷新不丢任务 | 事件表需要保留策略；MVP 不做跨进程消息队列 |
| D12 | 页面 bundle 存 JSON（含 data URI 资源），不存多文件目录 | 单文件交付、易校验、易签名/存储、无路径穿越 | 单页大小上限 2MB；超大资产需压缩或拆页 |

---

## 5. 去 Embedding 方案

### 5.1 目标模型：资料分节

新增表 `material_sections`（`create_all` 自动建表，无需迁移工具）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | bigint PK | 稳定引用 ID |
| `material_id` | FK materials cascade | 所属资料 |
| `workspace_id` | FK workspaces cascade | 便于按工作区查询 |
| `ordinal` | int | 资料内顺序 |
| `heading` | varchar(255) | 章节/页/幻灯片标题 |
| `content` | text | 分节正文 |
| `char_count` | int | 字符数 |
| `page` | int nullable | PDF 页码 / PPTX 幻灯片序号 |
| `meta` | jsonb | 来源、标题层级、解析器信息 |
| `created_at` | timestamptz | UTC |

唯一约束：`(material_id, ordinal)`；索引：`(workspace_id)`、`(material_id)`。

分节策略：

- 解析器保持现有 PDF/DOCX/PPTX/MD/TXT 支持，但增强标题提取：
  - PDF：优先按页；首行短文本作为 heading 候选；
  - DOCX：读取段落 `style.name`（Heading 1/2/3）生成层级；表格保留；
  - PPTX：幻灯片标题作为 heading；
  - MD：按 `#`/`##` 标题切分，再按长度细分；
  - TXT：按空行/编号标题启发式切分。
- 单节目标 800–1500 字符，保留 100 字符重叠；不跨页合并。
- 每节生成稳定 `section_id`；后续大纲、页面 brief、AI 助手均引用它。

**契约兼容：** 保留 `Material.status` 的 `uploaded / indexing / indexed / failed` 枚举，避免破坏前端类型与旧接口；语义改为「文本解析与分节」。`chunk_count` 复用为「分节数」，文档注明。用户文案改为「解析中 / 已就绪」。

### 5.2 生成链路改造

```text
材料上传 → 后台解析 → 分节 → material_sections 落库 → material.indexed
  → 旧版生成：按工作区取 sections → 摘要 map-reduce → review/exam（不再检索向量）
  → 新版 Deck：按工作区取 sections → 大纲规划 → 知识点 source_refs → Page Brief
```

- 删除 `fetch_chunks_from_db` 与 `retrieve_workspace_chunks`；新增 `fetch_sections_from_db(workspace_id)`。
- 旧版生成中的 RAG 补充段落删除；摘要与成品提示词保留，作为迁移期兼容能力。
- 资料删除/工作区删除：`material_sections` 通过 FK cascade 自动清理；不再有向量清理。
- 懒回填：取分节时，如果某资料 `indexed` 但无分节，自动触发一次解析回填（每资料幂等，状态不变）；避免要求用户重新上传。

### 5.3 删除清单

- `backend/app/config.py`：`embed_*` 字段与 `embed_configured`。
- `backend/app/services/indexer.py`：整个向量实现；重命名/替换为 `sectioner.py`（或保留文件名但内部改为分节，减少导入改动；建议重命名为 `sectioner.py` 并更新导入）。
- `backend/app/services/generator.py`：向量取块/RAG。
- `backend/app/main.py`：向量表初始化与未配置告警；启动自愈中的 `indexing` 语义保留。
- `workspaces.py` / `materials.py`：向量清理调用。
- `requirements.txt`：`langchain-postgres`、`pgvector`；`langchain-core`/`langchain-text-splitters` 仍可用于 chat 与分节。
- `docker-initdb.d/01-init.sql`：新库不再 `CREATE EXTENSION vector`；旧库保留，不自动 DROP。
- `.env.example` / README / AGENT：移除 Embedding 环境变量表与说明。

### 5.4 迁移与回填

1. 先新增 `material_sections` 表与分节逻辑，旧向量链路暂时保留（代码可运行）。
2. 切换生成链路到 sections，验证旧 review/exam 生成仍可用。
3. 删除向量代码/配置/依赖；启动日志不再有 Embedding 告警。
4. 旧资料懒回填或后台批量回填（建议提供一次性管理任务/脚本，不在请求中做全量扫描）。
5. 至少保留一个发布周期的 `material_chunks` 表作为回滚数据；确认无回滚需求后，再由维护者手动执行：
   ```sql
   DROP TABLE IF EXISTS material_chunks;
   DROP EXTENSION IF EXISTS vector;
   ```
   不把 DROP 放进应用启动流程。

### 5.5 取舍

- **失去：** 语义相似检索、按 query 找跨资料片段的能力。
- **获得：** 更少依赖、更稳定的构建、可解释的知识点来源映射、页面 brief 的确定性上下文。
- **补偿：** 大纲阶段强制 LLM 引用 `section_id`；页面 brief 只带被引用的段落；AI 助手按页面/知识点引用取资料。若后续确实需要检索，可加 PostgreSQL 全文/`pg_trgm` 或独立的轻量关键词索引，不恢复 Embedding。

---

## 6. Pi Agent 方案

### 6.1 可行性依据

- Pi 1.5.0 以 `@earendil-works/pi-coding-agent` 发布（MIT），要求 Node ≥ 22.19；支持：
  - **SDK**：`createAgentSession()`、`session.prompt()`、`session.subscribe()`、`SessionManager.inMemory()`、`DefaultResourceLoader`、自定义 tools；
  - **RPC/JSON 模式**：JSONL 事件流，适合容器/子进程集成；
  - **Skills**：`SKILL.md` + `references/` + `assets/` + `scripts/`，按需加载；
  - **Prompt Templates**：`/build-page` 等可复用命令；
  - **Extensions**：`tool_call`/`tool_result`/`agent_end` 等钩子、`registerTool()`、自定义渲染；
  - **自定义 Provider**：OpenAI 兼容网关（DashScope 等）；
  - **官方 Docker 隔离指南**。
- 因此「容器 + 接口 + 定制 Harness」不需要 fork Pi；用官方 SDK + 扩展即可实现。

### 6.2 运行形态

```text
FastAPI API
  └─ 内部 HTTP（HMAC）
       └─ page-builder 容器（Node 24）
            ├─ HTTP 接口：POST /v1/builds、GET /v1/builds/{id}、/events、/bundle、/cancel
            ├─ 每个 build 一个 Pi SDK Session
            │    ├─ cwd = /tmp/builds/{build_id}（隔离工作区）
            │    ├─ SessionManager.inMemory()
            │    ├─ 只启用 read / write / edit + 自定义工具
            │    ├─ 加载 MockFinal Skill / Prompt Template / Extension
            │    └─ 订阅事件 → 转为构建事件
            └─ 调用 page-validator 做页面自检
```

**为什么用 SDK 而不是 RPC：** Builder 本身就是 Node，SDK 可直接获得事件、工具注册、资源加载与 In-memory session；RPC 更适合非 Node 客户端。将 SDK 封装在 builder 内部，主后端仍通过语言无关 HTTP 接口通信，保留将来替换为 RPC/远程沙箱的空间。

### 6.3 Harness 定制（Pi 特化方向）

> 需求中的「Expand」按 Pi 的正式术语理解为 **Extensions（扩展）**；它负责运行时钩子、自定义工具与权限约束，Skill/Prompt Template 负责“怎么做页面”，Template/Scaffold 负责“从什么骨架开始”。

建议目录：

```text
builder/
├─ package.json                 # 锁定 @earendil-works/pi-coding-agent@1.5.0
├─ src/
│  ├─ server.ts                 # 内部 HTTP + HMAC + 任务队列
│  ├─ session.ts                # Pi SDK 会话、事件映射、超时
│  ├─ validator-client.ts       # 调用 page-validator
│  └─ bundle.ts                 # 文件收集、大小/路径校验、打包
├─ pi-harness/
│  ├─ agent/
│  │  ├─ settings.json          # 工具白名单、默认模型、无 bash
│  │  ├─ prompts/build-page.md  # /build-page 提示词模板
│  │  ├─ templates/page-base/   # 页面脚手架：manifest/html/css/js 空壳 + 注释
│  │  ├─ skills/mockfinal-page-builder/
│  │  │  ├─ SKILL.md
│  │  │  ├─ references/
│  │  │  │  ├─ page-contract.md      # bundle/manifest/runtime API
│  │  │  │  ├─ design-language.md    # 单色纸感、布局、字号、动效
│  │  │  │  ├─ layouts.md            # 12 种页面布局范式
│  │  │  │  ├─ animation-recipes.md  # 二分、矩阵、时间线等配方
│  │  │  │  └─ validation.md         # 校验规则与常见失败
│  │  │  ├─ assets/
│  │  │  │  ├─ runtime.js            # 与前端共享版本
│  │  │  │  ├─ base.css
│  │  │  │  └─ example-binary-search.html
│  │  │  └─ scripts/
│  │  │     └─ check-contract.mjs    # 轻量静态检查（与 Validator 同规则）
│  │  └─ extensions/mockfinal-guard/
│  │     ├─ package.json
│  │     └─ index.ts
│  └─ models.json / provider.ts      # OpenAI 兼容网关配置
```

**Prompt Template `/build-page`** 的工作流（写进模板，不靠模型即兴发挥）：

1. 强制加载页面构建技能：优先由 Builder 发送 `/skill:mockfinal-page-builder`，或在模板首段明确要求 `read <harness>/skills/mockfinal-page-builder/SKILL.md` 并遵循；不能假设模型会自动加载 Skill。
2. 读取 `briefs/{page_id}.json` 与 `materials/` 中的来源段落。
3. 先写 `manifest.json`（标题、知识点、交互声明、来源引用、冒烟选择器）。
4. 写 `page.html`（body 片段，不含 `<script>`/`<style>`/外链）。
5. 写 `page.css`（只使用运行时 CSS 变量与允许的属性）。
6. 写 `page.js`（`MockFinal` API；无网络、无 eval、无父页面访问）。
7. 调用 `check_page`；根据返回问题修复；至少调用一次并在通过后结束。
8. 不输出 Markdown 说明，只写文件。

**Skill 必须覆盖：**

- 页面骨架与文件契约；
- 设计语言与 token；
- 单屏布局、字号、留白、密度上限；
- 动画/交互配方（含 reduced-motion 分支）；
- 内容来源引用规则；
- 常见校验失败与修复示例；
- 两个以上完整黄金示例（可复制、可对照）。

**Extension `mockfinal-guard`：**

- `before_agent_start`：追加页面契约、禁止事项、必须调用 `check_page` 的系统提示；
- `tool_call`：
  - 只允许 `read` / `write` / `edit` / `check_page` / `report_progress`；
  - 拦截 `bash` 及所有未注册工具；
  - `write`/`edit` 路径必须解析后位于 build cwd；
  - 禁止符号链接、路径穿越、超大文件、非允许扩展名；
  - `read` 只允许 build cwd 与只读 harness 资源目录；
- `registerTool("check_page")`：调用 Validator 的静态/浏览器检查，返回结构化问题；可在会话中反复调用；
- `registerTool("report_progress")`：向 Builder 发送结构化阶段（可选，事件主要从 Pi 事件流映射）；
- `agent_end`：记录最终文件清单与校验摘要，供 Builder 决定是否需要修复；
- 错误处理：扩展异常不得吞掉；记录到构建事件，Builder 统一失败。

### 6.4 SDK 会话配置

```ts
const { session } = await createAgentSession({
  cwd: buildDir,
  sessionManager: SessionManager.inMemory(),
  settingsManager: /* in-memory */,
  resourceLoader: /* DefaultResourceLoader，加载 harness 资源 */,
  tools: ["read", "write", "edit", "check_page", "report_progress"], // 不含 bash
});
```

要点：

- `cwd` 每页独立，`/tmp/builds/{build_id}`，构建结束后清理；
- 使用 `DefaultResourceLoader` **显式加载只读 harness 路径**（Skill/Template/Extension/示例），不依赖项目 `/trust`，也不读取宿主 `~/.pi/agent` 的个人配置；具体字段以锁定的 SDK 类型声明为准，Builder 内做一层薄适配；
- `PI_CODING_AGENT_DIR` 指向镜像内的只读 harness 目录；模型凭据只通过环境变量注入；
- `SessionManager.inMemory()` 不落磁盘会话，避免跨用户残留；
- `session.subscribe()` 在 `prompt()` 前注册，映射 `message_update` 的文本增量、`tool_execution_*`、`agent_settled`；
- 只展示可见文本增量与工具摘要；不展示 `thinking_*`；不展示原始命令（无 bash）；
- 每页设置硬超时（默认 8 分钟）与会话级 token/文件大小预算；
- 修复轮次在同一会话中 `prompt()` 继续，或新会话带上次文件 + 报告；最多 2 轮；超过由 Builder 返回失败。

### 6.5 模型与 Provider

- 使用 Pi 的自定义 Provider / `models.json` 指向现有 OpenAI 兼容网关。
- 建议单独配置 `PAGE_BUILDER_MODEL`（优先选择工具调用稳定、长上下文、代码能力强的模型；例如可用的 Qwen Coder 系列；实际以环境为准）。
- 启动时做一次「工具调用 + 结构化输出」健康探测；探测失败则 Builder 启动失败，主 API 在健康检查中标记 `page_builder: unavailable`。
- Pi 的模型上下文预算：页面 brief + skill 参考 + 代码迭代应控制在 64k–128k；超出时压缩/减少 source pack，不静默截断。
- 不把主 LLM 的 API Key 下发前端；Builder 与主 API 各自持有所需密钥；Builder 不持有 OSS/DB/JWT 密钥。

### 6.6 容器与隔离

Builder 容器：

- 非 root 用户；`read_only: true`；`/tmp` tmpfs；`/tmp/builds` 独立 tmpfs；
- `cap_drop: [ALL]`；`security_opt: [no-new-privileges:true]`；CPU/内存/PID 限制；
- 不挂载 Docker socket、不挂载宿主目录、不挂载 `backend/data`；
- 仅暴露内部端口（compose 不映射宿主端口）；
- 网络：内部网络供 API/Validator 通信；另接 egress 网络用于访问 LLM 网关；生产建议加 HTTP 代理白名单；
- 页面代码**不在 Builder 中执行**：Pi 只写文件，`check_page` 由 Validator 执行；因此即使生成恶意代码，也不会在 Builder 内落地执行。

Validator 容器：

- Playwright + Chromium 官方镜像/自建镜像；非 root；无业务密钥；仅内部网络；
- 页面加载时拦截所有非 `data:`/`blob:` 请求；禁止外网；
- 每次校验使用新的 browser context；超时、内存/CPU 限制；
- 接收 bundle JSON，返回报告 + 截图；不持久化用户资料。

主 API：

- 不把 Builder/Validator 暴露公网；使用共享 token + HMAC + 时间戳；
- Builder/Validator 不可用时 Deck 构建返回 503/中文提示；不降级为「跳过校验」。

### 6.7 构建事件与用户可见输出

| Pi 事件 | 转换后的构建事件 | 用户可见 |
| --- | --- | --- |
| `agent_start` / `turn_start` | `page_started` | 「开始构建第 N 页」 |
| `tool_execution_start` (write/edit) | `page_writing` | 「正在编写页面结构与样式」 |
| `tool_execution_start` (check_page) | `page_checking` | 「正在自检布局与交互」 |
| `message_update` text delta | `agent_text` | 构建控制台的可见输出（截断/限流） |
| `tool_execution_end` (isError) | `page_check_issue` | 校验问题摘要 |
| `agent_settled` | `page_agent_done` | 「生成完成，等待最终校验」 |
| Validator report | `page_validated` / `page_failed` | 「已通过」/「发现 N 个问题」 |
| error/retry | `page_retry` | 「第 1/2 轮修复」 |

- 只存储用户可见事件与必要诊断；不存储隐藏推理。
- 单事件文本上限 4KB；每页事件总量上限 200 条；超出折叠。
- 事件落 `deck_build_events`，前端按 `after_id` 增量获取；断线重连不丢进度。

### 6.8 PoC 门禁（Phase 2 必须通过）

用 3 个页面 brief 构建：

1. **算法动画**：二分查找区间收缩（要求可点击/拖动、步进、区间高亮）。
2. **公式推导**：矩阵变换/线性代数（要求分步推导、图示、KaTeX）。
3. **叙事/时间线**：历史事件或概念演进（要求逐步揭示、时间线交互）。

评估：

- 首轮校验通过率、修复 1 轮后通过率；
- 1280×720/1440×900/1920×1080 零滚动；
- 交互冒烟动作是否可执行、状态是否变化；
- 控制台错误、外部请求、静态违规数量；
- 构建耗时与 token 使用；
- 人工视觉评审（是否像「动态 PPT」而非「网页作业」）。

**通过门槛：**

- 首轮 ≥ 2/3，修复 1 轮后 3/3；
- 零滚动 3/3；
- 交互冒烟 3/3；
- 外部请求/静态安全违规 0；
- 单页 p90 ≤ 6 分钟（本地模型网关条件下可放宽，但需记录）。

未通过则启动 Plan B，不进入 Phase 3 全量开发。

### 6.9 Plan B（门禁失败时）

- 用受控组件 DSL（`manifest` 声明 `layout` + 预置组件参数）替代自由 HTML/CSS/JS；
- 保留「自定义 CSS/JS 插槽」作为受限逃生口，但只允许经过审核的片段；
- 页面质量更稳定，但定制能力下降；需重新评估是否满足「二分动画」等需求；
- 决策记录在 `Plan.md` 的 ADR 附录，不在代码中夹带未完成的双实现。

---

## 7. 页面契约与运行时

### 7.1 Bundle 契约

Builder 交付一个 JSON bundle（单文件、无目录、无外部资源）：

```json
{
  "schema_version": "1.0",
  "runtime_version": "1.0.0",
  "manifest": {},
  "html": "<div class=\"mp-page\">…</div>",
  "css": ".mp-page { … }",
  "js": "const root = document.querySelector('.mp-page'); …"
}
```

约束：

- `html` 只能是 body 片段；不得包含 `<html>/<head>/<body>/<script>/<style>/<link>/<base>/<iframe>/<object>/<embed>`。
- `css` 不得使用 `@import`、外链 `url(http…)`、外部字体；图片/图标用内联 SVG 或 data URI。
- `js` 不得使用 `fetch/XMLHttpRequest/WebSocket/EventSource`、`eval/new Function`、`document.cookie/localStorage/sessionStorage`、`window.parent/top/opener`（除 `MockFinal` runtime 封装）。
- 所有资源内联；单文件总大小 ≤ 2MB（可配置）。
- 运行时脚本由宿主注入，不包含在 bundle 中；bundle 只依赖 `window.MockFinal` API。

### 7.2 Manifest

```json
{
  "schema_version": "1.0",
  "page_id": "page_003",
  "title": "二分查找：每次排除一半",
  "subtitle": "把搜索区间折半，直到命中或为空",
  "knowledge_point_ids": ["kp_012"],
  "importance": "core",
  "estimated_minutes": 6,
  "layout": "focus",
  "interactions": [
    {
      "id": "bisect-demo",
      "type": "simulation",
      "label": "拖动目标值，观察区间收缩",
      "smoke": {
        "action": "click",
        "selector": "[data-mp-action='step']",
        "expect": "[data-mp-state='shrunk']"
      }
    }
  ],
  "source_refs": [
    { "material_id": 3, "section_id": 42, "quote": "二分查找每次将搜索区间缩小一半…" }
  ],
  "assistant": {
    "summary": "本页讲解二分查找的区间不变量与复杂度。",
    "key_facts": ["循环不变量", "O(log n)", "边界条件"],
    "suggested_questions": ["为什么 mid 要向下取整？", "什么时候会死循环？"]
  },
  "a11y": { "reduced_motion": true }
}
```

- `interactions[].smoke` 是必填的自动冒烟步骤；非交互页可声明 `type: "none"`，但 Non-summary 页面应至少有一个交互。
- `source_refs` 来自大纲阶段，后端解析为实际段落；页面不得编造引用。
- `layout` 只是元数据（供总览/生成参考），不限制自由布局。

### 7.3 Runtime API

宿主 shell 注入 `runtime.js`，页面可使用：

```js
MockFinal.ready({ title })                 // 页面可交互
MockFinal.emit(type, payload)              // 交互/进度/完成事件
MockFinal.next() / MockFinal.prev()        // 请求翻页（可选）
MockFinal.requestAssistant(quote?)         // 请求打开侧栏
MockFinal.getTheme()                       // { mode, tokens, reducedMotion }
MockFinal.onHostMessage(fn)                // theme / pause / resume / quote
```

运行时负责：

- 选区监听：`selectionchange` → `{ text, rect, blockText }` → `postMessage` 给宿主；
- 错误捕获：`window.onerror` / `unhandledrejection` → 宿主 + Validator；
- 尺寸上报：ResizeObserver → 宿主（页面可用 `100dvh`/容器查询）；
- 键盘：仅在页面内交互需要时注册，翻页快捷键由宿主处理；
- 降低动效：根据 `prefers-reduced-motion` 与宿主消息设置 `data-mp-reduced-motion`；
- 禁止访问父页面/网络：runtime 自身也不提供这些能力。

### 7.4 Shell 与沙箱

宿主组装：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline';
    style-src 'unsafe-inline';
    img-src data:;
    font-src data:;
    media-src data:;
    connect-src 'none';
    frame-src 'none';
    object-src 'none';
    base-uri 'none';
    form-action 'none';
  ">
  <style>/* reset + theme tokens + runtime base */</style>
  <style>/* page.css */</style>
</head>
<body>
  <div id="mp-root">/* page.html */</div>
  <script>/* runtime.js */</script>
  <script>/* page.js */</script>
</body>
</html>
```

- iframe：`sandbox="allow-scripts"`（**不加** `allow-same-origin`）、`referrerpolicy="no-referrer"`、无 `allow` 权限。
- 使用 `srcdoc` 注入；不通过 URL 加载页面，避免鉴权与缓存泄露；页面不能在沙箱外发请求。
- **Validator 与前端复用同一份 `pageShell` 实现/构建产物**（Node 与前端共享 runtime 源、固定版本号），避免“校验时通过、真实渲染时漂移”。
- 组装时转义 `</script`、`</style`，防止生成内容提前闭合标签；Validator 也检查这类序列。
- 页面不能读取父页面 DOM、cookie、localStorage；宿主通过 `postMessage` 通信，并校验 `event.source === iframe.contentWindow` + 随机 channel token。
- 页面加载超时（默认 10s）显示错误卡片，可重试；iframe 卡死时可销毁重建。

### 7.5 零滚动策略

- 页面根元素：`height: 100dvh; overflow: hidden;`，内部使用 `grid-template-rows: auto 1fr auto`。
- 字号/间距：`clamp()` + `minmax()`；避免固定大 px。
- 内容预算（Skill 约束）：每页 1 个核心观点、3–5 个内容块、1 个主交互；正文建议 ≤ 250 中文字符（不含图注/公式）。
- 校验器在 3 个视口测量 `scrollWidth/scrollHeight`；任何超出即失败；同时检查所有 `overflow: auto/scroll` 的可见元素。
- 对复杂知识点，优先拆页（最多 3 页），而不是压缩字号。

### 7.6 Validator 规则

静态检查：

- bundle JSON schema、字段长度、总大小、文件编码；
- HTML 禁止标签/属性、内联事件白名单（只允许 `data-mp-*`）、`javascript:` URL；
- JS 禁止 API（网络、存储、eval、父窗口、动态脚本注入）；
- CSS 禁止 `@import`、外部 `url()`、`position: fixed` 遮挡导航（可选警告）；
- manifest 必填项、引用 ID 存在、冒烟选择器语法。

浏览器检查（Playwright）：

- 加载 shell + bundle，等待 `MockFinal.ready` 或超时；
- 视口：1280×720、1440×900、1920×1080（桌面验收）；1024×768（缩放提示）；
- 零滚动：`scrollWidth <= clientWidth + 1`、`scrollHeight <= clientHeight + 1`；无内部滚动容器；
- 控制台：无 error、无 unhandled rejection；
- 网络：拦截并拒绝所有非本地请求；出现即失败；
- 交互：执行 `manifest.interactions[].smoke`（click/input/step），验证 `expect` 选择器/状态；
- 可访问性：标题层级、焦点可见、图标按钮 `aria-label`、reduced-motion 下动画降级；
- 截图：每个视口 1 张（供工作台缩略图与人工复核）。

报告：

```json
{
  "status": "passed|warning|failed",
  "issues": [
    { "severity": "error", "code": "ZERO_SCROLL_OVERFLOW", "message": "…", "selector": "…", "viewport": "1280x720" }
  ],
  "screenshots": ["…"],
  "duration_ms": 12345
}
```

- `error` 阻止放行；有限数量的 `warning` 可放行但记录。
- 最终门禁由后端调用 Validator；Builder 的自检报告仅供参考。

### 7.7 修复闭环

```text
Pi 写完 → check_page（Validator 静态+浏览器）
  ├─ passed → agent_settled → Builder 最终校验 → 交付
  ├─ failed → 修复 prompt（问题列表 + 相关文件）→ 最多 2 轮
  └─ 仍失败 → 返回 failed + 报告；后端可重试整页 1 次
```

修复 prompt 只带结构化问题与必要上下文，不把整份资料重新灌入；优先修布局/交互/违规，不重写整页。

### 7.8 版本化

- `runtime_version`、`schema_version`、`harness_version` 三者独立版本号。
- 页面 bundle 带 `runtime_version`；前端不支持时拒绝渲染并提示更新。
- Harness 升级必须跑黄金用例回归；Pi 版本锁定，升级单独任务。
- 页面重做生成新 `version`；成功后再切换 `deck_pages.current_version`，旧版本保留一个周期用于回滚。

---

## 8. 后端设计

### 8.1 数据模型

新增表（均为 `create_all` 自动创建；不改既有表结构）：

**`material_sections`**：见 §5.1。

**`review_decks`**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int PK | |
| `workspace_id` | FK cascade | 归属 |
| `title` | varchar(255) | 默认「{工作区名} · 复习页」 |
| `status` | varchar(16) | `draft/planning/building/partial/ready/failed/canceled` |
| `style` | jsonb | 预设、内容偏好、自定义提示词、密度 |
| `outline` | jsonb | 章节/知识点快照（可查询冗余） |
| `source_signature` | varchar(64) | 资料分节内容哈希，检测资料变更 |
| `last_page_id` | int nullable | 继续上次 |
| `completed_page_ids` | jsonb | 已读页面 ID |
| `created_at / updated_at` | timestamptz | |

**`knowledge_points`**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int PK | |
| `deck_id` | FK cascade | |
| `parent_id` | FK self nullable | 章节/子知识点 |
| `ordinal` | int | |
| `title` | varchar(255) | |
| `summary` | text | |
| `importance` | varchar(8) | `core/normal/minor` |
| `difficulty` | varchar(8) | `easy/medium/hard` |
| `objectives` | jsonb | 学习目标 |
| `key_points` | jsonb | 要点 |
| `formulas` | jsonb | 公式（KaTeX） |
| `misconceptions` | jsonb | 易错点 |
| `source_refs` | jsonb | `[{material_id, section_id}]` |
| `interaction_idea` | text | 给 Page Builder 的视觉化建议 |
| `created_at` | timestamptz | |

**`deck_pages`**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int PK | |
| `deck_id` | FK cascade | |
| `knowledge_point_ids` | jsonb | 可覆盖多个非重要知识点 |
| `primary_knowledge_point_id` | int nullable | |
| `ordinal` | int | 阅读顺序 |
| `title` | varchar(255) | |
| `kind` | varchar(16) | `concept/interactive/summary/practice` |
| `status` | varchar(16) | `planned/building/validating/ready/failed/canceled` |
| `current_version` | int | |
| `bundle_key` | varchar(512) nullable | 存储 key |
| `thumbnail_key` | varchar(512) nullable | |
| `manifest` | jsonb | 页面元数据快照 |
| `validation` | jsonb | 最近一次报告摘要 |
| `build_attempts` | int | |
| `builder_build_id` | varchar(64) | |
| `created_at / updated_at` | timestamptz | |

**`deck_build_jobs`**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int PK | |
| `deck_id` | FK cascade | |
| `workspace_id` | FK cascade | |
| `status` | varchar(16) | `pending/planning/building/validating/done/partial/failed/canceled` |
| `stage` | varchar(255) | 中文阶段文案 |
| `progress` | int | 0–100，真实页级 |
| `total_pages / ready_pages / failed_pages` | int | |
| `error` | text nullable | |
| `cancel_requested` | bool | |
| `created_at / started_at / finished_at` | timestamptz | |

部分唯一索引：同一 Deck 同时最多一个活跃 job。

**`deck_build_events`**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | bigint PK | 前端 `after_id` 游标 |
| `job_id` | FK cascade | |
| `page_id` | int nullable | |
| `type` | varchar(32) | `stage/text/tool/page_ready/validation/error/retry` |
| `payload` | jsonb | |
| `created_at` | timestamptz | |

索引 `(job_id, id)`；按 job 级联删除；保留策略建议 30 天或随 Deck 删除。

**`page_chat_messages`**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int PK | |
| `user_id / deck_id / page_id` | FK | 归属 |
| `role` | varchar(16) | `user/assistant` |
| `status` | varchar(16) | `done/streaming/failed`（用户消息恒为 done） |
| `content` | text | |
| `quote` | text nullable | 选中文本 |
| `context_refs` | jsonb | 引用资料段落 |
| `created_at` | timestamptz | |

### 8.2 状态机

```text
Deck: draft → planning → building → ready
                         ├→ partial（部分页失败）
                         └→ failed（规划/全部页失败）
       任一阶段可 canceled（用户取消）
Page: planned → building → validating → ready
                    ├→ building（修复轮次）
                    └→ failed（重试耗尽）
Job:  pending → planning → building → validating → done/partial/failed/canceled
```

规则：

- 同一 Deck 最多一个活跃 job；应用层 409 + DB 部分唯一索引兜底。
- 页面失败不阻断其他页；Deck 最终 `partial`，用户可重试失败页。
- 取消只由独立取消接口触发；客户端断开不取消。
- 服务重启：遗留 `pending/planning/building/validating` 置 `failed`（中文原因）；Builder 侧任务由 TTL 清理。

### 8.3 API 契约（新）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workspaces/{id}/decks` | Deck 列表（按更新时间倒序） |
| POST | `/api/workspaces/{id}/decks` | 创建 Deck（draft），body：`title?/style` |
| GET | `/api/decks/{id}` | Deck 详情：状态、style、outline、pages 摘要、进度 |
| PATCH | `/api/decks/{id}` | 更新标题/style；style 变更只影响后续构建/单页重做，不自动重排已有页面 |
| DELETE | `/api/decks/{id}` | 204，级联页面/事件/聊天与存储对象 |
| POST | `/api/decks/{id}/build` | 首次构建 → `{job_id}`；无已就绪资料 400；活跃任务 409；body 可选 `rebuild_all=true`（复用大纲重建全部页）或 `replan=true`（仅无页面/全部失败时） |
| POST | `/api/decks/{id}/cancel` | 取消活跃 job |
| GET | `/api/deck-jobs/{id}` | job 状态/阶段/进度/错误 |
| GET | `/api/deck-jobs/{id}/events?after_id=` | 增量事件（轮询；可选 SSE 包装） |
| GET | `/api/decks/{id}/pages/{page_id}` | 页面元数据/状态/版本 |
| GET | `/api/decks/{id}/pages/{page_id}/bundle` | 已就绪 bundle JSON（含 manifest/html/css/js） |
| GET | `/api/decks/{id}/pages/{page_id}/thumbnail` | 缩略图（可选） |
| POST | `/api/decks/{id}/pages/{page_id}/rebuild` | 带反馈重建单页 → `{job_id}` |
| PATCH | `/api/decks/{id}/progress` | `{last_page_id, completed_page_ids}` |
| GET | `/api/decks/{id}/pages/{page_id}/messages` | 聊天历史 |
| POST | `/api/decks/{id}/pages/{page_id}/messages` | SSE 流式问答 |

约定沿用现有：创建 200、删除 204、未认证 401、无权 404、冲突 409、业务错误 `{"detail": "中文"}`。Builder/Validator 不可用返回 503/504，文案可行动（例如「页面构建服务暂不可用，请稍后重试」）。

### 8.4 编排流程

1. **创建/校验**：资料已就绪；LLM/Builder/Validator 配置齐全；Deck 无活跃 job。
2. **规划**：
   - 取 `material_sections`，做资料级摘要（可复用现有 map-reduce 思路）；
   - 结构化输出章节/知识点 JSON（Pydantic 校验 + 最多 2 次修复）；
   - 生成 `knowledge_points`、页面计划（重要度 × 内容量 → 1–3 页，总页数上限）；
   - 解析 `source_refs`，缺失/无效时用标题/关键词回退并标注置信度。
3. **构建**：
   - 每页组装 `PageBrief`（知识点、来源段落、风格、用户偏好、交互建议、约束）；
   - 调 Builder `POST /v1/builds`；轮询 Builder 状态与事件，写入 `deck_build_events`；
   - 收到 bundle 后调 Validator 最终门禁；失败则 Builder 修复或标记页面失败；
   - 成功：保存 bundle/缩略图，页面 `ready`，更新进度，写事件；继续下一页。
4. **收尾**：全部页面结束 → Deck `ready/partial`；job 终态；清理 Builder 临时目录。
5. **单页重建**：复用页面 brief + 用户反馈，生成新 `version`，成功后再切换 current。

并发：页面构建默认并发 2（可配）；资料摘要并发复用现有 Semaphore(4)。总 job 超时 30 分钟（可配）。

构建模式：

- **首次构建**：无页面 → 规划 + 逐页构建。
- **整册重建**（`rebuild_all=true`）：复用现有大纲与页面计划，逐页重建新版本；旧版本在对应新页 ready 前保持可读。
- **重新规划**：仅在没有页面或整册构建全部失败时允许；会替换大纲/页面，需确认；构建中不可用；已有页面时建议新建 Deck。
- **单页重建**：见 §8.4 第 5 条，不触碰其他页。

### 8.5 大纲与 Page Brief

**大纲规划 prompt 要点：**

- 只依据给定资料，不编造；公式保留 KaTeX；
- 输出严格 JSON：`chapters[] / knowledge_points[] / source_section_ids[] / importance / interaction_idea / page_count`；
- 覆盖资料主要考点；非重要知识点可合并；
- 每个知识点至少 1 个 `section_id`；无法引用则标记 `unverified`，不得伪造；
- 章节数 3–6，知识点 6–16，页面总数 6–16（按密度）；
- 交互建议要具体（例如「用区间收缩动画演示二分」），不要泛泛写「加动画」。

**Page Brief：**

```json
{
  "page_id": "page_003",
  "deck_title": "数据结构 · 复习页",
  "knowledge_point": { "title": "…", "summary": "…", "objectives": [], "key_points": [], "formulas": [], "misconceptions": [] },
  "source_excerpts": [
    { "section_id": 42, "heading": "…", "text": "…（≤ 6000 字）" }
  ],
  "style": { "preset": "blueprint", "content": ["formula", "example"], "custom_prompt": "…", "density": "standard" },
  "interaction_idea": "…",
  "constraints": {
    "viewport": ["1280x720", "1440x900", "1920x1080"],
    "no_scroll": true,
    "no_network": true,
    "max_bundle_bytes": 2097152,
    "runtime_version": "1.0.0",
    "language": "zh-CN"
  },
  "previous_page": { "title": "…", "summary": "…" },
  "next_page": { "title": "…", "summary": "…" }
}
```

- 用户自定义提示词只作为「偏好」字段，不得覆盖 constraints。
- 来源段落总量超预算时，优先保留与 objectives/key_points 最相关的段落，并记录被截断信息。

### 8.6 构建/校验失败处理

| 失败点 | 处理 |
| --- | --- |
| Builder 不可用/超时 | 页面 `failed`，job 记录中文原因；可重试单页；Deck 可 `partial` |
| 规划 LLM 输出非法 | 自动修复 2 次；仍失败 → job `failed`，保留原始错误摘要 |
| 来源引用无效 | 回退标题/关键词匹配；标记 `unverified`；大纲页提示 |
| Validator 失败 | Builder 修复 2 轮；仍失败返回报告；后端重试 1 次；仍失败页面 `failed` |
| Validator 不可用 | **fail-closed**：页面不 ready；job 记录「校验服务不可用」 |
| 单页超时/上下文超限 | 页面失败，建议拆分知识点或重做；不阻塞其他页 |
| 用户取消 | 调 Builder cancel；页面 `canceled`；已 ready 页面保留 |
| 服务重启 | 活跃 job/pages 置 failed；已 ready 页面保留；用户可重建 |

错误文案必须是中文、可行动，不暴露 prompt/密钥/内部堆栈。

### 8.7 长任务与重连

- 遵守 RULE.md §3.7：DB 是唯一事实来源；构建在 `tasks.spawn()` 后台运行；HTTP/SSE 断开不取消。
- 前端以 `job_id` 恢复：先取 job 快照与页面列表，再按 `after_id` 拉事件。
- 事件接口只搬运；允许 0 订阅者；最终结果先落库再发完成事件。
- 不引入 Redis/消息队列；单 API worker 下进程内事件足够。多 worker 时需改为 DB `LISTEN/NOTIFY` 或 Redis（文档注明）。

### 8.8 配置草案

新增（全部经 `Settings`）：

```text
PAGE_BUILDER_URL=http://page-builder:9100
PAGE_BUILDER_TOKEN=change-me
# 示例值；按实际网关可用、工具调用稳定的 Coder 模型填写
PAGE_BUILDER_MODEL=qwen3-coder-plus
PAGE_BUILDER_TIMEOUT_SECONDS=480
PAGE_BUILDER_CONCURRENCY=2
PAGE_VALIDATOR_URL=http://page-validator:9200
PAGE_VALIDATOR_TOKEN=change-me
DECK_MAX_PAGES=16
DECK_MIN_PAGES=6
DECK_PAGE_MAX_ATTEMPTS=2
DECK_JOB_TIMEOUT_SECONDS=1800
DECK_MAX_MATERIAL_CHARS=200000
DECK_MAX_BUNDLE_BYTES=2097152
```

移除：所有 `EMBED_*`。保留 `LLM_*` 用于大纲/旧版生成/AI 助手。Builder 容器单独持有 `LLM_BASE_URL/LLM_API_KEY/PAGE_BUILDER_MODEL/PAGE_VALIDATOR_*`。

### 8.9 清理与级联

- 删除 Deck：DB 级联页面/知识点/job/events/chat；best-effort 删除 bundle/thumbnail 存储对象。
- 删除工作区：在现有级联基础上增加 decks 相关表；先取消活跃 job（best-effort），再删。
- 删除资料：section 级联删除；已有页面保留（来源引用可能失效），Deck 显示「资料已变更」；重建时使用剩余资料。
- 删除页面：删除 bundle/thumbnail；聊天级联。

---

## 9. 前端设计

### 9.1 路由

新增（全部在登录守卫内）：

```text
/workspace/:id/decks/:deckId                  Deck 总览（全屏布局）
/workspace/:id/decks/:deckId/build            构建工作台
/workspace/:id/decks/:deckId/pages/:pageId    阅读器
```

- 使用独立 `DeckLayout.vue`（不套 `AppLayout` 的侧栏），保证全屏空间。
- `meta.title` 动态设置；返回工作区。
- 路由守卫继续使用 vue-router 5 返回值写法。

### 9.2 总览页 / 工作台

组件建议：

```text
views/DeckOverviewView.vue
components/deck/DeckRoadmap.vue       # SVG 连线 + 节点
components/deck/DeckWorkbench.vue     # 继续/进度/页面清单/失败重试
components/deck/DeckPageCard.vue
components/deck/DeckStyleBadge.vue
```

- 布局：顶部标题/操作，中部路线图，右侧/底部工作台；桌面一屏；移动端纵向滚动。
- 路线图：章节分组；节点状态；核心节点更大；连线用 `border-strong`/`ink` 单色；不使用彩色状态。
- 工作台：完成度环/条、继续上次、页面列表（状态/时长/重要度）、资料覆盖、风格摘要、重建入口。
- 构建中：路线图节点实时更新；点击 building 页显示占位；ready 页可进入。
- 空态：无页面时提示「从构建工作台开始」；失败态给出重试。

### 9.3 阅读器

组件建议：

```text
views/DeckReaderView.vue
components/deck/DeckStage.vue          # 全屏舞台 + iframe 生命周期
components/deck/PageFrame.vue          # srcdoc 组装 + postMessage 桥
components/deck/PageProgress.vue       # 页码/进度/键盘提示
components/deck/SelectionAction.vue    # 选中文本「问 AI」
components/deck/DeckAssistantDrawer.vue
lib/pageShell.ts                       # 组装 shell、转义、CSP
```

- 获取 bundle → `buildShell(bundle)` → iframe `srcdoc`；页面加载完成后淡入。
- 预加载相邻页 bundle；只保留 current ±1 的 iframe，避免内存膨胀。
- 翻页：键盘/按钮/页码；过渡 180–240ms；reduced-motion 直接切换。
- 全屏：`requestFullscreen()` 在容器上；Esc 退出；移动端隐藏全屏入口。
- 页面错误：加载超时/控制台错误/`MockFinal` 未 ready → 错误卡片 + 重试；不允许白屏。
- 页面完成：runtime `emit('complete')` 或阅读到末尾 → 更新 `completed_page_ids`（防抖 PATCH）。
- 选中：runtime 发选区 → 显示浮动「问 AI」→ 打开抽屉并带 quote。
- 侧栏：overlay 抽屉，宽约 400px；不改变页面 stage 尺寸（避免重排溢出）；关闭恢复焦点。

### 9.4 构建工作台

组件建议：

```text
views/DeckBuildView.vue
components/deck/BuildSetupPanel.vue    # 预设/内容/密度/自定义提示词
components/deck/BuildTimeline.vue
components/deck/BuildConsole.vue       # 可见输出，非终端模拟
components/deck/BuildPageGrid.vue      # 逐页卡片/缩略图
```

- 设置面板在新建 Deck 时展示；启动后折叠为摘要。
- 构建中：阶段时间线 + 真实进度 + 当前页 + 事件流；自动滚动到底部，但用户上滚时暂停自动滚动。
- 事件文案映射为友好中文；保留工具动作摘要，不暴露 prompt/密钥。
- 页面卡片 ready 后可点击进入；failed 显示原因/重试；building 显示骨架/脉冲。
- 取消：确认弹窗说明「已完成页面保留」。
- 离开/刷新：重新进入按 job 恢复；完成时提示前往总览。
- 视觉：保持单色纸感，不使用「黑客终端」绿字/霓虹。

### 9.5 AI 助手

- 抽屉内消息列表：用户消息右对齐/边框，助手消息左对齐/无气泡堆叠；引用块显示选中文本。
- 快捷动作 chips（单色描边）：解释 / 举例 / 记忆 / 考考我 / 关联。
- 流式：逐字追加渲染；结束后完整 Markdown 渲染；错误可重试。
- 引用：回答下方显示「依据：资料名 · 章节」，点击可展开来源摘要（不跳转原文）。
- 历史：进入页面加载最近 N 条；分页加载更早（可选）。
- 输入：支持 Enter 发送、Shift+Enter 换行；发送中禁用重复提交。
- 空态：提示「选中页面中的文字，或直接提问」。

### 9.6 设计语言

- 应用壳与 Deck 共享现有 DESIGN.md 语义 token；不新增裸色值。
- Deck 舞台是「纸面 stage」：`panel` 底、`ink` 正文、`raised` 分区；允许更大的字号与留白。
- 动效：150/200/400ms；只用于解释状态变化；禁止循环装饰；必须实现 reduced-motion。
- 页面内的视觉元素以 SVG/Canvas/CSS 绘制为主，不使用外部图片；需要图标时内联 SVG（lucide 路径可复用，但不加载外部资源）。
- 不在页面内使用 emoji、3D 图标、彩色渐变、Glassmorphism；与 DESIGN.md 反对清单保持一致。
- 若新增 Deck 专属 token/组件规格，在同一任务更新 `DESIGN.md`；大规模视觉扩展走 `design/*` 分支（见 RULE/DESIGN）。

### 9.7 状态与性能

- 前端只做展示状态：构建轮询、iframe 生命周期、抽屉开关、设置表单；业务状态以后端为准。
- 构建事件轮询 1s；页面不可见时降频（`document.visibilityState`）。
- 阅读器预加载相邻页；bundle 缓存在内存/IndexedDB？MVP 内存即可，退出清理。
- 不在前端执行页面代码之外的 AI 生成；不把大纲/页面状态写入 localStorage 作为事实来源。
- 401 走全局处理；404 显示「页面不存在或无权访问」；503/504 显示可行动提示。

### 9.8 可访问性

- 全屏阅读器：Tab 顺序、焦点可见、Esc 关闭、翻页按钮有 `aria-label`。
- iframe `title` 描述当前页；页面加载状态 `aria-live`。
- 页面内交互必须键盘可达；Validator 检查焦点与 aria。
- 状态不能只靠颜色；使用图标/文案/边框。
- 移动端触控目标 ≥ 32px；主操作 ≥ 40px。

---

## 10. AI 助手后端

### 10.1 上下文组装

每次提问包含：

1. 系统提示：中文助教；只依据给定页面/资料；不编造；引用章节；回答简洁；不执行代码。
2. 当前页面：标题、知识点摘要、key_facts、formulas、source_refs。
3. 选中文本（≤ 2000 字）+ 所在块上下文（≤ 3000 字）。
4. 相关来源段落（按 source_refs 取 `material_sections`，总量 ≤ 6000 字）。
5. 最近 10 条对话。
6. 用户问题。

总预算约 12k–16k 字符；超限按优先级裁剪（对话 → 来源 → 块上下文），不裁剪当前问题/选中文本。

### 10.2 流式接口

- `POST /api/decks/{id}/pages/{page_id}/messages`：保存 user 消息，创建 assistant 消息占位，返回 `text/event-stream`：
  - `event: delta` → `{text}`
  - `event: done` → `{message_id, refs}`
  - `event: error` → `{detail}`
- 断线：本次回答取消，assistant 消息标记 `failed` 或删除占位；已发送的 user 消息保留。聊天属于交互式短请求，不纳入长任务语义（与构建任务区分）。
- 限流：进程内按 user 20 次/分钟；文档注明多副本需共享存储。
- 安全：助手输出视为不可信 Markdown；前端 `html:false` + DOMPurify；不输出 HTML/脚本。

### 10.3 引用与拒答

- 回答中引用 `【资料名 · 章节】`；后端返回 `context_refs` 供前端展示。
- 若来源不足，明确回答「当前页面与资料未覆盖该问题」，可建议查看相关页面。
- 不把整份资料/其他用户内容带入上下文；只取当前 Deck/Page 的引用。

---

## 11. 安全威胁模型

### 11.1 生成代码

| 威胁 | 缓解 |
| --- | --- |
| 页面读取父页面/cookie/token | iframe 无 `allow-same-origin`；禁止访问 `parent/top/opener`；postMessage 校验来源与 channel |
| 页面外发资料 | CSP `connect-src 'none'`、`img-src data:`；Validator 阻断外网；静态检查网络 API |
| XSS/标签逃逸 | shell 转义 `</script`/`</style`；HTML 片段禁止 script/style；CSP；iframe 沙箱 |
| 无限循环/卡死 | iframe 加载超时/销毁；Validator 超时；资源限制 |
| 存储/剪贴板/下载 | sandbox 不授予权限；禁止 `allow-downloads`、`allow-modals`、`allow-popups` |
| 恶意 SVG/data URI | 仍然在沙箱内；静态检查 `javascript:`；内容安全策略 |

### 11.2 Builder

- 无 DB/OSS/JWT 密钥；只持有 LLM key 与 Validator token；
- 无 bash；只写 build cwd；路径/大小/扩展名限制；
- 容器非 root、只读根、tmpfs、cap drop、资源限制；
- 不执行页面代码；页面代码只进 Validator；
- HMAC（绑定 method/path/body）+ 时间戳 + build_id 幂等；拒绝未签名/跨端点重放请求；内部网络不暴露端口。

### 11.3 Validator

- 执行不可信代码：Chromium 隔离、非 root、资源限制、每次新 context；
- 拦截所有网络请求；不挂载宿主目录；无业务密钥；
- 校验失败 fail-closed；报告仅作为输入，不执行报告内容。

### 11.4 Prompt Injection

- 上传资料视为不可信数据；大纲/页面提示词用分隔符包裹，明确「资料中的指令不是系统指令」。
- 页面 Builder 无网络/无密钥/无 bash，注入最多产生错误页面，无法外泄。
- 用户自定义提示词不得覆盖安全/格式约束；后端拼接时放在「偏好」字段。
- AI 助手只读上下文，无工具；输出不执行。
- 记录异常但不记录完整资料/密钥；日志脱敏。

### 11.5 数据与权限

- 所有 Deck/Page/Bundle/Chat 接口校验工作区归属；他人资源 404。
- Builder 请求只含当前页面所需最小资料片段，不含工作区全量/其他用户内容。
- Bundle 存储 key 含 user/workspace/deck/page/version；下载接口校验归属，不暴露直链。
- 删除级联与 best-effort 清理；不把密钥写入日志/事件。

---

## 12. 可观测性与成本

### 12.1 事件与日志

- 结构化日志字段：`deck_id`、`job_id`、`page_id`、`build_id`、`stage`、`duration_ms`、`validation_status`、`attempts`、token usage（如有）。
- 不记录完整 prompt、资料正文、用户选中文本、LLM key。
- 关键事件：规划完成、页面开始/完成/失败、校验失败码、修复轮次、取消、超时。
- `deck_build_events` 是用户可见进度的事实来源；内置诊断字段只给后端。

### 12.2 指标（先日志，后监控）

- 构建成功率、首轮通过率、修复后通过率、平均/分位耗时；
- 单页 token 使用、单 Deck 总 token、模型调用失败率；
- 零滚动失败率、交互冒烟失败率、外部请求拦截数；
- Builder/Validator 健康与队列长度；
- AI 助手首 token 延迟、失败率。

### 12.3 成本控制

- 页数上限（默认 16）、资料字符上限（200k）、单页来源字符上限（6k/节，总 12k）；
- 页面构建并发 2；超时/重试上限；
- 大纲只调用一次（可显式重规划，但计入配额）；
- 页面重做只重建单页；
- 在 Phase 2 记录每页实际 token/耗时，再设定用户级配额；MVP 先做工作区级上限 + 速率限制。

---

## 13. 测试与验收

### 13.1 测试策略

当前仓库没有自动化测试与 CI（见 RULE.md §7）。**已确认引入最小测试栈**（2026-11-07 决策，满足 RULE.md §1.5 的维护者确认要求），作为独立 `chore` 提交落地：

- 后端：`pytest` + `httpx.AsyncClient`，覆盖分节、规划 schema、Deck API、归属、状态机、取消、事件回放；
- Builder：Node 测试（Vitest/Node test），覆盖路径守卫、静态检查、shell 转义、bundle 打包、事件映射；
- Validator：Playwright 测试 + 好/坏页面 fixtures（溢出、外链、控制台错误、交互失败）；
- 前端：Vitest 组件测试 + Playwright E2E（登录、创建 Deck、构建 mock、阅读、选区、聊天）；
- 测试栈只覆盖 PageRef 核心链路，不做全仓库格式化或无关重构；测试框架版本与脚本需写入 README/RULE。

### 13.2 Golden Eval（Harness 质量）

固定 10 个页面 brief：

- 二分查找、快速排序、矩阵变换、概率分布、时间线、概念对比、公式推导、错题辨析、流程步骤、总结页；
- 每个 brief 含来源段落与预期交互；
- 每次改 Skill/Prompt/Extension/模型后跑：
  - 首轮/修复通过率；
  - 零滚动；
  - 交互冒烟；
  - 构建时长/token；
  - 人工 1–5 分视觉评分（布局、信息层级、动效克制、内容准确）。

### 13.3 验收矩阵

| 场景 | 验收 |
| --- | --- |
| 新用户上传 3 种格式资料 | 分节成功、无 Embedding、资料就绪 |
| 创建 Deck 并构建 12 页 | 大纲合法、页面逐页 ready、进度真实 |
| 构建中刷新/关闭页面 | 后台继续；重新进入恢复 job/页面 |
| 构建中取消 | 未完成页取消；已 ready 保留；无残留 Builder 任务 |
| 单页构建失败 | Deck partial；其他页可读；失败页可重试 |
| 页面零滚动 | 3 个桌面视口通过；无内部滚动 |
| 页面交互 | 冒烟操作通过；键盘可用；reduced-motion 降级 |
| 页面安全 | 外链/网络/eval/父窗口访问被拦截 |
| 选区问答 | 选中文本带入上下文；流式回答；引用正确 |
| 权限 | 他人 Deck/Page/Bundle/Chat 一律 404 |
| 删除 | Deck/工作区/资料/页面级联与存储清理正确 |
| 迁移 | 旧资料分节回填；旧 Markdown 工件可读 |
| Builder/Validator 宕机 | 503/504 中文提示；页面不误放行 |

### 13.4 验证命令（测试栈落地后）

```bash
# 后端（新增测试后）
pytest

# 前端
cd frontend && pnpm typecheck && pnpm build

# 编排
docker compose up -d --build
curl http://127.0.0.1:8000/api/health

# E2E（新增后）
pnpm exec playwright test
```

> 在测试框架未落地前，不要虚构这些命令已通过；阶段交付必须附实际验证记录。

### 13.5 人工检查

- 深色/浅色、375/768/1280/1440/1920 宽度；
- 全屏进入/退出、键盘翻页、焦点；
- 构建工作台空态/加载/失败/取消；
- 页面加载慢/超时/控制台错误；
- 长标题、长公式、长文件名不撑破布局；
- 动效 reduced-motion；
- 删除确认与不可撤销后果。

---

## 14. Roadmap

### 14.1 阶段总览

| 阶段 | 目标 | 主要交付 | 估算（单人） | 门禁 |
| --- | --- | --- | --- | --- |
| P0 | 决策归档与验证准备 | 决策记录、黄金 brief、契约草案、Pi 版本锁定 | 2–3 天 | 决策已归档 |
| P1 | 去 Embedding | `material_sections`、分节、旧生成改造、依赖/配置清理 | 5–7 天 | 旧链路无向量可用 |
| P2 | Pi Builder PoC | Builder/Validator 容器、Harness v0、3 个黄金页、评估报告 | 7–10 天 | **关键 Gate** |
| P3 | Deck 领域与规划 | 表/API/大纲/页面计划/事件/取消 | 5–6 天 | 规划契约稳定 |
| P4 | 构建集成 | 端到端构建、校验门禁、修复、存储、渐进交付 | 6–8 天 | 12 页 E2E |
| P5 | 阅读器/工作台 | 全屏 Deck、总览路线图、构建工作台、选区桥 | 6–8 天 | 浏览器验收 |
| P6 | AI 助手 | 上下文、SSE、选区、历史、引用 | 4–5 天 | 问答 E2E |
| P7 | 加固与发布 | 安全/成本/可观测性/文档/迁移/回归 | 4–6 天 | DoD |

**合计：约 39–53 人日**（不含评审等待与需求变更）。单人约 9–12 周；双人并行约 6–7 周。关键路径是 P1 → P2 → P4；P3 可在 P2 进行中并行设计契约。P2 的估算偏保守，因为它同时包含容器、Harness、Validator 与安全验证；实际拆分后可缩短。

### 14.2 Gantt（基线，示意）

```mermaid
gantt
    title PageRef 开发路线（2026-11 起，单人估算）
    dateFormat  YYYY-MM-DD
    axisFormat  %m/%d

    section 基础
    P0 决策与验证准备        :p0, 2026-11-10, 3d
    P1 去 Embedding          :p1, after p0, 7d

    section Pi
    P2 Builder PoC 门禁      :crit, p2, after p1, 10d

    section 领域
    P3 Deck 领域与规划       :p3, after p2, 6d
    P4 构建集成              :crit, p4, after p3, 8d

    section 体验
    P5 阅读器与工作台        :p5, after p4, 8d
    P6 AI 助手               :p6, after p5, 5d

    section 收尾
    P7 加固与发布            :p7, after p6, 6d
```

> 日期仅为排期基线；实际以人力与 P2 评估结果为准。P2 失败则暂停后续阶段，进入 Plan B 评估。

### 14.3 阶段任务明细

#### P0 · 决策归档与验证准备（2–3 天）

- [x] 归档 §17 的已确认决策；不再等待决策，按结论执行。
- [x] 按 Q4 结论落地最小测试栈骨架（pytest/Vitest/Playwright）。
- [x] 锁定 `@earendil-works/pi-coding-agent@1.5.0` 与 Node 24；记录升级策略。
- [x] 定义 `PageBundle` / `Manifest` / `Runtime API` v0 草案。
- [x] 准备 3 个黄金 brief 与来源段落（二分、矩阵、时间线）。
- [x] 建立 `builder/`、`validator/` 目录与 compose 草案。
- [x] 输出：决策记录、契约草案、PoC 验收表。

#### P1 · 去 Embedding（4–5 天）

- [x] `material_sections` 模型与建表。
- [x] 解析器增强标题元数据；分节服务；懒回填。
- [x] 生成链路改 sections；删除 RAG 补充。
- [x] 删除向量代码/配置/依赖/向量清理调用。
- [x] 启动逻辑与健康检查适配。
- [x] README / AGENT / `.env.example` / compose / init SQL 同步。
- [x] 验证：5 种格式上传、分节、旧 review/exam 生成、无 `EMBED_*` 引用。
- [x] 输出：可运行的「无向量」基线。

#### P2 · Pi Builder PoC（7–10 天）【Critical Gate】

- [x] Builder 容器 + 内部 HTTP + HMAC + 任务模型。
- [x] Pi SDK 会话（in-memory、无 bash、路径守卫）。
- [x] Harness v0：Skill、Prompt Template、Extension、黄金示例、runtime 文档。
- [x] Validator 容器：静态 + Playwright 零滚动/交互/网络/控制台。
- [x] 事件流映射；构建日志。
- [x] 构建 3 个黄金页；记录通过率/耗时/token（真实 Pi 3/3；p90 157.2s；输入 65,153 / 输出 56,390 tokens；成本 ¥0.14）。
- [x] 红队：外链、eval、父窗口、超大 bundle、路径穿越（16/16 拦截）。
- [x] 输出：评估报告 + Gate 结论（**Go**；工程门槛通过，人工视觉签收待维护者复核截图）。

#### P3 · Deck 领域与规划（5–6 天）

- [x] 表：`review_decks`、`knowledge_points`、`deck_pages`、`deck_build_jobs`、`deck_build_events`、`page_chat_messages`。
- [x] Pydantic schemas、类型、API 骨架、归属校验。
- [x] 大纲规划服务：结构化 JSON、校验、修复、source_refs。
- [x] 页面计划：重要度/密度 → 页数；Page Brief 组装。
- [x] 事件写入与 `after_id` 查询；取消语义。
- [x] 旧资料 source_signature / 资料变更提示。
- [x] 输出：可用 mock builder 跑通「创建 Deck → 规划 → 页面计划」。

#### P4 · 构建集成（6–8 天）

- [x] Builder client（HMAC、幂等、超时、重试、取消）。
- [x] 页面编排：并发 2、每页 brief、事件转写、进度。
- [x] Validator final gate；修复 2 轮 + 后端重试 1 次（统一为 `DECK_PAGE_MAX_ATTEMPTS`）。
- [x] bundle/thumbnail 存储；版本切换；失败页重试。
- [x] Deck 状态机、partial、删除级联。
- [x] 重启恢复/失败落库；0 订阅者继续。
- [x] 失败注入：Builder/Validator down、超时、取消、重启（真实长时超时演练未做）。
- [x] 输出：真实 Pi 多页 E2E（`deepseek-flash`，实际 14 页；14/14 ready、0 failed、0 issues，15m11s，¥1.69；证据 `P4_REAL_E2E.json`）。

#### P5 · 阅读器与工作台（6–8 天）

- [x] 新路由与 DeckLayout；总览路线图/工作台。
- [x] 构建设置面板 + 构建工作台（时间线/事件/页面卡片/取消/恢复）。
- [x] `pageShell`：CSP、srcdoc、转义、runtime 注入、channel。
- [x] 阅读器：加载/预加载/翻页/全屏/错误/进度。
- [x] 选区桥与「问 AI」入口（先占位）。
- [x] 深浅色、reduced-motion、375/768/1280/1440/1920 验证。
- [x] 输出：可用的构建与阅读主路径（浏览器验收 34/34；Fullscreen API、全屏 AI 抽屉与失效 job 恢复已实测；真实 Pi 页面待补）。

#### P6 · AI 助手（4–5 天）

- [x] 聊天表/API/SSE；user/assistant 消息持久化。
- [x] 上下文组装、引用、限流；拒答由 system prompt 约束，真实模型拒答质量待凭据验证。
- [x] 侧栏 UI、快捷动作、历史、错误/重试。
- [x] 选区 quote + block context 前后端联调。
- [x] XSS/Markdown 安全验证。
- [x] 输出：选中文本问答 E2E（假 LLM 全链路 24/24；真实模型质量待凭据）。

#### P7 · 加固与发布（4–6 天）

- [x] 安全复核：沙箱、网络、路径、HMAC、prompt injection（三路审计 + 修复 + 残留风险登记）。
- [x] 成本/并发/超时/配额上限与错误文案复核（真实压测/真实 token 成本待凭据）。
- [x] 可观测性：构建/助手结构化日志字段与事件保留。
- [x] 迁移：旧资料回填、旧复习工件只读、模拟考试继续可用、向量清理说明。
- [x] 文档：README/AGENT/RULE/DESIGN/PAGE_CONTRACT/API 地图/环境变量/P7_RELEASE。
- [x] 全量回归完成（真实 Pi Gate 3/3、真实 14 页 E2E 14/14、12 页编排/断线恢复隔离库集成 6 项均通过）；输出发布说明与回滚手册。
- [ ] 等待人类审阅；**不擅自 push/merge**（当前未提交）。

### 14.4 依赖关系

```mermaid
flowchart LR
    P0 --> P1 --> P2
    P2 --> P3
    P2 --> P4
    P3 --> P4
    P4 --> P5 --> P6 --> P7
    P3 -. 契约可并行 .-> P5
```

---

## 15. 风险登记册

| # | 风险 | 概率 | 影响 | 缓解 | 触发/应对 |
| --- | --- | --- | --- | --- | --- |
| R1 | Pi 生成页面质量不稳定/布局溢出 | 高 | 高 | Harness + 黄金示例 + Validator + 修复闭环 + 页面预算 | P2 Gate 不达标 → Plan B |
| R2 | 生成代码安全逃逸 | 中 | 高 | 沙箱 iframe/CSP/无网络/静态检查/红队 | 任一逃逸 → 停止发布，修复后重跑 |
| R3 | Pi/SDK API 变化 | 中 | 中 | 锁定 1.5.0；Builder 适配层；升级独立任务 | 升级回归失败 → 回退版本 |
| R4 | 构建成本/延迟过高 | 高 | 中 | 并发/页数/字符上限；渐进交付；模型选择 | 超预算 → 降页数/换模型/优化 skill |
| R5 | 模型工具调用不稳定 | 中 | 高 | 启动探测；简化工具集；备用模型 | 失败率高 → 换模型或 Plan B |
| R6 | 上传资料 Prompt Injection | 中 | 中 | 资料视为数据；无网络/密钥；来源约束 | 发现异常输出 → 加分隔/过滤/人工复核 |
| R7 | 零滚动在真实字体/缩放下失败 | 高 | 中 | Canonical stage + 3 视口校验 + clamp | 失败 → 修复/拆页；不缩字号硬塞 |
| R8 | Builder/Validator 运维复杂 | 中 | 中 | 健康检查、fail-closed、资源限制、文档 | 不可用 → 503 可行动提示 |
| R9 | 旧资料回填失败 | 中 | 中 | 幂等、逐资料状态、重试、懒回填 | 失败资料 → 提示重新上传 |
| R10 | 移动端体验不一致 | 中 | 低 | 明确支持矩阵；移动端阅读降级 | 不承诺零滚动；提供滚动阅读 |
| R11 | 需求蔓延（彩色主题/导出/分享） | 高 | 中 | 非目标清单；阶段门禁 | 新需求另开分支/版本 |
| R12 | 无测试框架导致回归 | 高 | 中 | 已确认引入最小测试栈；黄金 eval | 排期压缩 → 保留黄金 eval + 人工清单，显式记录未覆盖项 |
| R13 | 大资料上下文超限 | 中 | 中 | 分层大纲、source pack、字符上限 | 超限 → 拆知识点/减少来源 |
| R14 | 页面运行时与校验器实现漂移 | 中 | 中 | 共享 `page-runtime` 源/版本号；同一 shell 逻辑 | 漂移 → 统一构建产物再发版 |

---

## 16. 迁移、回滚与发布

### 16.1 分阶段发布

1. **P1 合并后**：用户无感；资料解析分节；旧 review/exam 仍可用；Embedding 配置删除。
2. **P3/P4 内部验证**：Deck API 与 Builder 仅开发环境；不暴露入口。
3. **P5 灰度**：工作区出现「复习页」入口；旧「终极复习」保留在旧版资料；模拟考试保留。
4. **P6**：AI 助手仅在 Deck 阅读器内启用。
5. **P7**：完成验收后由人类决定合并；不自行 push/merge。

### 16.2 回滚

- 分支未合并：直接放弃分支即可。
- 合并后回滚：
  - 新表/新页面是增量的，可保留；
  - 恢复旧生成代码与 Embedding 依赖需要代码回滚；因此**至少一个发布周期不 DROP 向量表**；
  - 旧 Markdown 工件始终保留，回滚后可继续访问；
  - Builder/Validator 可整体下线，Deck 入口隐藏；不影响旧功能。
- 数据备份：迁移前备份数据库；不把 DROP/破坏性 SQL 放进启动流程。

### 16.3 旧功能处理

- **复习 Markdown**：由 Deck 取代；旧工件迁移期只读保留，后续独立任务下线。
- **模拟考试**：**已确认保留**；继续使用旧生成与展示（改造为 sections 驱动），本期不重做产品形态。后续如需页面化，另开版本，不与 PageRef 混合。
- **旧生成接口**：保留一个迁移周期；文档标记 legacy；后续删除需单独 `BREAKING CHANGE`。

### 16.4 文档义务

| 改动 | 必须更新 |
| --- | --- |
| 去 Embedding / 分节 | README、AGENT、`.env.example`、compose、init SQL |
| Deck/Builder/Validator 架构 | AGENT（目录/流程/API/启动） |
| 页面契约/安全边界 | AGENT 或独立 `PAGE_CONTRACT.md`；RULE 补充 |
| Deck 视觉/动效/全屏 | DESIGN.md（Deck 章节） |
| 环境变量/部署 | README + `.env.example` |
| 新依赖/版本 | requirements/package/lock + 说明 |
| 测试/验证命令 | README/RULE（已确认引入测试栈） |

---

## 17. 已确认决策（2026-11-07）

维护者已确认以下决策，P0 只做归档，不再作为待定项。未特别说明时，后续实现以本节为准。

| # | 决策 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| Q1 | 模拟考试是否保留 | **保留**。继续旧生成与展示，改造为 sections 驱动；本期不做页面化重做 | §2.1 / §3.2 / §16.3 |
| Q2 | Deck 是否允许彩色主题 | **否**。保持单色纸感 + 动效；风格差异靠排版/网格/密度/交互隐喻 | §3.6 / §9.6 |
| Q3 | 移动端零滚动承诺 | **桌面 ≥1024 宽零滚动；移动端滚动阅读**。不承诺移动端单屏 | §3.8 / §7.5 |
| Q4 | 是否引入测试框架 | **是**。最小 pytest + Vitest + Playwright，只覆盖 PageRef 核心链路 | §13.1 |
| Q5 | 默认 Pi 模型 | **环境可配**，优先工具调用稳定的 Coder 模型；启动时做工具调用探测 | §6.5 / §8.8 |
| Q6 | 页数/成本上限 | **6–16 页；构建并发 2；单页 8 分钟超时**；可按环境调整 | §8.4 / §12.3 |
| Q7 | 大纲是否需人工确认 | **否**。自动进入构建；仅在没有页面或整册失败时允许「重新规划」，已有页面时建议新建 Deck | §3.1 / §8.4 |
| Q8 | 页面是否允许外链资源 | **否**。页面完全自包含，CSP/Validator 双重拦截 | §7.1 / §11.1 |

---

## 18. Definition of Done

- [x] Embedding 代码、配置、依赖、文档引用全部移除；旧资料可分节并生成旧版内容。
- [x] 模拟考试继续可用（sections 驱动），旧复习 Markdown 迁移期只读可访问。
- [x] Deck/Page/BuildJob/BuildEvent/Chat 数据模型与 API 落地，归属校验完整。
- [x] Pi Builder 容器可独立启动、健康检查、HMAC、超时、取消、幂等。
- [x] Harness（Skill/Template/Extension/示例）版本化，Pi 版本锁定。
- [x] Validator 容器可校验零滚动/交互/网络/控制台/截图；后端最终门禁生效。
- [x] 12 页 Deck 端到端构建；单页失败不影响其他页；刷新/断线可恢复。（真实 Pi 14 页 E2E 通过：14/14 ready、0 failed；并发/断线/重试由隔离库集成 6 项覆盖）
- [x] 总览路线图 + 构建工作台 + 全屏阅读器可用；桌面零滚动验收通过。
- [x] 选区 AI 助手可用；流式、引用、历史、限流、XSS 安全（真实模型质量待凭据）。
- [x] 最小测试栈（pytest/Vitest/Playwright/node:test）覆盖核心链路并通过。
- [x] 安全清单（沙箱/CSP/无网络/路径/HMAC/Prompt Injection）复核通过；残留风险见 P7_REPORT §4。
- [x] 成本/耗时上限已落地；真实构建成本已测量：P2 Gate ¥0.14、P4 14 页 E2E ¥1.69，总 ¥1.83（预算 ¥10）。
- [x] README/AGENT/RULE/DESIGN/`.env.example`/compose/依赖同步。
- [x] 未提交 `.env`、密钥、`backend/data/`、构建产物；未擅自 push/merge。
- [ ] 人类维护者审阅并明确同意后才合并 `main`。

---

## 附录 A · 环境变量草案

### backend/.env（新增/删除）

```text
# 删除
# EMBED_BASE_URL / EMBED_API_KEY / EMBED_MODEL / EMBED_DIM

# 新增
PAGE_BUILDER_URL=http://page-builder:9100
PAGE_BUILDER_TOKEN=change-me
# 示例值；按实际网关可用、工具调用稳定的 Coder 模型填写
PAGE_BUILDER_MODEL=qwen3-coder-plus
PAGE_BUILDER_TIMEOUT_SECONDS=480
PAGE_BUILDER_CONCURRENCY=2
PAGE_VALIDATOR_URL=http://page-validator:9200
PAGE_VALIDATOR_TOKEN=change-me
DECK_MAX_PAGES=16
DECK_MIN_PAGES=6
DECK_PAGE_MAX_ATTEMPTS=2
DECK_JOB_TIMEOUT_SECONDS=1800
DECK_MAX_MATERIAL_CHARS=200000
DECK_MAX_BUNDLE_BYTES=2097152
```

### builder 容器

```text
LLM_BASE_URL=
LLM_API_KEY=
PAGE_BUILDER_MODEL=
PAGE_VALIDATOR_URL=http://page-validator:9200
PAGE_VALIDATOR_TOKEN=change-me
BUILDER_TOKEN=change-me
PI_CODING_AGENT_DIR=/opt/mockfinal-pi/agent
```

### validator 容器

```text
VALIDATOR_TOKEN=change-me
```

> 所有 token/密钥只放环境变量；不写入镜像、不写入日志、不下发前端。

---

## 附录 B · API 草案示例

```http
POST /api/workspaces/12/decks
Content-Type: application/json

{
  "title": "数据结构 · 复习页",
  "style": {
    "preset": "blueprint",
    "content": ["concept", "formula", "example", "misconception"],
    "density": "standard",
    "custom_prompt": "多用图示，公式推导一步一步来"
  }
}
```

```http
POST /api/decks/7/build
→ 200 { "job_id": 31 }
```

```http
GET /api/deck-jobs/31/events?after_id=120
→ [
  { "id": 121, "type": "stage", "payload": { "text": "正在规划知识点…" } },
  { "id": 122, "type": "page_ready", "payload": { "page_id": 3, "title": "二分查找" } }
]
```

```http
GET /api/decks/7/pages/3/bundle
→ {
  "schema_version": "1.0",
  "runtime_version": "1.0.0",
  "manifest": { "…": "…" },
  "html": "…",
  "css": "…",
  "js": "…"
}
```

---

## 附录 C · 参考资料

### 项目内

- `README.md`、`AGENT.md`、`RULE.md`、`DESIGN.md`
- `backend/app/services/indexer.py`、`generator.py`、`prompts.py`
- `backend/app/models.py`、`schemas.py`、`main.py`
- `frontend/src/views/WorkspaceView.vue`、`components/ArtifactPanel.vue`
- `docker-compose.yml`、`backend/requirements.txt`、`docker-initdb.d/01-init.sql`

### Pi 官方文档

- SDK: <https://pi.dev/docs/latest/sdk>
- RPC: <https://pi.dev/docs/latest/rpc>
- JSON Event Stream: <https://pi.dev/docs/latest/json>
- CLI Integration: <https://pi.dev/docs/latest/cli-integration>
- Skills: <https://pi.dev/docs/latest/skills>
- Prompt Templates: <https://pi.dev/docs/latest/prompt-templates>
- Extensions: <https://pi.dev/docs/latest/extensions>
- Custom Providers: <https://pi.dev/docs/latest/custom-provider>
- Containerization / Isolation: <https://pi.dev/docs/latest/containerization>
- npm 包: <https://www.npmjs.com/package/@earendil-works/pi-coding-agent>

### 技术依据

- 沙箱 iframe：HTML Standard `sandbox`、CSP `connect-src` / `frame-src` / `form-action`。
- Playwright：多视口布局测量、网络拦截、控制台错误、交互冒烟。
- Vue Router 5 返回值守卫、Pinia setup store、Tailwind CSS 4 语义 token（项目现状）。
