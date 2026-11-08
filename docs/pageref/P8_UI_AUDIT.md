# P8 · Deck 体验基线审计（截图 + 代码）

> 生成时间：2026-11-08。样本：`docs/pageref/p5-screenshots/`、`p6-screenshots/` 中已冻结的 P5/P6 验收截图；代码位置按当前 `main`。
> 本文件只记录现状与待修项，P12 完成后逐项复核并更新。

## 1. 截图基线

| 场景 | 证据 | 现状观察 |
| --- | --- | --- |
| 阅读器（浅色，1280） | `p5-screenshots/03-reader-bisect-1280-light.png` | 顶栏 56px；stage 内右侧速查卡与左侧主视觉之间留白过大；页面正文仅约 140–180 汉字，演示感强；无学习目标/检查题/角色标识 |
| 阅读器（深色） | `p5-screenshots/05-reader-dark-1280.png` | 深色层级正常，但缺主题入口之外的教学元信息 |
| 阅读器（移动 390） | `p5-screenshots/13-reader-mobile-390.png` | iframe 按桌面缩放，内容偏小；未进入纵向阅读模式 |
| 总览（1440） | `p5-screenshots/02-deck-overview-1440.png` | 页面宽度 1440，与全局 `max-w-5xl` 不一致；路线图节点为整块反转，状态文案「已就绪」与「已阅读」混用；工作台主进度是「就绪进度」而非学习进度 |
| 构建台（1280） | `p5-screenshots/06-build-in-progress-1280.png` | 时间线/卡片存在 `text-[10px]` 级小字；页卡只显示就绪/失败，无角色、检查数、教学评分 |
| 构建设置 | `p5-screenshots/08-build-setup-1280.png` | 密度选项只解释页数，不解释教学差异 |
| 助手（1280 / 390 / 失败） | `p6-screenshots/01-assistant-answer-1280.png`、`04-assistant-mobile-390.png`、`03-assistant-error-1280.png` | 失败气泡使用不存在的 `border-danger/40 bg-danger-soft`，实际无样式 |
| 空态 / 部分完成 | `p5-screenshots/07-deck-overview-partial-1280.png`、`11-empty-decks-1280.png` | 空态与错误态各自实现，缺统一组件 |

## 2. 代码侧待修项（P12 输入）

1. `frontend/src/views/DeckReaderView.vue`：停留 3 秒自动标记已读；header 固定 `h-14`，与 Deck 其他顶栏 `py-3` 不一致；切换页面时 `bundle` 置空导致白底闪烁。
2. `frontend/src/components/deck/PageFrame.vue`：丢弃 `progress` 事件；超时 8s，短于 Validator 的 10s；无重试错误卡。
3. `frontend/src/components/deck/DeckAssistantDrawer.vue`：使用不存在的 danger token；`text-[10px]`。
4. `DeckRoadmap.vue` / `DeckWorkbench.vue` / `BuildTimeline.vue` / `DeckReaderView.vue`：大量 `text-[10px]`，低于 DESIGN.md 的 11px 下限。
5. Deck 不套 `AppLayout`，无统一品牌区/移动菜单；总览宽度例外未写入 DESIGN.md。
6. 无 `AppIconButton` / `EmptyState` / `ErrorState` / `LoadingSkeleton` 等可复用组件，图标按钮各自实现。
7. 阅读器未展示 `manifest.teaching`（当前 14 页均无此字段，必须降级而不是伪造）。

## 3. 已冻结的验收断言

- `docs/pageref/P5_RESULTS.json`：阅读器/总览/构建台/深浅色/375–1920/reduced-motion 的既有断言。
- `docs/pageref/P6_RESULTS.json`：助手 SSE、引用、历史、错误、XSS、移动端。
- P12 修改选择器或布局后必须同步更新 `validator/scripts/p5-acceptance.mjs`、`p6-acceptance.mjs`，并重新生成截图；不得删除桌面零滚动与安全断言。

## 4. 本轮不修改

- 不重新生成截图（需要运行完整 API/Builder/Validator 与演示数据）；P12 统一产出新截图。
- 不调整视觉规范；`DESIGN.md` 的 Deck 章节在 P12 落地。
