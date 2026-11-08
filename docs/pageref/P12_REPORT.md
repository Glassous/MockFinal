# P12 阅读器与全局体验报告

> 日期：2026-11-08。范围：学习面板、显式“学完本页”、角色/检查信息、阅读器过渡与预取、总览/工作台教学信息、统一组件与设计规范。

## 1. 实现

### 阅读器与学习面板

- 新增 `DeckStudyPanel.vue`：本页 / 检查 / 依据 / AI 四个标签。
  - 本页：角色、目标、前置、讲解路线、例题、小结、易错、下一页承接；旧页面降级为“依据 + AI”并明确提示无教学目标。
  - 检查：默认隐藏答案，选择后显示正误与解析，支持“再做一次”；完成全部检查后上报 `checked`。
  - 依据：页面摘要、关键事实、来源引用与“待核对”标记。
  - AI：快捷问题与“打开 AI 助手”，复用 `DeckAssistantDrawer`；新增 `setDraft` 以便预填问题。
- 讲解路线点击 → `PageFrame.focusBlock` → runtime `focus_block` → 页面 `[data-mp-block]` 高亮 1.8s；不强制滚动。
- **移除 3 秒自动完成**：仅页面 `complete` 或完成随堂检查后显示/启用“学完本页”，点击才写入 `completed_page_ids`。
- 顶栏：返回、Deck 标题、角色徽章（角色 + 分钟 + 检查数 + 教学分）、页码与“已学完 / 已构建”、学习面板/AI/主题/全屏/重做。
- 页面切换 180ms 淡入 + 6px 位移（reduced-motion 关闭）；加载骨架；相邻页预取；bundle LRU 上限 6；iframe 就绪超时改为 10s。
- 来源从独立 Modal 移入学习面板，减少浮层种类。

### 其他体验

- 新增 `AppIconButton`、`EmptyState`、`ErrorState`、`LoadingSkeleton`、`DeckRoleBadge`。
- 总览路线图节点显示角色、检查数、已学完（不同图标 + 文案）；页面卡片显示角色/分钟/检查数/教学分。
- 工作台主进度改为“已学完 / 总页数”，继续学习定位到首个 ready 且未学完页面；统计已构建/失败/已学完/随堂检查；新增教学完整度。
- 构建台页面列表显示角色分布与平均教学分；失败页提供排查建议。
- 修复 10px 字号（统一 ≥11px）、补齐 `danger`/`danger-soft`/`success` 语义 token、统一 z-index 工具（`z-selection/z-panel/z-drawer/z-nav/z-modal/z-toast`）。
- 更新 `DESIGN.md`：危险色使用边界、层级表、Deck 阅读器与学习面板章节（5.5）、文件落地地图与组件检查表。

## 2. 验收

- `frontend npm run typecheck`：通过。
- `frontend npm run build`：通过。
- `frontend npm test`：20/20。
- `validator npm test`：50/50（runtime/shell 变更后）。
- `validator/scripts/p5-acceptance.mjs`（教学 fixtures + 显式完成）：**41/41 通过**，输出 `docs/pageref/P5_RESULTS.json`。
  - 学习面板四标签、教学目标、随堂检查反馈、依据、AI 入口；
  - 讲解路线 `focus_block` 高亮；
  - 第 2 页显式“学完本页”并写入进度；
  - 桌面 1280/1440/1920、移动端 390/375、768 无横向溢出；
  - 移动端学习面板全屏 sheet；深色阅读器；reduced-motion。
- 截图：`docs/pageref/p5-screenshots/04b-reader-study-page-1280.png`、`04c-reader-study-check-1280.png`、`04d-reader-study-complete-1280.png`、`13b-reader-study-mobile-390.png` 等。

## 3. 已知限制

- P6 页面 AI 助手验收脚本本轮未重跑（抽屉本身仅新增 `setDraft`，不影响原链路）；放入 P13 全量回归。
- “需复习”标记（P12 拉伸项）未实现，避免扩大后端进度契约。
- 学习面板检查作答不持久化，关闭后重置；符合本轮 MVP。
