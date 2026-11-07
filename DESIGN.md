# DESIGN.md · MockFinal 前端设计规范

> 本文件是 MockFinal 前端**唯一的视觉与审美依据**。任何新页面、新组件、样式调整前必须先读本文件。
> 大规模视觉改版必须从 `main` 切出独立的 `design/<名称>` 分支，并在分支内提交更新后的本文件；未同步 `DESIGN.md` 的改版不得合入。
> 当前版本：**v1 · 单色纸感（Monochrome Paper）**，描述 `main` 分支的既有设计。

## 1. 设计定位

**一句话：让界面看起来像一份排版精良、可以安静读完的复习讲义。**

MockFinal 的核心内容是长文本：课程资料、复习大纲、模拟试卷、数学公式。用户通常在深夜、考前、长时间阅读的状态下使用。因此视觉不承担「炫技」职责，而承担三件事：**建立层级、降低噪音、让内容可读**。

### 1.1 三条审美原则

1. **内容优先**：层级由字号、字重、留白和边框建立，不靠颜色。去掉所有装饰后，页面仍然成立。
2. **单色对比**：全局只有黑、白、灰。主操作、选中态、进度都用「墨色反转」表达；没有品牌色、强调色、状态色。
3. **克制动效**：动效只用于解释状态变化（出现、切换、加载），短、轻、可预期；拒绝弹性、漂浮、视差和循环装饰。

### 1.2 气质关键词

纸感 · 墨色 · 网格 · 编辑排版 · 留白 · 学术 · 安静 · 专注 · 夜读友好

### 1.3 明确的反对清单

以下元素与本项目气质冲突，禁止引入：

- 彩色渐变按钮、紫色/蓝色 AI 光晕、霓虹描边、Glassmorphism；
- 红/绿/黄状态色、彩色标签、彩色阴影；
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
| `--surface` / `bg-surface` | `#f4f4f5` | `#09090b` | 页面底色 |
| `--panel` / `bg-panel` | `#ffffff` | `#131316` | 卡片、侧栏、弹窗、输入框 |
| `--raised` / `bg-raised` | `#fafafb` | `#1c1c20` | 次级填充、图标底、hover、骨架屏 |
| `--border` / `border-border` | `#e4e4e7` | `#26262b` | 默认 1px 边框、分割线 |
| `--border-strong` | `#d4d4d8` | `#3a3a41` | 强调边框、虚线框、hover 边框 |
| `--ink` / `text-ink` | `#16161a` | `#f5f5f6` | 主文字、标题、主操作底色 |
| `--muted` / `text-muted` | `#6b6b73` | `#a0a0a8` | 次级文字、说明 |
| `--faint` / `text-faint` | `#9a9aa2` | `#6e6e77` | 三级信息、时间戳、占位符 |
| `--invert` / `bg-invert` | `#16161a` | `#f5f5f6` | 主按钮、选中项、进度条 |
| `--invert-ink` | `#ffffff` | `#09090b` | 反转底上的文字 |
| `--overlay` / `bg-overlay` | `rgba(10,10,12,.45)` | `rgba(0,0,0,.68)` | 弹窗/抽屉遮罩 |
| `--code-bg` | `#f4f4f5` | `#0e0e11` | 行内代码、代码块 |

### 2.2 使用规则

- **主操作 = 反转**：`bg-invert text-invert-ink`。一个视图只允许一个视觉权重最高的主按钮。
- **选中 = 反转**：侧栏当前工作区、工件列表当前项、已完成的步骤点，都用整块反转表达，而不是加彩色描边。
- **危险操作不靠红色**：`danger` 按钮与 `primary` 视觉相同；风险由「删除」文案、警告图标和确认弹窗共同表达。
- **状态不靠颜色**：`StatusBadge` 用图标 + 中文标签 + 反转/描边区分；失败与排队都是单色。
- **正文必须用 `ink`**；`muted` 只用于说明，`faint` 只用于时间、占位、极次要信息，禁止用于长段落正文。
- **阴影是补充，边框是主角**：布局分隔优先 1px border；阴影只用于可点击卡片的 hover、弹窗与 toast。

### 2.3 主题切换

- 默认跟随系统 `prefers-color-scheme`；用户手动选择后写入 `localStorage.theme`（`light` / `dark`）。
- `index.html` 内联脚本在首屏渲染前给 `<html>` 加 `dark`，防止 FOUC；`stores/theme.ts` 负责运行时切换。**两处逻辑必须同步修改。**
- 所有 token 在 `:root` 与 `.dark` 中各定义一次，`@theme inline` 让 `bg-panel` 等工具类直接引用运行时变量，因此组件无需写 `dark:` 变体。
- 深色不是简单反相：深色底为近黑 `#09090b`，面板略亮 `#131316`，边框更克制；阴影更黑、更重。
- 新组件必须在两种主题下逐一检查，尤其是占位符、禁用态、虚线框、hover 和遮罩。

## 3. 字体与排版

### 3.1 字体

- 正文：系统无衬线字体栈（`-apple-system`、`Segoe UI`、`PingFang SC`、`Microsoft YaHei`、`Noto Sans SC` 等）。不加载 Web Font，保证中文首屏速度与离线可用。
- 等宽：`ui-monospace`、SF Mono、JetBrains Mono、Fira Code、Menlo、Consolas。
- 数学公式：KaTeX 默认字体，颜色继承正文。

### 3.2 字号与字重

| 场景 | 规格 |
| --- | --- |
| 页面主标题 | `text-2xl sm:text-3xl`，`font-bold`，`tracking-tight` |
| 品牌字 | `text-[17px]`，`font-bold`，`tracking-tight` |
| 卡片/区块标题 | `text-base` 或 `text-lg`，`font-semibold`，`tracking-tight` |
| 正文/说明 | `text-sm`；Markdown 正文 `0.975rem`，行高 `1.8` |
| 辅助信息 | `text-xs`，`text-muted` / `text-faint` |
| 微型标签 | `text-[11px]`，`font-semibold`，`uppercase`，`tracking-wider`，`text-faint` |
| 序号 | `text-xs font-bold text-faint`（如 `01` / `02`） |

- 中文长文必须给足行高：正文 1.7–1.8，卡片说明 1.6–1.7。
- 标题统一 `tracking-tight`；全大写英文微标签用 `tracking-wider`。
- 字重只用 regular / medium / semibold / bold；不要用 300 细体做「高级感」，中文小字号会发虚。
- 一屏内标题层级不超过三层；不要用字号小于 11px 的文字。

## 4. 形状、间距与层级

### 4.1 圆角

| 元素 | 圆角 |
| --- | --- |
| 卡片、上传区、内容面板、登录卡片 | `rounded-3xl`（24px） |
| 按钮、输入框、下拉、侧栏工作区项、工件列表项 | `rounded-2xl`（16px） |
| 小图标底、行内代码、列表项图标 | `rounded-xl`（12px） |
| 徽章、头像、圆形图标按钮 | `rounded-full` |
| 移动端弹窗 | 顶部 `rounded-t-3xl`，桌面端 `rounded-3xl` |

不使用 0–4px 的锐角，也不使用超过 24px 的「大圆角卡片」。

### 4.2 间距

- Tailwind 间距刻度（1 = 4px）：`1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8 / 10 / 12`。
- 页面容器：`px-5 py-8 sm:px-8 sm:py-10`，最大宽度 `max-w-5xl`。
- 认证页：`max-w-md`；空状态说明文字：`max-w-md`；空状态整体：`max-w-2xl`。
- 卡片内边距：紧凑 `p-4`，标准 `p-5`，宽松 `p-6 sm:p-8`。
- 区块间距：标题与内容 8，卡片网格 `gap-4`，列表 `space-y-2` 或 `space-y-5`。
- 留白是主要层级工具：宁可少放一个元素，也不要缩小间距塞内容。

### 4.3 边框

- 默认 `1px solid var(--border)`；全局 `* { border-color: var(--border) }` 已兜底。
- 强调/hover 用 `border-border-strong`。
- 空态、上传拖拽区用**虚线**；普通卡片不用虚线。
- 选中项通常 `border-transparent` + 反转底，避免边框与底色叠加。

### 4.4 阴影

| 工具类 | 用途 |
| --- | --- |
| `shadow-sm` | 主按钮、静态强调元素 |
| `shadow-card`（runtime `--shadow-md`） | 可点击卡片 hover、登录卡片 |
| `shadow-pop`（runtime `--shadow-lg`） | 弹窗、toast 等浮层 |

- 浅色阴影为低透明度暖黑；深色阴影更深更重。不要在组件内写自定义阴影。
- 静态卡片默认无阴影，靠边框；hover 才上浮并加阴影。

### 4.5 层级（z-index）

| 层级 | 用途 |
| --- | --- |
| `z-10` | 认证页内容 |
| `z-20` | 认证页主题切换 |
| `z-70` | 移动端抽屉遮罩 |
| `z-80` | 移动端侧栏抽屉 |
| `z-90` | Modal / ConfirmModal |
| `z-100` | Toast |

新元素必须复用该尺度，禁止 `z-[999]` 式随意值。

## 5. 布局

### 5.1 认证页（`AuthShell`）

- 全屏 `surface` 底，居中 `max-w-md` 内容，垂直居中，`anim-rise` 入场。
- **品牌时刻**：56px 反转圆角方块 + `GraduationCap` 图标；`MockFinal` 标题 + 「期末终极复习助手」副标题。
- 主卡片 `panel` 底、`rounded-3xl`、`border`、`shadow-card`，`p-6 sm:p-8`。
- 背景是全局唯一允许的装饰：34px 单色网格 + 顶部径向柔光（墨色 7%）+ 径向遮罩 + 2.5% 噪点。噪点与网格只出现在认证页，不进入应用主界面。
- 主题切换固定在右上角。
- 找回密码为三步：步骤点 + 连接线；已完成步骤反转，当前步骤墨色描边，未开始为 `border + faint`；步骤切换横向 12px 滑入。
- 表单错误块：`raised` 底 + `border-strong` + `AlertCircle` + 文案；不使用红色。

### 5.2 应用外壳（`AppLayout`）

- 桌面端：左侧固定 280px 侧栏（`panel`，右边框），右侧主区域 `surface`，`h-screen` 内部滚动，body 不滚动。
- 移动端（< `md`）：侧栏变抽屉（固定定位、`z-80`、200ms 位移），遮罩 `z-70`；顶部 56px 栏包含菜单、品牌、主题切换。
- 侧栏结构固定：品牌区 → 新建工作区（全宽 secondary 按钮）→「我的工作区」微标签 + 列表 → 底部用户区（头像首字母、用户名、主题、退出）。
- 工作区项：`rounded-2xl`、文件夹图标、名称 + 截断描述；激活项整块 `bg-invert text-invert-ink`，描述降为 70% 不透明度；hover 用 `raised`。
- 内容区最大宽度 `max-w-5xl`，居中；不允许横向滚动（表格、公式、Tab 栏除外）。

### 5.3 首页（工作区总览）

- 顶部问候语（`text-sm muted`）+ 主标题「选择要复习的科目」+ 工作区数量；右侧主按钮「新建工作区」。
- 网格：移动 1 列、`sm` 2 列、`lg` 3 列，`gap-4`。
- 工作区卡片：`rounded-3xl border bg-panel p-5`；hover 上移 2px、边框加强、`shadow-card`；图标底 44px，hover 时反转为 `bg-invert`；底部以细边框分隔时间与箭头。
- 新建卡片：虚线边框、居中的 `+` 与文案，hover 边框变 `ink`。
- 首次加载用 `raised` 骨架块（标题 + 3 张卡），不要用 spinner 占满页面。
- 无工作区时进入 `EmptyState`：大图标、标题、说明、主 CTA、三张「创建 → 上传 → 生成」步骤卡。

### 5.4 工作区页

- 头部 `panel` 底 + 底边框：微标签「工作区」、主标题、描述；右侧「生成」主按钮 + 编辑/删除 40px 描边图标按钮。
- 生成中：`Loader2` 旋转 + 阶段文案 + 6px 轨道，内部 1/3 宽反转条做不确定进度动画。
- Tab：图标 + 文案 + 数量徽章；激活为 `ink` 文字 + 底部 2px 反转下划线；数量徽章激活时反转。移动端允许横向滚动。
- 学习资料：上传区 + 资料列表。资料行 `rounded-2xl border bg-panel`，hover 边框加强；文件类型图标；状态徽章在 `sm` 以上显示在行内，移动端换行显示；失败原因用 `raised` 底小段文字。
- 工件：列表 + 内容双栏（`lg` 起），列表宽 288px；窄屏改为顶部横向滚动列表。内容卡片 `rounded-3xl`，头部含标题、生成时间、下载/删除。
- 弹窗（新建/编辑工作区）：`max-w-md`，底部右对齐操作按钮。

### 5.5 断点与容器

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
  - `primary`、`danger`：`bg-invert text-invert-ink`，hover 90% 不透明，`shadow-sm`；
  - `secondary`：`panel` 底 + 边框，hover `raised` + 边框加强；
  - `outline`：透明底 + `border-strong`；
  - `ghost`：无底无框，hover 才出现 `raised`。
- 尺寸：`sm` 36px / `md` 40px / `lg` 48px；图标按钮为同尺寸正方形。
- 圆角固定 `rounded-2xl`；`active:scale-[0.97]`；禁用时 45% 不透明且不可点击；加载时用旋转图标替换左侧图标，文字保留。
- 纯图标按钮必须提供 `aria-label` 与 `title`。

### 6.2 输入与表单（`AppInput`）

- 高度 44px，`rounded-2xl`，`panel` 底，1px 边框，placeholder 用 `faint`。
- focus：边框变 `ink`，不添加额外外发光；全局 `:focus-visible` 提供 2px 墨色 outline。
- 错误：边框 `border-strong` + 下方 `AlertCircle` + `text-xs` 墨色文案；不使用红色。
- 密码框带显示/隐藏眼睛图标；下拉自绘箭头；textarea 可纵向调整。
- 标签 `text-sm font-medium`；必填星号用 `muted`。
- 表单错误块统一为 `rounded-2xl border border-border-strong bg-raised px-3.5 py-2.5`。

### 6.3 弹窗（`Modal` / `ConfirmModal`）

- 遮罩 `bg-overlay`；桌面居中，移动端底部弹出、顶部圆角。
- 卡片 `panel` + `border` + `shadow-pop`，`anim-pop` 入场；最大高度 92vh，内容区独立滚动，头尾固定。
- 标题 `text-lg font-semibold tracking-tight`；描述 `text-sm muted`；右上角圆形关闭按钮。
- Escape 关闭；打开时锁定 body 滚动；提交中禁止点击遮罩关闭。
- 确认弹窗：警告图标底（`raised` 圆形）、标题、说明（明确写出不可撤销后果）、取消 + 危险/主操作；按钮顺序桌面右对齐、移动端纵向反转。
- 已知边界：当前未实现焦点陷阱（focus trap）；涉及弹窗可访问性改造时作为独立任务处理，并同步本文件。

### 6.4 Toast（`ToastHost`）

- 顶部居中，`max-w-sm`，`panel` 卡片 + `border` + `shadow-pop`，图标 + 文案 + 关闭。
- success / error 图标均为墨色；error 仅用 `border-strong` 区分；info 图标用 `muted`。
- 自动消失：success/info 3.2s，error 4.5s；移动端不遮挡主操作。
- 容器 `aria-live="polite"`；入场从 -14px 下移 + 0.96 缩放，离开 180ms。
- 文案只传达结果与下一步，不堆叠技术细节。

### 6.5 状态徽章（`StatusBadge`）

- `rounded-full border px-2.5 py-0.5 text-xs`，图标 14px。
- 已就绪：反转底；索引中：`raised` 底 + 旋转图标；失败：`panel` 底 + `border-strong`；排队中：`panel` 底 + `muted` 文字。

### 6.6 上传区（`UploadZone`）

- 大面积 2px 虚线框，`rounded-3xl`，`panel` 底；hover 边框变 `ink`、底色变 `raised`。
- 56px 图标底；拖拽进入时图标反转为墨底白图标并 `scale-110`；文案切换为「松开鼠标即可上传」。
- 支持多选；队列项显示文件名、大小、状态、进度；进度条 6px、反转色、200ms 宽度过渡。
- 成功后停留 1.8s 自动移除；失败提供重试与移除。
- 文件名过长必须截断，进度与错误文案不得撑破布局。

### 6.7 列表与空态

- 列表行统一 `rounded-2xl border bg-panel`，hover `border-strong`；行内操作按钮为 32px 圆形 ghost。
- 空态：居中、`py-12` 以上；48–80px 图标底、`Sparkles/Inbox/FolderOpen` 图标、`text-sm muted` 说明；有明确下一步时给主 CTA。
- 骨架屏用 `bg-raised` + `animate-pulse`，形状与真实内容一致；不要用骨架屏伪装成内容。

### 6.8 Markdown 与公式

- `.markdown-body`：0.975rem / 1.8；h1 1.75rem、h2 1.4rem、h3 1.175rem；h1/h2 带底部细边框。
- 链接：墨色 + 下划线，下划线颜色 `border-strong`，hover 变 `ink`。
- 引用：`raised` 底 + 左侧 3px `border-strong` + 右侧圆角。
- 行内代码：`code-bg` 底 + 边框 + 等宽；代码块 1rem 圆角、可横向滚动。
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
| 220–240ms | 弹窗、toast 入场 |
| 400ms | 页面/卡片首次入场（`anim-rise`） |
| 0.9s / 1.3s / 1.4s | 旋转 / 不确定进度 / 呼吸骨架（仅加载） |

- 入场缓动：`cubic-bezier(0.22, 1, 0.36, 1)`；离场用 `ease`；旋转用 `linear`。
- 位移幅度克制：页面切换 6px、卡片 hover 2px、步骤切换 12px、toast 入场 14px。
- 按钮按下 `scale(0.97)`；卡片 hover 才上浮，静态卡片不动。
- 禁止：弹跳、过冲、旋转装饰、无限循环的非加载动画、背景视差。

### 7.2 可访问性

- 当前代码尚未全局处理 `prefers-reduced-motion`。**新增或修改动画时**必须提供减弱策略（如 `@media (prefers-reduced-motion: reduce)` 下禁用位移与循环动画）；全仓库统一补齐应作为独立任务，不要声称已完成。

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

> 本文内部沿用「工件」指代 artifact（对应表 `artifacts`）；它只存在于文档与代码，不应出现在用户界面文案中。

- 错误文案来自后端 `detail` 时直接展示，不二次包装成英文；前端兜底文案也要中文。

## 9. 可访问性

- 对比度：正文只用 `ink`；`muted`/`faint` 不承载关键信息；禁用态不低到不可读。
- 键盘：所有按钮/输入可 Tab 到达；上传区支持 Enter/Space；弹窗支持 Escape；移动抽屉有明确关闭方式。
- 焦点：全局 `:focus-visible` 为 2px 墨色 outline、offset 2px；不要用 `outline: none` 除非提供等价可见反馈。
- 语义：弹窗 `role="dialog"` + `aria-modal`；toast `aria-live`；图标按钮 `aria-label`；表单 label 通过 `useId` 绑定。
- 状态不能只靠颜色：图标 + 文案 + 形状至少两者同时表达。
- 触控目标不小于 32px，主操作不小于 40px。
- 已知边界：Modal 尚未实现焦点陷阱；新增相关能力时按独立任务推进并更新本文件。

## 10. 响应式与移动端

- 优先保证阅读宽度：内容区最大 `max-w-5xl`，长文本行宽不超过约 80 个中文字符。
- 移动端不使用 hover 作为唯一操作入口；行内操作按钮必须常驻或可发现。
- 表格、公式、Tab 栏允许自身横向滚动，但页面主体不能横向溢出。
- 弹窗在移动端从底部出现，按钮可纵向堆叠；toast 不遮挡顶部导航。
- 深色模式在移动端必须同样检查（OLED 近黑背景下边框容易消失，必要时用 `border-strong`）。

## 11. 新页面 / 新组件检查表

- [ ] 先问「用户来这里要完成什么」，从内容和操作出发，不先挑样式；
- [ ] 优先复用 `AppButton` / `AppInput` / `Modal` / `Toast` / `StatusBadge`，不另造平行组件；
- [ ] 只用语义 token，没有裸色值、裸阴影、裸 z-index；
- [ ] 浅色与深色都检查：边框、hover、禁用、占位符、遮罩；
- [ ] 覆盖加载、空态、错误、成功四种状态；长文件名/长标题不撑破布局；
- [ ] 375 / 768 / 1280 三个宽度可用，无页面横向滚动；
- [ ] 键盘可操作，图标按钮有 `aria-label`，状态不只靠颜色；
- [ ] 文案符合第 8 节，删除类操作说明后果；
- [ ] 动效符合第 7 节，新增动画考虑 reduced-motion；
- [ ] 若是新视觉模式（而非既有模式的组合），先更新本文件再实现。

## 12. 设计变更流程

### 12.1 小型、增量改动

- 在普通 `feat` / `fix` 分支内完成；不改变整体气质、不新增设计模式。
- 若新增了可复用的 token、组件规格或交互模式，在同一原子任务中更新 `DESIGN.md`。

### 12.2 大规模视觉改版

- 从最新 `main` 切出 `design/<名称>` 分支，例如 `design/editorial-v2`。
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
| 颜色、阴影、圆角、字体、动画、Markdown 排版、滚动条、焦点样式 | `frontend/src/style.css` |
| 认证页网格/噪点背景 | `frontend/src/components/AuthShell.vue` |
| 按钮、输入、弹窗、toast、状态徽章 | `frontend/src/components/AppButton.vue`、`AppInput.vue`、`Modal.vue`、`ConfirmModal.vue`、`ToastHost.vue`、`StatusBadge.vue` |
| 应用外壳与侧栏 | `frontend/src/layouts/AppLayout.vue`、`components/Sidebar.vue` |
| 首页、工作区页、空态 | `frontend/src/views/HomeView.vue`、`WorkspaceView.vue`、`EmptyState.vue` |
| 上传、资料、工件、Markdown | `frontend/src/components/UploadZone.vue`、`MaterialList.vue`、`ArtifactPanel.vue`、`MarkdownView.vue` |
| 主题切换与代码高亮主题 | `frontend/src/components/ThemeToggle.vue`、`stores/theme.ts`、`lib/highlight.ts` |
| 品牌标记 | `frontend/public/favicon.svg`、`index.html` |
