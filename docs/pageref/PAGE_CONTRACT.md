# PAGE_CONTRACT.md · PageRef 页面契约 v0.1

> 状态：P0 草案（基线日期 2026-11-07）。方案来源为仓库根目录 `../../Plan.md` 的 §7（页面契约与运行时）、§6.3、§6.8、§11.1、§17；本文件把 Plan 的结论整理成 Builder、Validator 与前端阅读器可以直接执行的规范。
> 本文件与 `../../Plan.md` 冲突时以 `../../Plan.md` 为准，并在同一任务中修正本文件。任何字段、版本号、CSP 指令、sandbox 属性或校验规则的改动，都必须同步 `../../Plan.md`、Validator 实现与前端 `pageShell` 实现，并按第 12 节提升版本号。
> 本文件不描述 Deck 业务、后端数据库或 AI 助手接口；这些内容见 `../../Plan.md` §8、§10。

## 1. 契约范围与角色

| 角色 | 职责 | 不在本契约内 |
| --- | --- | --- |
| Builder（Pi Harness） | 按 PageBrief 生成一个 PageBundle；只写文件，不执行页面代码 | 页面存储、鉴权、Deck 编排 |
| Validator | 对 PageBundle 做静态检查与 Playwright 浏览器校验，返回结构化报告 | 最终业务门禁决策（由后端调用并判定） |
| 前端阅读器 | 组装 shell、创建 sandbox iframe、注入 runtime、处理 postMessage、控制翻页与主题 | 生成页面内容 |
| 主 API | 存储 bundle、触发构建/校验、执行 fail-closed 门禁、下发 bundle | 执行页面代码 |

唯一判定标准：**Validator 的静态与浏览器检查结果**。Builder 的自检报告只供修复参考，不能替代最终校验（`../../Plan.md` §7.6）。

## 2. 版本概念

| 版本号 | 当前值 | 归属 | 含义 |
| --- | --- | --- | --- |
| `schema_version` | `"1.0"` | Bundle 与 Manifest 结构 | Bundle 字段与 Manifest 字段的结构版本 |
| `runtime_version` | `"1.0.0"` | 宿主 runtime（`runtime.js` 与 shell） | 页面可依赖的运行时 API 版本 |
| `harness_version` | P2 起始 `0.1.0` | Skill、Prompt Template、Extension、模板集合 | 构建规则集合的版本，与 bundle 结构解耦 |

三者在 `../../Plan.md` §7.8 中明确为独立版本号。`harness_version` 的落地形式（清单文件或构建信息）在 P2 确定，本版不引入额外文件。兼容与升级规则见第 12 节。

## 3. PageBundle 契约

### 3.1 顶层字段

Bundle 是单个 JSON 对象，不含目录、不含外部资源。

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `schema_version` | string | 是 | 必须为 `"1.0"`；主版本不匹配时宿主拒绝渲染 |
| `runtime_version` | string | 是 | 页面依赖的运行时版本，当前 `"1.0.0"` |
| `manifest` | object | 是 | 见第 4 节 |
| `html` | string | 是 | 只能是 body 片段；禁止标签见第 5.1 节 |
| `css` | string | 是 | 允许空字符串；禁止项见第 5.2 节 |
| `js` | string | 是 | 允许空字符串；禁止项见第 5.3 节；必须通过 Runtime API 与宿主交互 |

- 大小：序列化为 UTF-8 后总字节数不超过 `2097152`（2 MiB，可配置项 `DECK_MAX_BUNDLE_BYTES`）。超限直接失败，不做截断。
- 编码：UTF-8，无 BOM。
- 资源：图片、图标、字体只能内联（内联 SVG 或 `data:` URI）；不允许任何相对路径或绝对 URL 资源。
- 运行时：`runtime.js` 由宿主注入，**不包含在 bundle 中**；bundle 只依赖 `window.MockFinal`。
- 组装转义：宿主把 `html`、`css`、`js` 写入 shell 时必须转义 `</script`、`</style` 序列，防止生成内容提前闭合标签（`../../Plan.md` §7.4）。静态检查同时拒绝这类序列。

### 3.2 最小示例（可复制）

```json
{
  "schema_version": "1.0",
  "runtime_version": "1.0.0",
  "manifest": {
    "schema_version": "1.0",
    "page_id": "page_bisect_001",
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
        "label": "逐步执行二分，观察区间收缩",
        "smoke": {
          "action": "click",
          "selector": "[data-mp-action='step']",
          "expect": "[data-mp-state='hit']"
        }
      }
    ],
    "source_refs": [
      {
        "material_id": 3,
        "section_id": 102,
        "quote": "循环不变式是：若目标存在，其下标一定在当前闭区间内。"
      }
    ],
    "assistant": {
      "summary": "本页讲解二分查找的区间不变量与复杂度。",
      "key_facts": ["循环不变量", "O(log n)", "边界条件"],
      "suggested_questions": ["为什么 mid 要向下取整？", "什么时候会死循环？"]
    },
    "a11y": { "reduced_motion": true }
  },
  "html": "<div class=\"mp-page\"><h1>二分查找</h1><p>每次排除一半。</p><button data-mp-action=\"step\">下一步</button></div>",
  "css": ".mp-page { height: 100%; display: grid; place-content: center; gap: 12px; }",
  "js": "MockFinal.ready({ title: '二分查找' });\ndocument.querySelector('[data-mp-action=\"step\"]').addEventListener('click', () => { MockFinal.emit('interaction', { id: 'bisect-demo' }); });"
}
```

## 4. Manifest 契约

### 4.1 字段表

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| `schema_version` | string | 是 | `"1.0"` |
| `page_id` | string | 是 | 与 PageBrief 的 `page_id` 一致，稳定不变 |
| `title` | string | 是 | 页面标题，纯文本，不含 HTML |
| `subtitle` | string | 否 | 一句话副标题，纯文本 |
| `knowledge_point_ids` | string[] | 是 | 至少 1 个；来自大纲阶段，不得编造 |
| `importance` | string | 是 | 已知取值：`core`；其余取值由 P2 规划契约冻结 |
| `estimated_minutes` | number | 是 | 正整数，阅读页预计分钟数 |
| `layout` | string | 是 | 布局元数据，供总览与生成参考，不限制自由布局 |
| `interactions` | object[] | 是 | 见 4.2；非交互页也必须给出声明 |
| `source_refs` | object[] | 是 | 见 4.3；页面不得编造引用 |
| `assistant` | object | 否 | `summary`、`key_facts[]`、`suggested_questions[]`，供 AI 助手使用 |
| `a11y` | object | 是 | 本版只要求 `reduced_motion: true` |

字段长度上限在 P2 实现 Validator 时冻结，见第 13 节。本版不得以“未定义上限”为由放行超大字段。

### 4.2 interactions 与 smoke

```json
{
  "id": "bisect-demo",
  "type": "simulation",
  "label": "逐步执行二分，观察区间收缩",
  "smoke": {
    "action": "click",
    "selector": "[data-mp-action='step']",
    "expect": "[data-mp-state='hit']"
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `id` | 页面内唯一，`[a-z0-9-]+` |
| `type` | 非空字符串；已知取值 `simulation`、`none`，其余由 P2 扩展 |
| `label` | 面向用户的中文动作说明 |
| `smoke` | 必填的自动冒烟步骤；`type: "none"` 的页面也必须给出可执行或显式空的冒烟声明 |
| `smoke.action` | `click`、`input`、`step` 之一 |
| `smoke.selector` | 合法 CSS 选择器，必须能在页面内匹配到元素 |
| `smoke.expect` | 合法的选择器或状态描述；执行动作后必须出现或状态发生变化 |
| `smoke.value` | `input` 动作的输入值；P2 冻结是否必填 |

- 非总结页（Non-summary）至少有一个真实交互；总结页可声明 `type: "none"`。
- 冒烟步骤必须确定、可重复，不依赖时间随机性、鼠标轨迹或外部条件。
- 选择器统一使用 `data-mp-action`、`data-mp-state` 等 `data-mp-*` 属性，样式类名不能作为冒烟契约。

### 4.3 source_refs

```json
{ "material_id": 3, "section_id": 102, "quote": "循环不变式是：若目标存在，其下标一定在当前闭区间内。" }
```

- `section_id` 来自大纲阶段的资料分节；后端负责解析为实际段落。
- `quote` 必须是来源段落中的原文片段或忠实摘要，不得改写事实、不得编造页码或文献。
- 引用无效时由后端标记 `unverified`，页面不得自行补造引用（`../../Plan.md` §8.6）。

## 5. 页面 HTML / CSS / JS 禁止清单

静态检查必须覆盖本节全部条目；浏览器检查作为第二道防线。禁止项按 `../../Plan.md` §7.1、§7.6、§11.1 整理。

### 5.1 HTML 禁止清单

- 禁止标签：`<html>`、`<head>`、`<body>`、`<script>`、`<style>`、`<link>`、`<base>`、`<iframe>`、`<object>`、`<embed>`、`<meta>`、`<form>`。
- 禁止内联事件属性：`onclick`、`onload` 等一切 `on*` 属性；允许的交互绑定统一走 `data-mp-*` 属性加 `page.js` 事件监听。
- 禁止 `javascript:`、`vbscript:`、`data:text/html` 形式的 URL。
- 禁止外部 URL：`href`、`src`、`srcset`、`poster`、`action`、`formaction`、`xlink:href` 中出现 `http:`、`https:`、`//` 或相对路径。`href="#..."` 仅允许页内锚点。
- 禁止 `target` 属性、`srcdoc`、`download`、`ping`。
- 禁止 `<a>` 指向外部站点；页面内导航只能通过 `MockFinal.next()`、`MockFinal.prev()` 请求宿主翻页。
- `<svg>` 允许内联使用；SVG 内的 `<script>`、`<foreignObject>`、外部 `xlink:href` 一律禁止。
- 禁止输出 `</script`、`</style`、`<!--` 等可能破坏 shell 结构的序列。

### 5.2 CSS 禁止清单

- 禁止 `@import`。
- 禁止 `url(http://…)`、`url(https://…)`、`url(//…)`、相对路径 `url(…)`；只允许 `url(data:…)` 或页面内引用（如 `url(#gradient-id)`）。
- 禁止外部字体；`@font-face` 只能使用 `data:` URI，并计入 2 MiB 总预算。
- 禁止 `position: fixed` 遮挡宿主导航；如确需固定定位，只能固定在页面 stage 内，并接受 `POSITION_FIXED` 警告（`../../Plan.md` §7.6 可选项）。
- 禁止在可见元素上声明 `overflow: auto`、`overflow: scroll`（零滚动要求，见第 9 节）。
- 禁止 `behavior`、`-moz-binding`、`expression()` 等历史脚本化 CSS。
- 颜色、圆角、阴影只能使用第 6.2 节的 `--mp-*` 运行时变量或 `currentColor`、透明色；不得写裸色值（与 `../../DESIGN.md` 一致）。

### 5.3 JS 禁止清单

- 网络：`fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon`、`import()`、动态 `importScripts`。
- 动态代码：`eval`、`new Function`、`setTimeout(string)`、`setInterval(string)`、`document.write`、`document.writeln`。
- 存储与凭据：`document.cookie`、`localStorage`、`sessionStorage`、`indexedDB`、`caches`、`navigator.credentials`、`navigator.clipboard`。
- 父窗口与跨框架：`window.parent`、`window.top`、`window.opener`、`frames`、`window.open`、`postMessage` 直连（只能通过 `MockFinal` 封装）。
- 动态注入：创建或修改 `<script>`、`<link>`、`<iframe>`、`<object>`、`<embed>` 元素。
- 其他：`Worker`、`SharedWorker`、`ServiceWorker`、`window.location` 赋值、`document.domain`、`window.name`。
- 允许：DOM 查询与修改、事件监听、`requestAnimationFrame`、`setTimeout` / `setInterval`（必须可清理）、`Math`、`Intl`、`CanvasRenderingContext2D`、内联 SVG 操作。

宿主与 Validator 对 JS 的静态检查基于 AST 或等价规则，不能只靠字符串匹配；混淆写法同样视为违规。

## 6. Runtime API

### 6.1 API 清单

宿主 shell 注入 `runtime.js`，页面只能使用以下 7 个方法（`../../Plan.md` §7.3）：

| 方法 | 签名 | 行为 | 规则 |
| --- | --- | --- | --- |
| `MockFinal.ready` | `ready({ title })` | 声明页面可交互；runtime 通知宿主 | 每个页面必须且只能调用一次；调用前不得执行依赖布局的交互 |
| `MockFinal.emit` | `emit(type, payload)` | 发送交互、进度或完成事件 | `type` 为字符串；`payload` 必须可 JSON 序列化；单事件文本上限 4 KB |
| `MockFinal.next` | `next()` | 请求宿主翻到下一页 | 宿主可忽略（最后一页或 Validator 环境） |
| `MockFinal.prev` | `prev()` | 请求宿主翻到上一页 | 同上 |
| `MockFinal.requestAssistant` | `requestAssistant(quote?)` | 请求宿主打开 AI 助手侧栏 | `quote` 为可选字符串，建议不超过 2 KB；没有选区时不传 |
| `MockFinal.getTheme` | `getTheme()` | 返回 `{ mode, tokens, reducedMotion }` | `mode` 为 `light` 或 `dark`；`tokens` 为只读语义色；`reducedMotion` 为布尔 |
| `MockFinal.onHostMessage` | `onHostMessage(fn)` | 订阅宿主消息 | 返回取消订阅函数；`fn` 接收 `{ type, payload }` |

`emit` 的 `type` 在 v0.1 预留：`interaction`、`progress`、`complete`。新增类型必须先在契约中登记，避免宿主与 Validator 漂移。

`onHostMessage` 的消息类型：`theme`（主题变化）、`pause`（页面不可见或宿主暂停）、`resume`（恢复）、`quote`（助手引用文本）。页面收到 `pause` 必须暂停动画与计时器，收到 `resume` 后恢复；`theme` 到达后必须重新读取 `getTheme()`。

### 6.2 运行时变量与主题

宿主在 shell 中定义如下 CSS 变量，页面只允许引用这些变量（名称在 P2 与 `runtime.js` 同步冻结）：

| 变量 | 映射 | 用途 |
| --- | --- | --- |
| `--mp-surface` | `--surface` | 页面最底层底色 |
| `--mp-panel` | `--panel` | 纸面 stage 底色 |
| `--mp-raised` | `--raised` | 次级分区、图底 |
| `--mp-border` | `--border` | 默认边框、分割线 |
| `--mp-border-strong` | `--border-strong` | 强调边框、虚线框 |
| `--mp-ink` | `--ink` | 主文字、图形主色 |
| `--mp-muted` | `--muted` | 次级说明 |
| `--mp-faint` | `--faint` | 序号、极次要信息 |
| `--mp-invert` | `--invert` | 反转强调块、选中态 |
| `--mp-invert-ink` | `--invert-ink` | 反转块上的文字 |
| `--mp-code-bg` | `--code-bg` | 行内代码、代码块 |
| `--mp-font-sans` | 系统无衬线栈 | 正文 |
| `--mp-font-mono` | 系统等宽栈 | 代码、数字 |

主题由宿主通过 `<html data-mp-theme="light|dark">` 切换；页面不得自行读取 `prefers-color-scheme` 决定颜色，只能通过 `getTheme()` 或 CSS 变量响应。

### 6.3 页面脚本示例

```js
const root = document.querySelector('.mp-page');
const stepButton = root.querySelector('[data-mp-action="step"]');

function renderStep(step) {
  root.dataset.mpState = step.hit ? 'hit' : 'searching';
  root.querySelector('[data-mp-role="range"]').textContent = `[${step.left}, ${step.right}]`;
}

stepButton.addEventListener('click', () => {
  const nextStep = computeNextStep();
  renderStep(nextStep);
  MockFinal.emit('interaction', { id: 'bisect-demo', step: nextStep.index });
});

MockFinal.onHostMessage(({ type }) => {
  if (type === 'pause') pauseAnimation();
  if (type === 'resume') resumeAnimation();
  if (type === 'theme') renderStep(currentStep);
});

MockFinal.ready({ title: '二分查找：每次排除一半' });
```

### 6.4 runtime 的宿主职责

runtime 必须实现以下能力，页面不得重复实现：

- 选区监听：`selectionchange` → `{ text, rect, blockText }` → 通过 postMessage 上报宿主。
- 错误捕获：`window.onerror`、`unhandledrejection` → 上报宿主与 Validator。
- 尺寸上报：`ResizeObserver` → 宿主；页面可使用 `100dvh` 与容器查询。
- 键盘：翻页快捷键由宿主处理；焦点在 iframe 内时，runtime 转发未处理的 ←/→/空格/PageUp/PageDown 导航键（表单控件与按钮上的空格除外）；页面只为自身交互注册必要的键盘事件。
- 降低动效：根据 `prefers-reduced-motion` 与宿主消息设置 `data-mp-reduced-motion="true"`，页面动画必须在该属性存在时降级。
- 就绪标记：`ready()` 被调用后，在 `<html>` 上设置 `data-mp-ready="true"`，供 Validator 等待。
- 禁止能力：runtime 自身也不提供网络、存储、父窗口访问能力。

## 7. Shell 与 CSP

### 7.1 Shell 组装模板（可复制）

```html
<!doctype html>
<html lang="zh-CN" data-mp-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <style>
    /* reset + 语义 token 映射 + runtime base，由宿主统一维护 */
    :root {
      color-scheme: light;
      --mp-surface: #f4f4f5;
      --mp-panel: #ffffff;
      --mp-raised: #fafafb;
      --mp-border: #e4e4e7;
      --mp-border-strong: #d4d4d8;
      --mp-ink: #16161a;
      --mp-muted: #6b6b73;
      --mp-faint: #9a9aa2;
      --mp-invert: #16161a;
      --mp-invert-ink: #ffffff;
      --mp-code-bg: #f4f4f5;
      --mp-font-sans: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
      --mp-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    }
    html[data-mp-theme="dark"] {
      color-scheme: dark;
      --mp-surface: #09090b;
      --mp-panel: #131316;
      --mp-raised: #1c1c20;
      --mp-border: #26262b;
      --mp-border-strong: #3a3a41;
      --mp-ink: #f5f5f6;
      --mp-muted: #a0a0a8;
      --mp-faint: #6e6e77;
      --mp-invert: #f5f5f6;
      --mp-invert-ink: #09090b;
      --mp-code-bg: #0e0e11;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; overflow: hidden; background: var(--mp-panel); color: var(--mp-ink); font-family: var(--mp-font-sans); }
    #mp-root { height: 100dvh; overflow: hidden; }
  </style>
  <style>
    /* page.css 注入位置 */
  </style>
</head>
<body>
  <div id="mp-root">
    <!-- page.html 注入位置（只能是 body 片段） -->
  </div>
  <script>
    window.__MP_CHANNEL__ = "在此注入每次 iframe 独立的随机 channel";
    /* runtime.js 注入位置（宿主注入，bundle 不包含） */
  </script>
  <script>
    /* page.js 注入位置 */
  </script>
</body>
</html>
```

### 7.2 CSP 约束

- CSP 指令必须与 `../../Plan.md` §7.4 完全一致：`default-src 'none'`；`script-src 'unsafe-inline'`；`style-src 'unsafe-inline'`；`img-src data:`；`font-src data:`；`media-src data:`；`connect-src 'none'`；`frame-src 'none'`；`object-src 'none'`；`base-uri 'none'`；`form-action 'none'`。
- 不使用 `'self'`、不使用外部域名白名单、不加 `allow-same-origin` 相关放宽。
- `unsafe-inline` 是内联 runtime 与内联样式所必需；页面不得利用它插入外部脚本，Validator 负责拦截。
- CSP meta 必须位于 `<head>` 内、任何页面内容之前。
- 前端阅读器与 Validator 必须复用同一份 `pageShell` 实现或同一构建产物，固定 `runtime_version`，避免“校验通过、真实渲染漂移”（`../../Plan.md` §7.4）。

### 7.3 组装与转义

1. 校验 bundle JSON 结构与大小。
2. 校验 `runtime_version` 是否在本宿主支持范围内。
3. 对 `js` 中的 `</script` 序列替换为 `<\/script`；对 `css` 中的 `</style` 序列替换为 `<\/style`。
4. HTML 片段中若出现禁止标签或 `</script`、`</style` 序列，直接判失败，不做静默清洗后放行。
5. 注入顺序固定：reset/token base → `page.css` → `#mp-root` + `page.html` → channel → `runtime.js` → `page.js`。
6. 组装完成后不得再拼接未经校验的字符串。

## 8. iframe 沙箱与宿主通信

### 8.1 iframe 配置

```html
<iframe
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
  title="复习页：二分查找"
  srcdoc="<!doctype html>..."></iframe>
```

| 属性 | 要求 |
| --- | --- |
| `sandbox` | 只能是 `allow-scripts`；**禁止**添加 `allow-same-origin`、`allow-downloads`、`allow-modals`、`allow-popups`、`allow-forms`、`allow-top-navigation` |
| `referrerpolicy` | `no-referrer` |
| `allow` | 不设置任何权限（摄像头、麦克风、剪贴板、全屏等一律不授予） |
| 页面来源 | 只能通过 `srcdoc` 注入；禁止用 URL 加载 bundle，避免鉴权与缓存泄露 |
| 生命周期 | 加载超时默认 10 秒，超时显示错误卡片；iframe 卡死时销毁并重建；销毁时移除全部监听器并作废 channel |

### 8.2 消息信封

宿主与页面之间的所有消息使用同一信封：

```json
{ "channel": "9f2c…（每次 iframe 独立的 32 位十六进制字符串）", "type": "ready", "payload": {} }
```

- channel 由宿主用 `crypto.getRandomValues` 生成，至少 128 位随机；每次创建 iframe 重新生成，不得复用。
- channel 通过 shell 内联变量注入 runtime，runtime 读取后保存在闭包中并从全局删除；不得写入 DOM 属性。
- 页面 → 宿主类型：`ready`、`event`、`request_next`、`request_prev`、`request_assistant`、`runtime_error`、`selection`、`resize`。
- 宿主 → 页面类型：`theme`、`pause`、`resume`、`quote`。
- 单条消息 payload 序列化后不超过 4 KB；超出直接丢弃并记 `MESSAGE_TOO_LARGE`。

API 到信封类型的映射：

| Runtime API | 信封 `type` | `payload` |
| --- | --- | --- |
| `MockFinal.ready({ title })` | `ready` | `{ title }` |
| `MockFinal.emit(type, payload)` | `event` | `{ type, payload }`；内层 `type` 为 `interaction` / `progress` / `complete` |
| `MockFinal.next()` | `request_next` | `{}` |
| `MockFinal.prev()` | `request_prev` | `{}` |
| `MockFinal.requestAssistant(quote?)` | `request_assistant` | `{ quote? }` |
| runtime 捕获到错误 | `runtime_error` | `{ message, source, line, column }`，message 截断到 1 KB |
| runtime 选区变化 | `selection` | `{ text, rect, blockText }`，text 截断到 2 KB |
| runtime 尺寸变化 | `resize` | `{ width, height }` |

### 8.3 校验规则（双向）

宿主接收消息时必须依次校验：

1. `event.source === iframe.contentWindow`；不满足直接丢弃。
2. `event.data` 是对象，且 `event.data.channel` 与宿主保存的 channel 相等。
3. `event.data.type` 在页面 → 宿主白名单内。
4. payload 结构与大小符合约定；不执行、不 `eval`、不把内容拼进 HTML。

页面接收消息时必须校验：

1. `event.source === window.parent`。
2. channel 相等。
3. `type` 在宿主 → 页面白名单内。

注意：sandbox iframe 的源是 opaque origin，`event.origin` 为字符串 `"null"`，不能作为身份依据；身份边界由 `event.source` 与 channel 共同保证。任何一端校验失败都不得回退到“宽松模式”。

### 8.4 时序

```text
宿主创建 channel
  → 组装 shell + srcdoc
  → iframe 加载
  → runtime 初始化并订阅 message
  → page.js 调用 MockFinal.ready({ title })
  → runtime 发送 { type: "ready" }，并设置 data-mp-ready="true"
  → 宿主标记页面就绪，发送 theme
  → 页面交互，emit / requestAssistant / next / prev
  → 宿主销毁 iframe 时作废 channel
```

Validator 等待就绪的方式：优先等待 `MockFinal.ready` 产生的消息或 `<html data-mp-ready="true">`，超时 10 秒判 `READY_TIMEOUT`。

## 9. 零滚动布局要求

### 9.1 硬性规则

- 页面根元素（`.mp-page` 或 `#mp-root` 的直接子元素）：`height: 100dvh; overflow: hidden;`。
- 推荐骨架：`display: grid; grid-template-rows: auto 1fr auto;`，中间区域自适应，底部操作区固定高度。
- 字号与间距使用 `clamp()`、`minmax()`、`fr`、容器查询；禁止用固定大 px 堆内容。
- 内容预算：每页 1 个核心观点、3–5 个内容块、1 个主交互；正文建议不超过 250 个中文字符（不含图注与公式）。
- 复杂知识点优先拆页（最多 3 页），不得靠缩小字号硬塞。
- 最小字号 11px（与 `../../DESIGN.md` 一致）；长标题、长公式、长数字必须换行或缩放，不得撑破容器。
- 移动端不承诺零滚动：小于 768 宽降级为阅读模式，允许纵向滚动；页面不得因此依赖滚动才能完成主交互。

### 9.2 验收视口

| 视口 | 目标 | 失败级别 |
| --- | --- | --- |
| 1280×720 | 必须零滚动 | error |
| 1440×900 | 必须零滚动 | error |
| 1920×1080 | 必须零滚动 | error |
| 1254×638 / 1414×818 / 1894×998（阅读器实际内容区：窗口减去 56px 头部、24px 内边距与 2px 边框） | 必须零滚动 | error |
| 1024×768 | 零滚动为目标（缩放提示场景） | warning，必须记录 |

> Validator 始终把三档桌面视口与阅读器内容视口并入请求视口，调用方不能通过 `viewports` 移除硬门禁。

### 9.3 测量方法

对每个视口，在新 browser context 中加载 shell，等待 ready 后测量：

```text
document.documentElement.scrollWidth  <= document.documentElement.clientWidth  + 1
document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1
#mp-root.scrollWidth  <= #mp-root.clientWidth  + 1
#mp-root.scrollHeight <= #mp-root.clientHeight + 1
```

同时遍历可见元素：计算样式为 `overflow-y: auto|scroll` 且 `scrollHeight > clientHeight + 1` 的，判 `ZERO_SCROLL_INNER_SCROLL`。隐藏元素（`display: none`、`visibility: hidden`）不参与测量。

## 10. 静态与浏览器校验规则

### 10.1 静态检查

| 检查 | 失败码 |
| --- | --- |
| Bundle JSON 可解析、字段齐全、类型正确、UTF-8 无 BOM | `BUNDLE_SCHEMA_INVALID` |
| 总字节数 ≤ 2 MiB | `BUNDLE_TOO_LARGE` |
| Manifest 必填项、枚举值、`source_refs` 引用 ID 存在 | `MANIFEST_INVALID` |
| HTML 禁止标签与属性、`javascript:` URL、外部 URL | `HTML_FORBIDDEN_TAG` / `HTML_FORBIDDEN_ATTR` / `HTML_EXTERNAL_URL` |
| HTML/CSS/JS 中的 `</script`、`</style`、`<!--` 逃逸序列；HTML 中的 `<script>/<style>/<iframe>/<object>/<embed>/<link>/<form>` 标签 | `SHELL_ESCAPE_SEQUENCE` |
| JS 把外部/相对 URL 赋给 `href/src/srcset/poster/action/formaction`，或通过 `setAttribute`/`assign`/`replace` 使用外部 URL | `JS_FORBIDDEN_API` |
| CSS `@import`、外部 `url()`、`position: fixed` | `CSS_EXTERNAL_URL` / `POSITION_FIXED`（警告） |
| JS 禁止 API（网络、存储、eval、父窗口、动态注入） | `JS_FORBIDDEN_API` |
| smoke 选择器语法与 `action` 枚举 | `SMOKE_INVALID` |
| 冒烟选择器在静态 HTML 中是否存在（可静态判断的部分） | `SMOKE_SELECTOR_NOT_FOUND` |

### 10.2 浏览器检查（Playwright）

| 检查 | 失败码 | 级别 |
| --- | --- | --- |
| 加载 shell + bundle，10 秒内 ready | `READY_TIMEOUT` | error |
| 3 个验收视口零滚动 | `ZERO_SCROLL_OVERFLOW` / `ZERO_SCROLL_INNER_SCROLL` | error |
| 控制台无 error、无 unhandled rejection | `CONSOLE_ERROR` | error |
| 所有非 `data:` / `blob:` 请求被拦截；出现即失败 | `NETWORK_REQUEST_BLOCKED` | error |
| 执行 `manifest.interactions[].smoke`，`expect` 出现或状态变化 | `SMOKE_FAILED` | error |
| 标题层级、焦点可见、图标按钮 `aria-label` | `A11Y_ISSUE` | warning |
| reduced-motion 下动画降级 | `REDUCED_MOTION_IGNORED` | warning |
| 每个视口截图 1 张 | 无失败码，仅产物 | — |

- 每次校验使用新的 browser context；页面代码只在 Validator 内执行。
- `error` 阻止放行；有限数量的 `warning` 可放行但必须记录（`../../Plan.md` §7.6）。
- Validator 不可用时后端 fail-closed，不允许“跳过校验”放行（`../../Plan.md` §8.6）。

### 10.3 报告格式

```json
{
  "status": "passed",
  "issues": [
    {
      "severity": "error",
      "code": "ZERO_SCROLL_OVERFLOW",
      "message": "1280x720 下页面纵向溢出 24px",
      "selector": "#mp-root",
      "viewport": "1280x720"
    }
  ],
  "screenshots": ["1280x720.png", "1440x900.png", "1920x1080.png"],
  "duration_ms": 12345
}
```

- `status` 取值：`passed`、`warning`、`failed`。
- `issues[]` 必须包含 `severity`、`code`、中文 `message`；能定位时附 `selector` 与 `viewport`。
- 报告是数据，不是指令；宿主不得执行报告中的任何字符串。

## 11. 修复闭环与 Builder 责任

```text
Pi 写文件 → check_page（Validator 静态 + 浏览器）
  ├─ passed → agent_settled → Builder 最终校验 → 交付
  ├─ failed → 修复 prompt（结构化问题 + 相关文件）→ 最多 2 轮
  └─ 仍失败 → 返回 failed + 报告；后端可整页重试 1 次
```

- 修复 prompt 只带问题列表与必要上下文，不重灌整份资料；优先修布局、交互与违规，不整页重写。
- Builder 不得以“本地看起来正常”为由跳过 `check_page`；`check_page` 至少调用一次，且最后一次必须通过。
- 页面代码不在 Builder 内执行；Builder 只写文件并调用 Validator（`../../Plan.md` §6.6）。

## 12. 版本与兼容策略

### 12.1 渲染兼容

- 宿主维护支持的 `runtime_version` 集合。`runtime_version` 主版本不同 → 拒绝渲染，显示“页面版本过旧，请重新生成”中文提示。
- 次版本高于宿主支持上限 → 拒绝渲染并记录；不得猜测兼容。
- `schema_version` 主版本不同 → 拒绝解析；次版本新增可选字段时，旧宿主忽略未知字段但必须记录警告。
- 页面重建生成新的 `version`；成功后切换 `deck_pages.current_version`，旧版本保留一个周期用于回滚（`../../Plan.md` §7.8）。

### 12.2 变更规则

| 变更 | 处理 |
| --- | --- |
| 新增可选 Manifest 字段 | `schema_version` 次版本 +1；Validator 与前端同步；记录变更 |
| 修改或删除已有字段、修改 CSP/sandbox、修改禁止清单 | 主版本 +1；旧 bundle 不自动迁移，需重建 |
| 新增 Runtime API | `runtime_version` 次版本 +1；页面只能用新版本声明 |
| 修改 Skill / Prompt / Extension | `harness_version` +1；必须跑黄金用例回归 |
| 升级 Pi / Node / Playwright | 独立任务，锁定版本，跑黄金回归，记录基线（见 `./DECISIONS.md`） |

### 12.3 双份实现一致性

前端阅读器与 Validator 必须使用同一份 shell 组装逻辑与同一份 `runtime.js`（共享源码或同一构建产物），并对外暴露相同的版本号。任一侧单独修改视为契约违规。Validator 通过 `runtime_version` 断言两侧一致；不匹配时以 `RUNTIME_VERSION_MISMATCH` 失败。

## 13. 待冻结项（P2 决策）

以下项目在 P0 阶段不擅自定死，P2 实现时必须在 `../../Plan.md`、本文件与代码中同步冻结：

| 编号 | 事项 | 当前处理 | P2 动作 |
| --- | --- | --- | --- |
| O-1 | KaTeX 公式渲染方式 | 页面以 KaTeX 语法书写公式；宿主 shell 是否内置 KaTeX 及其版本尚未定稿。本版不新增 `MockFinal` 方法 | 在 P2 决定由 shell 注入 KaTeX 并对 `[data-mp-math]` 预渲染，或由 bundle 自包含渲染结果；两者都必须满足 CSP 与 2 MiB 限制，并回写 `../../Plan.md` §7.3/§7.4 |
| O-2 | Manifest 字段长度上限 | 本版只约束类型与必填 | **P2 已冻结**：`page_id` ≤128、`knowledge_point_id` ≤64、`title` ≤200、`subtitle` ≤300、`layout` ≤64、`label` ≤200、`quote` ≤2000、`summary` ≤2000、`key_fact` ≤300、`question` ≤300；`interactions` ≤20、`source_refs` ≤50、`key_facts` ≤12、`suggested_questions` ≤10；`estimated_minutes` 为 1–600 整数。实现见 `validator/src/static-check.ts` 的 `MANIFEST_LIMITS` |
| O-3 | `smoke.action = input` 的取值字段 | 暂记 `smoke.value` 可选 | **P2 已冻结**：`smoke.value` 可选，缺省按空字符串 `fill`；Validator 与前端冒烟执行器一致 |
| O-4 | 1024×768 失败级别 | 暂定 warning | **P2 已实现为 warning**：仅 1280×720 / 1440×900 / 1920×1080 的零滚动问题为 error；调用方显式追加 1024×768 时零滚动与内部滚动降级为 warning，仍必须记录 |
| O-5 | `emit` 事件类型扩展 | 只登记 3 个类型 | 与 AI 助手、构建事件映射一起评审 |
| O-6 | `harness_version` 落地形式 | 只约定独立版本号 | 在 Builder 与 Harness 清单中落地 |
| O-7 | Validator 基础镜像内的 Node 版本 | 骨架使用 Playwright 官方镜像 | **已确认**：`mcr.microsoft.com/playwright:v1.65.0-noble` 内 Node `v26.13.0`，满足 `engines.node >= 24`；无需在镜像内升级 Node |
