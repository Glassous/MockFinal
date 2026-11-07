# P5_REPORT.md · 阅读器与构建工作台

> 日期：2026-11-07 ｜ 分支：`feat/pageref` ｜ 范围：P5（前端阅读器/工作台；页面 AI 助手仍为 P6）
> 结论先行：P5 主路径已落地并通过浏览器验收：工作区「复习页」入口、总览路线图/工作台、构建设置与实时工作台、全屏阅读器、选区桥接与「问 AI」入口、依据资料、单页重做、深色与 reduced-motion。**浏览器验收 34 项全部通过、0 控制台错误**（含 Fullscreen API 进入/退出、全屏下 AI 抽屉可见、失效 `?job=` 恢复）。P5 时点页面 AI 助手仅完成交互壳；P6 已接入助手，P7 后续已用真实 Pi 14 页 Deck 完成真实生成页阅读复验（0 控制台错误）。

## 1. 交付范围

| 模块 | 交付 |
| --- | --- |
| 路由与布局 | `DeckLayout.vue`；新增 `/workspace/:id/decks/:deckId`（总览）、`/build`（工作台）、`/pages/:pageId`（阅读器），不套 `AppLayout` 侧栏 |
| 工作区入口 | `WorkspaceView` 新增「复习页」标签（默认仍停在「学习资料」）；旧复习 Markdown 改名「旧版资料」；`DeckList.vue` 列表/空态；`DeckCreateModal.vue` 新建（标题 + 风格 + 内容偏好 + 密度 + 自定义提示词） |
| API/类型 | `api/decks.ts`；`types/index.ts` 新增 Deck/Page/Job/Event/Bundle/Progress/Manifest/Selection 类型 |
| 总览 | `DeckOverviewView.vue`：Deck 抬头/状态、`DeckRoadmap.vue` 章节路线图（节点状态/重要度/页码）、`DeckWorkbench.vue` 进度/继续阅读/页面清单/风格摘要/资料覆盖/整册重建/重新规划/失败重试；`DeckPageCard.vue` 缩略图卡片 |
| 构建工作台 | `DeckBuildView.vue`：`BuildSetupPanel.vue` 构建设置；`BuildTimeline.vue` 六阶段时间线；`BuildConsole.vue` 可见输出（自动滚动、上滚暂停）；`BuildPageGrid.vue` 逐页卡片；真实页级进度；取消；单页重做；按 `?job=` 或 `last_job_id` 恢复最近任务 |
| 阅读器 | `DeckReaderView.vue`：bundle 加载/相邻页预取、`PageFrame.vue` srcdoc 沙箱 iframe、`pageShell.ts` 复用 `shared/page-shell` 与 runtime 源码、CSP/channel/转义、主题消息、键盘/按钮翻页、全屏、错误卡片与重试、页码/已读进度、依据资料弹窗、单页重做入口 |
| 选区桥 | `PageFrame` 校验 `event.source` 与 channel；`SelectionAction.vue` 浮动「问 AI」；`DeckAssistantDrawer.vue` 展示选中引用、快捷动作与历史；输入明确禁用并提示 P6 接入 |
| 设计/响应式 | 全部使用 DESIGN.md 语义 token；路线图桌面横向、移动端纵向堆叠；375/390/768/1280/1440/1920 检查；`prefers-reduced-motion` 全局降级并传递给 runtime |
| 后端小扩展 | `DeckOut.last_job_id`：最近一次任务（含已结束），使工作台重新进入时可恢复失败原因；P4 契约不变，仅为附加字段 |
| 共享 runtime | 焦点进入 iframe 后转发未处理的 ←/→/空格/PageUp/PageDown 导航键（表单控件与按钮上的空格除外），修复「点过页面后键盘翻页失效」 |
| 测试 | 前端 Vitest 16 项；浏览器验收脚本 `validator/scripts/p5-acceptance.mjs`（34 项检查）；演示数据种子 `backend/tests/fixtures/p5_seed.py` |
| 文档 | 本报告、`P5_RESULTS.json`、`p5-screenshots/`；同步 `AGENT.md`、`Plan.md`、`PAGE_CONTRACT.md` |

**未改动**：Builder/Validator 业务逻辑（仅 runtime 键盘转发）；未执行 git commit/push/merge。

## 2. 实际执行的验证

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 前端类型检查 | `cd frontend && pnpm typecheck` | 通过 |
| 前端单测 | `cd frontend && pnpm test` | **16 passed**（deck 纯函数 10、pageShell 4、format 2） |
| 前端构建 | `cd frontend && pnpm build` | 通过（仅既有 chunk 体积提示） |
| 后端默认测试 | 测试容器 `pytest` | **69 passed** |
| P4 隔离库集成 | `P4_INTEGRATION=1 ... pytest tests/test_decks_api.py` | **3 passed** |
| Validator 测试 | `cd validator && npm test` | **43 passed**（含真实 Chromium 与 shell/runtime 校验） |
| Builder 测试 | `cd builder && npm test` | **20 passed** |
| API 健康 | `GET /api/health` | `{"status":"ok","database":"ok"}` |
| `last_job_id` | 登录后读取 Deck 4/5/6/7 | `1/2/3/null`，与种子任务一致 |
| 浏览器验收 | `node validator/scripts/p5-acceptance.mjs` | **29 passed / 0 failed / 0 console errors** |

浏览器验收覆盖：

- 工作区复习页列表、空态、新建复习页并进入构建设置；
- 总览 1280×720 一屏零滚动、1440×900/1920×1080 零滚动、无横向溢出；
- 阅读器宿主与 iframe 在 1280×720 零滚动；页面交互（bisect step）可执行；
- 选中文本 → 「问 AI」→ 抽屉带引用上下文；
- 依据资料弹窗、键盘 →/← 翻页、重做弹窗；
- 深色阅读器无溢出；
- 构建中工作台显示真实进度/事件/页面卡片与取消入口；取消确认说明保留已完成页面；
- 部分失败总览提供重试入口；重新进入构建工作台可恢复最近任务与中文失败原因；
- 草稿构建设置；未配置服务时 build 返回 503 中文可行动提示（fail-closed）；
- 375×667、390×844、768×1024 总览与阅读器无横向溢出；
- reduced-motion 偏好传递到页面 runtime。

演示数据：3 个黄金 bundle（bisect/matrix/timeline）作为已通过校验的页面注入本地存储，覆盖「就绪」「构建中」「部分失败」「草稿」四种 Deck 状态。**这不是真实 Pi 生成结果**，不替代 P2/P4 真实门禁。

## 3. 交互与状态语义

- **构建进度**：只用后端 `ready_pages/failed_pages/total_pages` 与 job 状态；`done/partial` 显示 100%，其余按已处理页数取整并封顶 99%。不做假进度。
- **事件流**：1s 轮询（页面隐藏时 5s），按 `after_id` 增量合并去重；只展示 stage/text/tool/validation/page_ready/retry/error 的白名单文本；用户上滚时暂停自动滚动并显示「有新输出」。
- **恢复**：进入 `/build` 优先使用 `?job=`，其次 `active_job_id`，最后 `last_job_id`；完成/失败任务也可重新查看，失败原因来自 job.error 或最后一条 error 事件。
- **阅读进度**：打开页面上报 `last_page_id`；页面 `emit('complete')` 立即标记已读；离开页面时若停留 ≥3s 也标记已读；后端合并去重，只增不减。
- **页面生命周期**：bundle 预取当前 ±1；只渲染一个 iframe，翻页重建；shell 组装失败/版本不一致/超时（8s）显示错误卡片与重试，不白屏。
- **选区**：runtime 220ms 防抖后上报 `{text, rect, blockText}`；阅读器按 stage 偏移定位浮动按钮；打开抽屉时把选区作为引用上下文，清空浮动按钮。
- **重做**：阅读器/工作台/失败卡片均可带 ≤2000 字反馈发起单页重建；旧版本在新版本通过校验前保持可读；跳转构建工作台查看进度。

## 4. 与 Plan 的偏差 / 实现取舍

1. **路线图用 CSS 网格而非 SVG 连线**：章节按列分组、节点纵向串联，桌面横向、移动端纵向；状态用图标/文案/反转/描边表达，符合单色与可访问性要求，未引入 SVG 布局复杂度。
2. **只保留一个 iframe**：相邻页只预取 bundle，不保留 current ±1 iframe；降低内存与消息通道管理成本，翻页时重建 shell。
3. **`DeckOut.last_job_id` 扩展**：Plan 的 API 表没有该字段；为满足「重新进入按 job_id 恢复」与失败原因展示而新增，默认空，兼容既有调用。
4. **runtime 键盘转发**：PAGE_CONTRACT 原写「翻页快捷键由宿主处理」；实际焦点进入 sandbox iframe 后宿主收不到键事件，因此在 runtime 内转发未处理导航键，并同步更新契约。未提升 runtime_version（API 形状未变）。
5. **工作区默认仍为「学习资料」**：复习页作为新标签与主入口，但新用户需要先上传资料；避免首次进入看到空 Deck 而不知道先做什么。
6. **AI 助手壳**：抽屉、选区和快捷动作已完成；输入禁用并明确 P6 接入，避免在 P5 伪造问答或引用。

## 5. 未实现项与边界

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 页面 AI 助手真实问答（P6） | 未实现 | POST messages 仍 503；抽屉仅展示引用上下文与历史占位 |
| 真实 Pi 多页 E2E 与真实生成页阅读 | 已完成（P7 后续） | 真实 Pi 14 页 Deck 14/14 ready；主 API + 前端阅读器实测 0 控制台错误，见 `P4_REAL_E2E.json` 与 `p4-real-screenshots/reader-*.png` |
| Fullscreen API 实测 | 已执行 | headless Chromium 实测进入全屏（`document.fullscreenElement` 非空、按钮切换为「退出全屏」）并 Esc 退出；全屏下 AI 抽屉可见（420px 侧栏）；带真实浏览器 chrome 的视觉差异未单独检查 |
| 触控手势 | 未实现 | 移动端使用按钮/键盘；未加左右滑动，避免与页面内交互冲突 |
| 移动端零滚动 | 不承诺 | 仅验证宿主无横向溢出；页面在窄视口按自身响应式布局呈现 |
| 阅读器 bundle 持久缓存 | 未实现 | 仅内存缓存，退出清理；Plan MVP 允许 |
| 多 API worker 事件一致性 | 未实现 | 沿用 DB 轮询，单 worker 可用；多副本需 LISTEN/NOTIFY 或 Redis |
| 全屏下 AI 抽屉 | 已验证 | 改为全屏 `document.documentElement`，teleport 浮层随文档根进入全屏；验收断言侧栏 420px 可见 |
| 大列表性能 | 未压测 | 16 页规模正常；更多页面需要虚拟化/分页 |

## 6. 证据

- 浏览器结果：`docs/pageref/P5_RESULTS.json`（34 passed / 0 failed / 0 console errors）。
- 截图：`docs/pageref/p5-screenshots/`
  - `01-deck-list-1280`、`02-deck-overview-{1280,1440,1920}`、`03-reader-bisect-1280-light`、`03b-reader-fullscreen-1280`、`03c-reader-fullscreen-assistant-1280`、`04-reader-selection-drawer-1280`、`05-reader-dark-1280`
  - `06-build-in-progress-1280`、`07-deck-overview-partial-1280`、`07b-build-partial-result-1280`
  - `08-build-setup-1280`、`09-build-fail-closed-1280`、`10-deck-create-modal-1280`、`11-empty-decks-1280`
  - `12-overview-mobile-390`、`13-reader-mobile-390`、`14-overview-{375,768}`
- 验收脚本：`validator/scripts/p5-acceptance.mjs`；演示数据：`backend/tests/fixtures/p5_seed.py`（需在 API 容器内运行，黄金 bundle 需复制到 `/tmp/golden`）。