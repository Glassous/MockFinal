# DESIGN.md · MockFinal 前端设计规范

> 本文件是 MockFinal 前端**唯一的视觉与审美依据**。任何新页面、新组件、样式调整前必须先读本文件。
> 大规模视觉改版必须从 `main` 切出独立的 `design/<名称>` 分支，并在分支内提交更新后的本文件；未同步 `DESIGN.md` 的改版不得合入。
> 当前版本：**v3 · 红笔批注（Red Pen）**，已覆盖全站：公开入口页、登录/注册/找回密码、应用外壳与侧栏、首页与工作区、Deck 总览/构建/阅读器，以及 page-kit 2.0 复习页。
>
> 2026-11-11：在 `design/frontend-v3` 完成 v3 全站迁移。v1 的单色圆角卡片语言退役；新代码一律遵循本文件，旧的 v1 样式不得回流。
>
> 2026-11-10：完成入口页与登录页预设计；v3 令牌提升为全局 `:root` 变量，入口页原子组件（装订线、印章、红勾等）全站可复用。
>
> PageRef 2.0 复习页（`design_system="2.0"`）沿用 v3 纸张语言，使用 page-kit 的讲义式排版与 flow/fit 混合滚动；内容规则见 [docs/pageref/PAGE_CONTENT_2.0.md](./docs/pageref/PAGE_CONTENT_2.0.md) 与 [P14_DESIGN_DECISION.md](./docs/pageref/P14_DESIGN_DECISION.md)。

## 0. v3 全站设计 · 红笔批注

### 0.1 范围与状态

- 覆盖：`/` 入口页、`/login`、`/register`、`/forgot`、`/home` 工作区首页、`/workspace/:id`、`/decks/:id` 总览、`/decks/:id/build` 构建工作台、`/decks/:id/read/:pageId` 阅读器与学习面板，以及复习页运行时（page-kit 2.0）。
- 路由：登录后的工作区首页为 `/home`；`/` 为公开入口页，已登录访问会重定向 `/home`。
- 示例内容：入口页展示的复变函数讲义、模拟题来自 `frontend/src/lib/entrySample.ts`；登录页封面使用与科目无关的「装订本目录」通用示例，不绑定具体课程。
- 界面必须保留「示例」标识；不得把示例数据伪装成真实学习记录。

### 0.2 设计主张

**把复习资料本身当成画面主体；红线同时是批注、装订线与叙事路径。**

页面不是「介绍产品的卡片堆」，而是一张正在被批改、被装订的讲义：真实公式、解题步骤、页边批注、页码与印章构成视觉；用户沿着一条红线从「样张」走到「工序」「翻页」「试做」「开始」。工作区与 Deck 页面延续同一张纸：目录行、页码、页签、印章式状态，而不是圆角卡片面板。

动效只做三件事：红笔画出标记、纸张换页、印章落下。其余状态变化都用短促的透明度/位移完成。

### 0.3 视觉系统（全站）

- Token 文件：`frontend/src/style.css` 定义全局 `--surface/--panel/--pen/...`，并映射为 Tailwind 语义类；`frontend/src/styles/entry-v3.css` 保存入口页原子组件与 `--e-*` 别名。组件只能使用语义类或 token，不写裸色值。
- `--e-*` 是全局别名（定义在 `:root`），入口页原子类（`.e-sheet`、`.e-binding`、`.e-stamp`、`.e-check`、`.e-folio`、`.e-link`、`.e-hand`）在任意页面可用。
- 颜色角色：
  - `--surface` 桌面/页面底，`--panel` 纸张，`--raised` 次级纸张；
  - `--ink` / `--ink-2` 正文，`--muted` 说明，`--faint` 页码/元数据（已校正到 4.5:1 以上）；
  - `--pen` 朱红：只用于批注、红线、焦点下划线、正确/错误标记、主操作；不承载长正文；
  - `--invert` 主按钮填充（v3 中与朱红同族），`--pen-ink` 反转文字；
  - 深色模式不是反相：纸面为暖黑 `#100f0d`，sheet 略亮 `#1a1917`，红线提亮 `#e46755`，按钮填充压深以保证白字对比度。
- 字体角色（不超过三种，外加楷体批注）：
  - 宋体栈（`--font-serif`）用于标题、讲义标题、收束句；
  - 系统无衬线（`--font-sans`）用于 UI、正文、按钮；
  - 等宽（`--font-mono`）用于页码、文件名、元数据；
  - 楷体（`--font-hand`）只用于红笔页边批注与印章，不用于正文。
- 形状：全局 2px 小圆角（覆盖 `--radius-sm…3xl`）；页面由「纸张 + 1px 线 + 页边距」组织，不使用大圆角卡片堆叠；阴影只给真正浮起的纸张（Modal、Toast、抽屉），静态内容靠线与留白分组。禁止 glassmorphism、渐变文字、发光、彩色光斑。
- 纸张细节：左侧装订线（红色线迹 + 打孔）、页眉页脚、页码、印章、页边批注；它们必须来自讲义/试卷语义，不做无职责装饰。

### 0.4 动效语言

| 动作 | 用途 | 参数 |
| --- | --- | --- |
| 红笔绘制 | 圆圈、下划线、箭头、勾/叉沿路径画出 | `stroke-dashoffset` 1→0，1.1s，`cubic-bezier(.62,.04,.28,1)` |
| 纸张换页 | 工序/页签/路由内容替换 | 10px 横向位移 + 透明度，220–300ms |
| 印章落下 | 批注/示例/成品印章出现 | 1.16→1 缩放，280ms，只出现一次 |
| 焦点红线 | 输入框聚焦、链接 hover、页签切换 | 从左向右画线，240–280ms |
| 装订线 | 页面进入时线迹生长 | `scaleY(0→1)`，900ms |

- 每次状态变化只选一种主动作，不叠加多种特效；禁止逐屏淡入、持续漂浮、弹跳、视差。
- 鼠标 hover 不缩放卡片；纸张只做极小的落平/位移。
- `prefers-reduced-motion: reduce` 下所有红线、印章、装订线、页面入场直接呈现最终状态，内容与操作完整。

### 0.5 页面规则

- 入口页叙事顺序固定为：`01 样张 → 02 工序 → 03 翻页 → 04 试做 → 05 开始`；每一节承担一种认识，不重复同一组卖点。
- 首屏第一焦点是真实讲义样张（公式、红圈、页边批注、印章），标题只占左侧一列且保持单行；禁止「超大两行标题占满左上角」。
- 每节只保留一个说明段与一个标题层级；不用成组的小字/小标签解释页面自身。讲义内部的页码、文件名、元数据属于内容，不算说明文字。
- 补充细节只能来自真实产物结构：输入/产出、目录、页码、检查数、文件名；不得虚构用户、成绩或使用量。
- 工序是唯一的大型交互段：分节/批注/装订三个状态共用一张纸，只替换纸内内容；页签必须支持键盘方向键。
- 翻页页使用真实页签（概念/机制/例题/练习/小结），每页有页边批注、收束句与检查状态；已完成步骤用「红勾 + 序号变色」双通道表达，不只靠颜色。
- 试做页是真实可操作的示例题：单选、即时判定、正确/错误双通道标记、解析与「再做一次」；答案未选择前不得出现解析。
- 登录页：左侧为与科目无关的装订本封面（本册目录、答案附册标注、已装订印章），不得依赖某个具体课程的例子；右侧为签到表式表单；输入框只用下划线，聚焦时红线从左画出；错误用「红叉 + 文案 + 左边线」，不只靠颜色。
- 认证页共用 `AuthShell`：暖纸底 + 居中纸张（左侧装订线 + 打孔）、等宽页眉 `签到表 · … / MockFinal`、宋体标题；注册与找回密码沿用同一张签到表，不再出现独立品牌大卡。
- 首页是「复习目录」：页眉、页码 `01 / 开始`、三步流程与工作区目录行；工作区页以红色页签组织资料/复习页/生成结果，列表行用等宽序号 + 宋体名称。
- 所有示例块必须标注「示例」；资料限制（仅 `.md` / `.txt`，单文件 ≤ 8 MiB）必须如实展示。

### 0.6 文件地图（v3 全站）

| 内容 | 文件 |
| --- | --- |
| 全局 token、字体、圆角、阴影、Markdown、焦点、层级 | `frontend/src/style.css` |
| v3 纸张/红线/装订线/印章/页眉原子 | `frontend/src/styles/entry-v3.css` |
| 样张、工序、翻页、试做、收尾 | `frontend/src/components/entry/HeroSpecimen.vue`、`ProcessSection.vue`、`DeckSection.vue`、`QuizSection.vue`、`ClosingSection.vue` |
| 共享基元 | `frontend/src/components/entry/BrandMark.vue`、`EntryHeader.vue`、`EntryRail.vue`、`EntryThemeToggle.vue`、`BindingThread.vue`、`StampMark.vue`、`TexBlock.vue`、`PenCircle.vue`、`PenUnderline.vue`、`PenCheck.vue`、`PenCross.vue`、`PenArrow.vue` |
| 入口与认证 | `frontend/src/views/LandingView.vue`、`LoginView.vue`、`RegisterView.vue`、`ForgotPasswordView.vue`、`frontend/src/components/AuthShell.vue` |
| 应用外壳与侧栏 | `frontend/src/layouts/AppLayout.vue`、`components/Sidebar.vue` |
| 首页、工作区、上传、资料、工件 | `frontend/src/views/HomeView.vue`、`WorkspaceView.vue`、`components/UploadZone.vue`、`MaterialList.vue`、`ArtifactPanel.vue` |
| 通用组件 | `frontend/src/components/AppButton.vue`、`AppIconButton.vue`、`AppInput.vue`、`Modal.vue`、`ConfirmModal.vue`、`ToastHost.vue`、`StatusBadge.vue`、`EmptyState.vue`、`ErrorState.vue`、`LoadingSkeleton.vue`、`ThemeToggle.vue` |
| Deck 总览/构建/阅读器 | `frontend/src/views/DeckOverviewView.vue`、`DeckBuildView.vue`、`DeckReaderView.vue`、`components/deck/*` |
| 复习页运行时与 page-kit 2.0 | `shared/page-shell/shell.mjs`、`shared/page-shell/page-kit/base.mjs`、`shared/page-shell/page-kit/themes/editorial.mjs` |
| 示例数据 | `frontend/src/lib/entrySample.ts` |
| 路由与入口流 | `frontend/src/router/index.ts`、`frontend/src/main.ts` |

### 0.7 全站约束

- 新页面、新组件直接使用 v3 纸张语言，不得另起一套视觉；v1 的圆角卡片、状态色、渐变/玻璃效果不得回流。
- 若调整颜色、字体、动效或页面结构，必须先改本节，再改实现。
- 复习页的 `--mp-*` / `--pg-*` token 与宿主 v3 对齐（暖纸、朱红、宋体标题、2px 圆角），但复习页仍由 page-kit 生成，不得在宿主内覆盖页面内容样式。
- 功能分支不得提前引入未合入的新视觉模式。

## 1. 设计定位

**一句话：让界面看起来像一份排版精良、可以安静读完的复习讲义。**

MockFinal 的核心内容是长文本：课程资料、复习大纲、模拟试卷、数学公式。用户通常在深夜、考前、长时间阅读的状态下使用。因此视觉不承担「炫技」职责，而承担三件事：**建立层级、降低噪音、让内容可读**。

### 1.1 三条审美原则

1. **内容优先**：层级由字号、字重、留白和边框建立；去掉所有装饰后，页面仍然成立。
2. **纸墨朱红**：纸色承载界面，墨色承载正文，朱红只承载「被批改/被标记」的语义（主操作、焦点、选中的页签、检查结果）。
3. **克制动效**：动效只用于解释状态变化（画出、翻页、落下），短、轻、可预期；拒绝弹性、漂浮、视差和循环装饰。

### 1.2 气质关键词

纸感 · 装订 · 红笔批注 · 编辑排版 · 留白 · 学术 · 安静 · 专注 · 夜读友好

### 1.3 明确的反对清单

以下元素与本项目气质冲突，禁止引入：

- 彩色渐变按钮、紫色/蓝色 AI 光晕、霓虹描边、Glassmorphism；
- 红/绿/黄状态色（朱红只作批注/主操作，不表示成功失败）、彩色标签、彩色阴影；
- 大圆角气泡堆叠、胶囊按钮泛滥、悬浮客服球；
- 插画、卡通吉祥物、emoji 装饰、3D 图标；
- 弹跳/弹性缓动、持续漂浮动画、背景视频、视差滚动；
- 多套并存的按钮/卡片/输入框风格。

代码高亮是唯一的彩色例外（GitHub Light / GitHub Dark 主题），KaTeX 公式继承正文墨色。

## 2. 颜色系统

所有颜色定义在 `frontend/src/style.css`，通过 `@theme inline` 映射为 Tailwind 语义类。组件只能使用语义类，**不得写裸色值**。

### 2.1 语义 token

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--surface` / `bg-surface` / `bg-paper` | `#f1efe9` | `#100f0d` | 页面底色 |
| `--panel` / `bg-panel` / `bg-sheet` | `#fbfaf6` | `#1a1917` | 纸张、侧栏、弹窗、输入框 |
| `--raised` / `bg-raised` / `bg-sheet-deep` | `#f4f1e9` | `#211f1c` | 次级纸张、图标底、hover、骨架屏 |
| `--border` / `border-border` | `rgba(26,24,20,.14)` | `rgba(237,233,223,.14)` | 默认 1px 边框、分割线 |
| `--border-strong` | `rgba(26,24,20,.3)` | `rgba(237,233,223,.3)` | 强调边框、虚线框、hover 边框 |
| `--ink` / `text-ink` | `#1a1814` | `#ede9df` | 主文字、标题 |
| `--ink-2` / `text-ink-2` | `#45413a` | `#c7c1b5` | 次级正文 |
| `--muted` / `text-muted` | `#6d675c` | `#a49d90` | 说明文字 |
| `--faint` / `text-faint` | `#716b5f` | `#8a8376` | 三级信息、时间戳、占位符 |
| `--pen` / `text-pen` / `border-pen` | `#c2382a` | `#e46755` | 批注、红线、焦点、选中页签、检查标记 |
| `--pen-soft` / `bg-pen-soft` | `rgba(194,56,42,.1)` | `rgba(228,103,85,.12)` | 选中项浅底、批注底 |
| `--pen-line` | `rgba(194,56,42,.42)` | `rgba(228,103,85,.45)` | 装订线、页边线迹 |
| `--invert` / `bg-invert` | `#b83326` | `#b53a2c` | 主按钮、进度条、选中填充 |
| `--invert-ink` / `text-invert-ink` | `#fffaf4` | `#fff8f1` | 反转底上的文字 |
| `--overlay` / `bg-overlay` | `rgba(35,28,20,.5)` | `rgba(0,0,0,.68)` | 弹窗/抽屉遮罩 |
| `--code-bg` | `#f4f1e9` | `#151411` | 行内代码、代码块 |
| `--danger` / `text-danger` / `border-danger` | `#b83326` | `#e46755` | 错误文字与描边（与朱红同族） |
| `--danger-soft` / `bg-danger-soft` | `rgba(184,51,38,.09)` | `rgba(228,103,85,.12)` | 错误反馈浅底 |
| `--success` / `text-success` | `#3f6b4f` | `#7fbf94` | 成功状态的辅助文字/图标 |

### 2.2 使用规则

- **主操作 = 朱红填充**：`bg-invert text-invert-ink`。一个视图只允许一个视觉权重最高的主按钮。
- **选中 = 红线或浅朱红底**：页签用红色下划线，列表项/卡片用 `border-pen bg-pen-soft`；只有主按钮使用整块朱红填充。
- **危险操作靠文案与确认**：`danger` 按钮与 `primary` 同族；风险由「删除」文案、警告图标和确认弹窗共同表达。
- **状态不靠纯色**：`StatusBadge` 用图标 + 中文标签 + 描边/浅底区分；成功用墨色/绿色辅助，失败用红叉 + 文案双通道。
- **正文必须用 `ink`**；`muted` 只用于说明，`faint` 只用于时间、占位、极次要信息，禁止用于长段落正文。
- **阴影是补充，边框是主角**：布局分隔优先 1px border；阴影只用于 Modal、Toast、抽屉与 hover 浮起。

### 2.3 主题切换

- 默认跟随系统 `prefers-color-scheme`；用户手动选择后写入 `localStorage.theme`（`light` / `dark`）。
- `index.html` 内联脚本在首屏渲染前给 `<html>` 加 `dark`，防止 FOUC；`stores/theme.ts` 负责运行时切换。**两处逻辑必须同步修改。**
- 所有 token 在 `:root` 与 `.dark` 中各定义一次，`@theme inline` 让 `bg-panel` 等工具类直接引用运行时变量，因此组件无需写 `dark:` 变体。
- 深色不是简单反相：暖黑底 `#100f0d`，纸张略亮 `#1a1917`，边框更克制；红线提亮，主按钮填充压深。
- 新组件必须在两种主题下逐一检查，尤其是占位符、禁用态、虚线框、hover 和遮罩。

## 3. 字体与排版

### 3.1 字体

- 标题/收束句：宋体栈（`--font-serif`），标题全局默认继承。
- 正文/UI：系统无衬线字体栈。不加载 Web Font，保证中文首屏速度与离线可用。
- 等宽：`ui-monospace`、SF Mono、JetBrains Mono、Fira Code、Menlo、Consolas，用于页码、文件名、元数据、序号。
- 楷体（`--font-hand`）只用于页边批注、印章、用户首字，不用于正文。
- 数学公式：KaTeX 默认字体，颜色继承正文。

### 3.2 字号与字重

| 场景 | 规格 |
| --- | --- |
| 页面主标题 | 宋体，`text-2xl sm:text-3xl`，`font-bold`，`tracking-tight` |
| 品牌字 | 宋体，`text-[17px]`，`font-bold`，`tracking-tight` |
| 卡片/区块标题 | 宋体，`text-base` 或 `text-lg`，`font-semibold`，`tracking-tight` |
| 正文/说明 | `text-sm`；Markdown 正文 `0.975rem`，行高 `1.8` |
| 辅助信息 | `text-xs`，`text-muted` / `text-faint` |
| 页码/文件元数据 | `text-xs`，`font-mono`，`tracking-wide`，`text-faint` |
| 微型标签 | `text-[11px]`，`font-semibold`，`tracking-wider`，`text-pen` 或 `text-faint` |

- 中文长文必须给足行高：正文 1.7–1.8，卡片说明 1.6–1.7。
- 标题统一 `tracking-tight`；等宽微标签用 `tracking-wider`。
- 字重只用 regular / medium / semibold / bold；不要用 300 细体做「高级感」，中文小字号会发虚。
- 一屏内标题层级不超过三层；不要用字号小于 11px 的文字。

## 4. 形状、间距与层级

### 4.1 圆角

| 元素 | 圆角 |
| --- | --- |
| 纸张、卡片、上传区、内容面板、弹窗 | `rounded-sm`（2px） |
| 按钮、输入框、下拉、侧栏工作区项、列表项 | 2px |
| 小图标底、行内代码、列表项图标 | 2px |
| 徽章 | 2px（方形批注章） |
| 头像、圆形图标按钮 | `rounded-full`（唯一允许的圆形） |

全局 `--radius-sm…3xl` 已覆盖为 2px；不得再写 8px 以上的圆角。滑块/进度条端点可为 2px，不用胶囊。

### 4.2 间距

- Tailwind 间距刻度（1 = 4px）：`1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8 / 10 / 12`。
- 页面容器：`px-5 py-8 sm:px-8 sm:py-10`，最大宽度 `max-w-5xl`。
- 认证页纸张：`max-w-md`；空状态说明文字：`max-w-md`；空状态整体：`max-w-2xl`。
- 纸张内边距：紧凑 `p-4`，标准 `p-5`，宽松 `p-6 sm:p-8`。
- 区块间距：标题与内容 8，卡片网格 `gap-4`，列表 `space-y-2` 或 `space-y-5`。
- 留白是主要层级工具：宁可少放一个元素，也不要缩小间距塞内容。

### 4.3 边框

- 默认 `1px solid var(--border)`；全局 `* { border-color: var(--border) }` 已兜底。
- 强调/hover 用 `border-border-strong`；红笔语义用 `border-pen` 或 `border-t-2 border-t-pen`。
- 空态、上传拖拽区用**虚线**；普通纸张不用虚线。
- 选中项：红色 1px 边框 + `bg-pen-soft`，或红色左侧/底部线；不要叠加大面积红色填充。

### 4.4 阴影

| 工具类 | 用途 |
| --- | --- |
| `shadow-sm` | 主按钮、静态强调元素 |
| `shadow-card`（runtime `--shadow-md`） | 可点击纸张 hover、认证纸张 |
| `shadow-pop`（runtime `--shadow-lg`） | 弹窗、toast、抽屉等浮层 |

- 浅色阴影为低透明度暖黑；深色阴影更深更重。不要在组件内写自定义阴影。
- 静态纸张默认无阴影，靠边框与纸色；hover 才轻微浮起。

### 4.5 层级（z-index）

| 层级 | 用途 |
| --- | --- |
| `z-10` | 认证页内容、stage 加载遮罩 |
| `z-20` | 认证页主题切换、stage 错误遮罩 |
| `z-selection`（40） | 选中文字浮标 |
| `z-panel`（60） | 学习面板 |
| `z-drawer`（70） | AI 助手抽屉 |
| `z-nav`（80） | 移动端侧栏抽屉 |
| `z-modal`（90） | Modal / ConfirmModal |
| `z-toast`（100） | Toast |

新元素必须复用该尺度，禁止 `z-[999]` 式随意值。学习面板始终低于 AI 抽屉与 Modal，避免遮挡对话和确认操作。

## 5. 布局

### 5.1 认证页（`AuthShell`）

- 暖纸底，居中纸张（`panel` + 1px 边框 + 2px 圆角），左侧装订线 + 打孔；顶部等宽页眉 `签到表 · … / MockFinal`。
- 纸张内为宋体标题 + 下划线输入表单；注册与找回密码复用同一外壳，不再出现独立品牌大卡。
- 背景不使用网格/柔光/玻璃；纸张本身就是唯一装饰。
- 主题切换固定在右上角。
- 找回密码为三步：方形步骤点 + 连线；已完成步骤用朱红填充 + 勾，当前步骤朱红描边，未开始为 `border + faint`。
- 表单错误块：`border-l-2 border-pen bg-raised` + `AlertCircle` + 朱红文案；不只靠颜色。
- 提交中显示缝线式加载；成功后短暂显示勾再跳转。

### 5.2 应用外壳（`AppLayout`）

- 桌面端：左侧固定 280px 侧栏（`panel` 纸张，右边框），右侧主区域 `surface`，`h-screen` 内部滚动，body 不滚动。
- 移动端（< `md`）：侧栏变抽屉（固定定位、`z-80`、200ms 位移），遮罩 `z-70`；顶部 56px 栏包含菜单、红色 M 方章 + 宋体品牌、主题切换。
- 侧栏是「装订目录」：左缘红色装订线 + 3 个打孔；品牌区 → 新建工作区（全宽次要按钮）→「我的工作区」等宽微标签 + 列表 → 底部用户区（楷体首字、用户名、主题、退出）。
- 工作区项：等宽序号 + 宋体名称 + 截断描述；激活项红色左边线 + `bg-pen-soft`，hover 用 `raised`。
- 内容区最大宽度 `max-w-5xl`，居中；不允许横向滚动（表格、公式、Tab 栏除外）。

### 5.3 首页（未打开工作区）

首页承担「引导 + 选择工作区」两件事，不展示任何业务数据。

- **顶部纸张**：`e-sheet` + `BindingThread`，等宽页眉（`复习目录 · 工作区`）与页码（`01 / 开始`），宋体标题与一句说明。
- 纸张内以红线分隔三步：01 创建工作区 / 02 上传学习资料 / 03 生成并复习；每步顶部 2px 红线 + 序号 + 标题 + 一句话说明，`sm` 起三列。
- **工作区目录**：小标题 + 数量；列表行是目录行——整行可点击，等宽序号、宋体名称、单行描述、相对时间（移动端隐藏）、箭头；hover 时箭头右移、边框加强。
- 列表末行为虚线「新建工作区」入口。
- 首次加载用与真实行同高的 `raised` 骨架（3 行），不要用 spinner 占满页面。
- 没有工作区时：保留顶部纸张，列表区改为虚线空态（图标 + 「还没有工作区」+ 一句说明 + 「新建第一个工作区」主 CTA）。

### 5.4 工作区页

- 头部：朱红等宽微标签「工作区」、宋体主标题、描述；右侧「生成」主按钮 + 编辑/删除方形描边图标按钮；移动端纵向堆叠且操作不挤压标题。
- 生成中：`Loader2` 旋转 + 阶段文案 + 6px 轨道，内部 1/3 宽朱红条做不确定进度动画。
- 页签：图标 + 文案 + 数量徽章；激活为 `ink` 文字 + 底部 2px 朱红下划线；数量徽章激活时朱红浅底；移动端允许横向滚动。
- 学习资料：上传区 + 资料列表。资料行方形纸张，等宽序号 + 文件类型方标；状态徽章在 `sm` 以上行内，移动端换行；失败原因用 `raised` 底小段文字。
- 复习页（Deck）列表：方形纸张行，选中项 `border-pen bg-pen-soft`，宋体名称 + 等宽元数据；构建入口用朱红描边/浅底。
- 工件：列表 + 内容双栏（`lg` 起），列表宽 288px；窄屏改为顶部横向滚动列表。内容纸张顶部 2px 红线，头部含宋体标题、生成时间、下载/删除方形按钮。
- 弹窗（新建/编辑工作区、新建复习页）：方形纸张 + 顶部 2px 红线；风格预设与密度选中项 `border-pen bg-pen-soft`；底部右对齐操作按钮。

### 5.5 Deck 阅读器与学习面板

- 阅读器为满高 flex：56px 顶栏 → stage（`surface` 底、内边距 8–12px、iframe 方形纸张）。桌面 stage 不滚动；移动端由 iframe 文档纵向滚动，宿主顶栏固定。
- 顶栏复用 `DeckTopBar` 视觉：左侧返回 + 宋体 Deck 标题 + 角色徽章（概念/机制/例题/练习/对比/小结 + 检查数）；中间等宽页码与“已学完 / 已构建”；右侧学习面板、AI、主题、全屏、重做。
- **不新增常驻导读条**，避免压缩 stage 高度；教学信息全部进入学习面板。
- 学习面板 `DeckStudyPanel`：`z-panel`，桌面右侧滑入 390px，移动端底部全屏 sheet（`max-h-[86dvh]`）；页签方形，激活朱红下划线；四个标签：本页 / 检查 / 依据 / AI。打开时页面仍可读，Esc 关闭。
- “本页”含目标、前置、讲解路线、例题、小结、易错；路线节点点击后由宿主向 iframe 发送 `focus_block`，页面只高亮对应块，不强制滚动。
- “检查”默认隐藏答案；选择后显示正误与解析；“再做一次”重置；完成全部检查后顶部出现“学完本页”。
- **移除停留 3 秒自动完成**：只有页面 `complete` 或完成随堂检查后才可标记学完；已学完与已构建使用不同图标与文案。
- 旧页面没有 `teaching` 时，面板降级为“依据 + AI”，并明确提示“这是旧版页面，暂无教学目标”，不伪造目标。
- 页面切换 180ms 淡入 + 6px 位移；加载显示与 stage 同尺寸骨架；相邻页预取，bundle 缓存上限 6 页；`prefers-reduced-motion` 直接切换。

### 5.6 复习页运行时（page-kit 2.0）

- `shared/page-shell/shell.mjs` 的 `--mp-*` token 与宿主 v3 对齐：暖纸、朱红、宋体标题、2px 圆角；深色为暖黑纸。
- `page-kit/base.mjs` 使用纸色背景，`--pg-radius: 2px`，无渐变、无玻璃模糊；讲义标题与正文继承 v3 字体角色。
- 复习页内容由 page-kit 生成，宿主不得覆盖页面内部排版；只提供容器、进度、学习面板与检查数据。

### 5.7 断点与容器

| 断点 | 行为 |
| --- | --- |
| `< 640` | 单列；页面横向内边距 20px；侧栏为抽屉；工件列表横向滚动 |
| `≥ 640 (sm)` | 工作区卡片 2 列；资料状态徽章行内显示；页面内边距 32px |
| `≥ 768 (md)` | 侧栏常驻；移动顶栏隐藏 |
| `≥ 1024 (lg)` | 工作区卡片 3 列；工件列表与内容左右分栏 |

- 所有交互目标至少 32×32px，主要按钮 40–48px 高。
- 必须验证 375px、768px、1280px 三个宽度。

## 6. 组件规范

### 6.1 按钮（`AppButton`）

- 变体：`primary` / `secondary` / `outline` / `ghost` / `danger`。
  - `primary`：`bg-invert text-invert-ink rounded-sm`，hover 转 `bg-pen`；
  - `danger`：`bg-pen text-pen-ink`，hover 转 `bg-invert`；
  - `secondary` / `outline`：透明或纸张底 + 1px 边框，hover `raised` + 边框加强；
  - `ghost`：无底无框，hover 才出现 `raised` + 朱红文字。
- 尺寸：`sm` 36px / `md` 40px / `lg` 48px；图标按钮为同尺寸正方形。
- 圆角固定 2px；按下用 `translateY(1px)`，不做缩放弹跳；禁用时 45% 不透明且不可点击；加载时用旋转图标替换左侧图标，文字保留。
- 纯图标按钮必须提供 `aria-label` 与 `title`。

### 6.2 输入与表单（`AppInput`）

- 下划线输入：透明底 + 1px 底边，聚焦时朱红底线从左画出（`scaleX(0→1)`）；不使用盒状输入框。
- 标签 `text-xs font-semibold text-muted`；占位符用 `faint`。
- focus：朱红底线 + 全局 `:focus-visible` 2px 朱红 outline。
- 错误：底线转朱红 + `AlertCircle` + `text-xs` 朱红文案；不只靠颜色。
- 密码框带显示/隐藏眼睛图标；下拉自绘箭头；textarea 可纵向调整。
- 表单错误块统一为 `border-l-2 border-pen bg-raised px-3.5 py-2.5`。

### 6.3 弹窗（`Modal` / `ConfirmModal`）

- 遮罩 `bg-overlay`；桌面居中，移动端底部弹出。
- 纸张 2px 圆角 + `border` + 顶部 2px 朱红边 + `shadow-pop`，`anim-pop` 入场；最大高度 92vh，内容区独立滚动，头尾固定。
- 标题宋体 `text-lg font-semibold tracking-tight`；描述 `text-sm muted`；右上角方形关闭按钮。
- Escape 关闭；打开时锁定 body 滚动；提交中禁止点击遮罩关闭。
- 确认弹窗：警告图标方底、标题、说明（明确写出不可撤销后果）、取消 + 危险/主操作；按钮顺序桌面右对齐、移动端纵向反转。
- 已知边界：当前未实现焦点陷阱（focus trap）；涉及弹窗可访问性改造时作为独立任务处理，并同步本文件。

### 6.4 Toast（`ToastHost`）

- 顶部居中，`max-w-sm`，纸张 + 1px 边框 + `shadow-pop`，图标 + 文案 + 关闭。
- success / error 图标用朱红或墨色；error 额外用 `border-pen` 与文案双通道；info 图标用 `muted`。
- 自动消失：success/info 3.2s，error 4.5s；移动端不遮挡主操作。
- 容器 `aria-live="polite"`；入场从 -14px 下移，离开 180ms。
- 文案只传达结果与下一步，不堆叠技术细节。

### 6.5 状态徽章（`StatusBadge`）

- `rounded-sm border px-2.5 py-0.5 text-xs`，图标 14px。
- 已就绪：朱红浅底 + 朱红描边；索引中：`raised` 底 + 旋转图标；失败：`panel` 底 + `border-strong` + 红叉文案；排队中：`panel` 底 + `muted` 文字。
- 移动端不得与桌面徽章同时出现（用 `hidden sm:inline-flex` 包裹桌面徽章）。

### 6.6 上传区（`UploadZone`）

- 大面积 2px 虚线框，2px 圆角，纸色底；hover/拖拽边框转朱红、底色 `raised`。
- 方形图标底；拖拽进入时图标转朱红浅底、文案切换为「松开鼠标即可上传」。
- 支持多选；队列项显示文件名、大小、状态、进度；进度条 6px、朱红、200ms 宽度过渡。
- 成功后停留 1.8s 自动移除；失败提供重试与移除。
- 文件名过长必须截断，进度与错误文案不得撑破布局。

### 6.7 列表与空态

- 列表行统一方形纸张，hover `border-border-strong`；行内操作按钮为 32px 方形 ghost。
- 空态：居中、`py-12` 以上；图标方标、`text-sm muted` 说明；有明确下一步时给主 CTA。
- 骨架屏用 `bg-raised` + `animate-pulse`，形状与真实内容一致、2px 圆角；不要用骨架屏伪装成内容。

### 6.8 Markdown 与公式

- `.markdown-body`：0.975rem / 1.8；h1 1.75rem、h2 1.4rem、h3 1.175rem；h1/h2 带底部细边框，标题宋体。
- 链接：墨色 + 下划线，hover 转朱红并画出下划线。
- 引用：朱红左侧 2px 边线 + `raised` 底，无圆角。
- 行内代码：`code-bg` 底 + 边框 + 等宽，2px 圆角；代码块可横向滚动。
- 表格：全宽、边框合并、表头 `raised`、偶数行 55% `raised` 叠加；允许横向滚动。
- KaTeX 块级公式允许横向滚动，不得溢出容器。
- Markdown 原文一律视为不可信：`html:false` + DOMPurify；不要为了样式放宽清洗规则。
- 代码高亮只用 GitHub Light / GitHub Dark 两套，并随主题切换 `<link>`。

## 7. 动效

### 7.1 节奏

| 时长 | 用途 |
| --- | --- |
| 150ms | hover、颜色、边框 |
| 180–200ms | 路由切换、弹窗遮罩、步骤切换、主题切换 |
| 220–300ms | 纸张换页、弹窗、toast 入场 |
| 400ms | 页面/卡片首次入场（`anim-rise`） |
| 0.9s / 1.3s / 1.4s | 装订线生长 / 不确定进度 / 呼吸骨架（仅加载） |
| 1.1s | 红笔沿路径绘制 |

- 入场缓动：`cubic-bezier(0.22, 1, 0.36, 1)`；红笔绘制 `cubic-bezier(.62,.04,.28,1)`；离场用 `ease`；旋转用 `linear`。
- 位移幅度克制：页面切换 6px、纸张换页 10px、toast 入场 14px、卡片 hover 2px。
- 按钮按下 `translateY(1px)`；纸张 hover 才轻微浮起，静态纸张不动。
- 禁止：弹跳、过冲、旋转装饰、无限循环的非加载动画、背景视差。

### 7.2 可访问性

- 全局已在 `prefers-reduced-motion: reduce` 下关闭位移、红笔绘制、印章与装订线动画，并直接呈现最终状态。
- 新增动画必须同样受该媒体查询约束；不得用 JS 绕过。
- 动画不得阻塞操作；页面切换期间表单与按钮仍可聚焦。

## 8. 文案与语气

- 使用简体中文；语气冷静、可靠、像一位耐心的助教，不卖萌、不喊口号、不用感叹号。
- 直接称呼「你」；按钮用动词短语：新建工作区、生成、保存、下载 .md、重试、返回登录。
- 空态必须告诉用户「下一步做什么」；错误必须可行动（例如「请先上传资料并等待索引完成」）。
- 删除确认必须说明后果与不可撤销性；不要只写「确定吗？」。
- 术语统一：

| 概念 | 面向用户的说法 |
| --- | --- |
| workspace | 工作区 |
| material | 学习资料 / 资料 |
| indexing | 索引中 / 已就绪 / 失败 / 排队中 |
| generation job | 生成（进行中显示阶段文案） |
| artifact | 「终极复习」「模拟考试」或「生成结果」，不要写「工件」 |
| review / exam | 期末终极复习 / 期末模拟考试 |
| deck | 复习页 |

> 本文内部沿用「工件」指代 artifact（对应表 `artifacts`）；它只存在于文档与代码，不应出现在用户界面文案中。

- 错误文案来自后端 `detail` 时直接展示，不二次包装成英文；前端兜底文案也要中文。

## 9. 可访问性

- 对比度：正文只用 `ink`；`muted`/`faint` 不承载关键信息；禁用态不低到不可读。
- 键盘：所有按钮/输入可 Tab 到达；上传区支持 Enter/Space；弹窗支持 Escape；移动抽屉有明确关闭方式；入口页页签支持方向键。
- 焦点：全局 `:focus-visible` 为 2px 朱红 outline、offset 2px；不要用 `outline: none` 除非提供等价可见反馈。
- 语义：弹窗 `role="dialog"` + `aria-modal`；toast `aria-live`；图标按钮 `aria-label`；表单 label 通过 `useId` 绑定。
- 状态不能只靠颜色：图标 + 文案 + 形状至少两者同时表达（红勾/红叉、序号变色、浅底 + 边线）。
- 触控目标不小于 32px，主操作不小于 40px。
- 已知边界：Modal 尚未实现焦点陷阱；新增相关能力时按独立任务推进并更新本文件。

## 10. 响应式与移动端

- 优先保证阅读宽度：内容区最大 `max-w-5xl`，长文本行宽不超过约 80 个中文字符。
- 移动端不使用 hover 作为唯一操作入口；行内操作按钮必须常驻或可发现。
- 表格、公式、Tab 栏允许自身横向滚动，但页面主体不能横向溢出。
- 弹窗在移动端从底部出现，按钮可纵向堆叠；toast 不遮挡顶部导航。
- 深色模式在移动端必须同样检查（OLED 暖黑背景下边框容易消失，必要时用 `border-strong`）。
- 375px 下认证页纸张、首页目录行、工作区页签、Deck 弹窗均已完成截图验证，无横向溢出。

## 11. 新页面 / 新组件检查表

- [ ] 先问「用户来这里要完成什么」，从内容和操作出发，不先挑样式；
- [ ] 优先复用 `AppButton` / `AppIconButton` / `AppInput` / `Modal` / `Toast` / `StatusBadge` / `EmptyState` / `ErrorState` / `LoadingSkeleton` 与 `.e-*` 原子，不另造平行组件；
- [ ] 只用语义 token，没有裸色值、裸阴影、裸 z-index；
- [ ] 浅色与深色都检查：边框、hover、禁用、占位符、遮罩；
- [ ] 覆盖加载、空态、错误、成功四种状态；长文件名/长标题不撑破布局；
- [ ] 375 / 768 / 1280 三个宽度可用，无页面横向滚动；
- [ ] 键盘可操作，图标按钮有 `aria-label`，状态不只靠颜色；
- [ ] 文案符合第 8 节，删除类操作说明后果；
- [ ] 动效符合第 7 节，新增动画受 reduced-motion 约束；
- [ ] 若是新视觉模式（而非既有模式的组合），先更新本文件再实现。

## 12. 设计变更流程

### 12.1 小型、增量改动

- 在普通 `feat` / `fix` 分支内完成；不改变整体气质、不新增设计模式。
- 若新增了可复用的 token、组件规格或交互模式，在同一原子任务中更新 `DESIGN.md`。

### 12.2 大规模视觉改版

- 从最新 `main` 切出 `design/<名称>` 分支，例如 `design/frontend-v3`。
- 分支内**先提交 `DESIGN.md` 的新方向与 token 草案，再实现页面**；实现与新规范必须一致。
- 改版期间不合并到 `main`；禁止把未完成的风格混入功能分支。
- 由人类维护者审阅并明确同意后才能合并；合并后本文件即成为新的唯一视觉依据。
- 不涉及视觉的功能分支必须继续遵循当时 `main` 上的 `DESIGN.md`，不得提前使用未合并的新风格。

### 12.3 冲突处理

- `DESIGN.md` 与当前代码不一致时，以 `main` 上已合入的代码为「现状」，但应在下一个相关任务中修正文档；不要以「代码就是这样」为由延续违反本文件的临时样式。
- 任何「只此一次」的视觉例外，都必须写进本文件，否则视为违规。

## 13. 文件落地地图

| 设计内容 | 文件 |
| --- | --- |
| 全局 token、阴影、圆角、字体、动画、Markdown 排版、滚动条、焦点样式 | `frontend/src/style.css` |
| 入口页原子（装订线、印章、红勾、页码、纸张、按钮、页眉、侧轨） | `frontend/src/styles/entry-v3.css` |
| 认证页纸张与签到表外壳 | `frontend/src/components/AuthShell.vue` |
| 按钮、输入、弹窗、toast、状态徽章 | `frontend/src/components/AppButton.vue`、`AppInput.vue`、`Modal.vue`、`ConfirmModal.vue`、`ToastHost.vue`、`StatusBadge.vue` |
| 应用外壳与侧栏 | `frontend/src/layouts/AppLayout.vue`、`components/Sidebar.vue` |
| 首页、工作区页 | `frontend/src/views/HomeView.vue`、`WorkspaceView.vue` |
| 上传、资料、工件、Markdown | `frontend/src/components/UploadZone.vue`、`MaterialList.vue`、`ArtifactPanel.vue`、`MarkdownView.vue` |
| 通用图标按钮/空态/错误态/骨架 | `frontend/src/components/AppIconButton.vue`、`EmptyState.vue`、`ErrorState.vue`、`LoadingSkeleton.vue` |
| Deck 阅读器、学习面板、角色徽章 | `frontend/src/views/DeckReaderView.vue`、`components/deck/DeckStudyPanel.vue`、`DeckRoleBadge.vue`、`PageFrame.vue`、`PageProgress.vue` |
| Deck 总览、路线图、工作台、构建台 | `frontend/src/views/DeckOverviewView.vue`、`DeckBuildView.vue`、`components/deck/DeckRoadmap.vue`、`DeckWorkbench.vue`、`DeckPageCard.vue`、`BuildPageGrid.vue`、`BuildConsole.vue` |
| 复习页运行时与 page-kit 2.0 | `shared/page-shell/shell.mjs`、`shared/page-shell/page-kit/base.mjs`、`shared/page-shell/page-kit/themes/editorial.mjs` |
| 主题切换与代码高亮主题 | `frontend/src/components/ThemeToggle.vue`、`stores/theme.ts`、`lib/highlight.ts` |
| 品牌标记 | `frontend/public/favicon.svg`、`index.html` |
