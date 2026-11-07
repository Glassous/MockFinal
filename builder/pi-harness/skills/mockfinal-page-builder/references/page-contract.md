# references/page-contract.md · 页面契约执行版

> 本文件是 `docs/pageref/PAGE_CONTRACT.md`（v0.1）在 Builder 容器内的**可执行摘要**。容器内没有仓库 `docs/`，模型只能读本文件与同目录其他 references。
> **冲突处理：凡本文件与 `PAGE_CONTRACT.md` 不一致，一律以 `PAGE_CONTRACT.md` 为准，并在同一任务中修正本文件。** 本文件不得新增契约之外的能力。
> 版本：`schema_version = "1.0"`、`runtime_version = "1.0.0"`、`harness_version = 0.1.0`（三者独立升级）。

## 1. 产物：四个文件，一个 bundle

一次构建只产出**一个页面**，写入构建目录 `cwd` 的 4 个文件。Builder 会把它们组装成 PageBundle JSON：

| 文件 | 角色 | 硬性要求 |
| --- | --- | --- |
| `manifest.json` | 元数据 | 见第 3 节；`page_id` 必须等于 brief 的 `page_id` |
| `page.html` | 页面结构 | **只能是 body 片段**；禁止 `<html>/<head>/<body>/<script>/<style>/<link>/<base>/<iframe>/<object>/<embed>/<meta>/<form>` |
| `page.css` | 页面样式 | 允许为空字符串；禁止 `@import`、外部 `url()`、外部字体、`position: fixed` 遮挡、内部滚动容器、裸色值 |
| `page.js` | 页面行为 | 允许为空字符串；只能通过 `window.MockFinal` 与宿主通信；禁止第 5.3 节 API |

Bundle 顶层字段：`schema_version`（`"1.0"`）、`runtime_version`（`"1.0.0"`）、`manifest`、`html`、`css`、`js`。
序列化后总字节 ≤ `2097152`（2 MiB）；UTF-8 无 BOM；所有图片/图标只能是内联 SVG 或 `data:` URI。
宿主注入 `runtime.js`，**bundle 里不写 runtime，也不写 shell**。

## 2. 最小可用 bundle（可复制后替换内容）

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
    "layout": "hero-side",
    "interactions": [
      {
        "id": "bisect-step",
        "type": "simulation",
        "label": "下一步：执行一轮比较并收缩区间",
        "smoke": {
          "action": "click",
          "selector": "[data-mp-action='step']",
          "expect": "[data-mp-state='stepped']"
        }
      }
    ],
    "source_refs": [
      { "material_id": 3, "section_id": 102, "heading": "闭区间写法与循环不变式", "quote": "循环不变式是：若目标存在，其下标一定在闭区间 [left, right] 内。" }
    ],
    "assistant": {
      "summary": "本页讲解二分查找的区间不变量与复杂度。",
      "key_facts": ["循环不变量", "O(log n)", "边界条件"],
      "suggested_questions": ["为什么 mid 要向下取整？", "什么时候会死循环？"]
    },
    "a11y": { "reduced_motion": true }
  },
  "html": "<div class=\"mp-page\"><h1>二分查找</h1><button type=\"button\" data-mp-action=\"step\">下一步</button></div>",
  "css": ".mp-page { height: 100dvh; overflow: hidden; }",
  "js": "MockFinal.ready({ title: '二分查找' });"
}
```

## 3. Manifest 字段表（逐项自检）

| 字段 | 类型 | 必填 | 规则 | 常见错误 |
| --- | --- | --- | --- | --- |
| `schema_version` | string | 是 | `"1.0"` | 写 `1.0`（数字）或 `1.0.0` |
| `page_id` | string | 是 | 与 brief 完全一致，稳定不变 | 自造 `page_1`、加后缀 |
| `title` | string | 是 | 纯文本，不含 HTML | 写 `<b>` |
| `subtitle` | string | 否 | 一句话，纯文本 | 当正文塞长句 |
| `knowledge_point_ids` | string[] | 是 | 至少 1 个，来自 brief/大纲，不得编造 | 空数组、写标题当 ID |
| `importance` | string | 是 | 本版已知 `core`；其他值须待契约冻结 | 自造 `high` |
| `estimated_minutes` | number | 是 | 正整数 | 0、`"6"`（字符串） |
| `layout` | string | 是 | 元数据，建议取自 `layouts.md` 的 ID | 留空 |
| `interactions` | object[] | 是 | 非交互页也要给；见 3.1 | 省略字段 |
| `source_refs` | object[] | 是 | 见 3.2；不得编造 | 编页码、编 quote |
| `assistant` | object | 否 | `summary` / `key_facts[]` / `suggested_questions[]` | 超长摘要 |
| `a11y` | object | 是 | 本版只要求 `reduced_motion: true` | 写 `false` |

### 3.1 interactions 与 smoke

```json
{
  "id": "bisect-step",
  "type": "simulation",
  "label": "下一步：执行一轮比较并收缩区间",
  "smoke": {
    "action": "click",
    "selector": "[data-mp-action='step']",
    "expect": "[data-mp-state='stepped']"
  }
}
```

- `id`：页面内唯一，`[a-z0-9-]+`。
- `type`：非空字符串；已知 `simulation`、`none`，其余待 P2 扩展。非总结页至少一个真实交互；总结页可 `type: "none"`，但仍要给出 `smoke`。
- `smoke.action`：`click` / `input` / `step` 之一。
- `smoke.selector`：合法 CSS 选择器，执行前必须能匹配到元素；统一用 `data-mp-action`/`data-mp-state`，**不要用样式类名**。
- `smoke.expect`：合法选择器；必须在**执行动作之后出现**，不能是页面初始就存在的元素。
- 冒烟必须确定、可重复：不依赖随机数、时间、鼠标轨迹、网络。
- `input` 的 `smoke.value` 取值字段在 P2 冻结；未冻结前优先用 `click`。

### 3.2 source_refs

```json
{ "material_id": 3, "section_id": 102, "heading": "闭区间写法与循环不变式", "quote": "循环不变式是：若目标存在，其下标一定在闭区间 [left, right] 内。" }
```

- `section_id`、`heading`、`quote` 必须来自 brief 的 `source_excerpts` 或 `materials/` 原文；`quote` 是原文片段或忠实摘要。
- 不得编造页码、文献、作者、年份；`material_id` 由 brief/宿主提供，黄金用例中固定为 `0`（无数据库资料）。
- 引用不到的结论要么删掉，要么在可见文案里标注“资料未覆盖”。

## 4. Runtime API（只有这 7 个）

| 方法 | 作用 | 规则 |
| --- | --- | --- |
| `MockFinal.ready({ title })` | 声明可交互 | **每页必须且只能调用一次**；放在 js 末尾，在完成首屏渲染后 |
| `MockFinal.emit(type, payload)` | 上报交互事件 | `type` 现允许 `interaction` / `progress` / `complete`；payload 必须可 JSON 序列化，≤ 4 KB |
| `MockFinal.next()` / `MockFinal.prev()` | 请求宿主翻页 | 宿主可忽略；不要用它替代页面内步骤切换 |
| `MockFinal.requestAssistant(quote?)` | 打开 AI 助手 | `quote` 可选，≤ 2 KB；不传未选中的文本 |
| `MockFinal.getTheme()` | 读取主题 | 返回 `{ mode, tokens, reducedMotion }`；`mode` 为 `light`/`dark` |
| `MockFinal.onHostMessage(fn)` | 订阅宿主消息 | 消息 `theme` / `pause` / `resume` / `quote`；返回取消订阅函数 |

- 收到 `pause` 必须暂停动画与计时器，`resume` 后恢复。
- 颜色一律用 CSS 变量；**不要**自己读 `prefers-color-scheme` 决定颜色。
- CSS 变量只用 `--mp-*`（见 `design-language.md`），不得自造 `--mp-xxx` 业务变量冒充运行时 token。

## 5. 禁止清单（静态检查逐条覆盖）

### 5.1 HTML

- 禁标签：`html`、`head`、`body`、`script`、`style`、`link`、`base`、`iframe`、`object`、`embed`、`meta`、`form`。
- 禁一切 `on*` 内联事件（`onclick`、`onload`…）；交互只走 `data-mp-*` + `page.js` 监听。
- 禁 `javascript:`、`vbscript:`、`data:text/html`。
- 禁外部 URL：`href`/`src`/`srcset`/`poster`/`action`/`formaction`/`xlink:href` 中出现 `http:`、`https:`、`//` 或相对路径；只允许 `href="#..."` 页内锚点。
- 禁 `target`、`srcdoc`、`download`、`ping`；禁 `<a>` 指向外部站点。
- 内联 `<svg>` 允许；SVG 内禁 `<script>`、`<foreignObject>`、外部 `xlink:href`。**不要写 `xmlns="http://www.w3.org/2000/svg"`**（会命中外部 URL 检查；HTML 解析器不需要它）。
- 禁出现 `</script`、`</style`、`<!--` 序列。

### 5.2 CSS

- 禁 `@import`；禁 `url(http…)`、`url(//…)`、相对 `url(…)`；只允许 `url(data:…)` 或 `url(#id)`。
- 禁外部字体；`@font-face` 只能用 `data:`，且计入 2 MiB。
- 禁 `position: fixed`（会遮挡宿主导航，至少产生警告）。
- 可见元素禁 `overflow: auto` / `overflow: scroll`（零滚动硬要求）；允许 `overflow: hidden`、`clip`。
- 禁 `behavior`、`-moz-binding`、`expression()`。
- 颜色、边框色、阴影色只能用 `var(--mp-*)`、`currentColor`、`transparent`；**禁止任何 #hex、rgb()、hsl()、命名色**（包括 `#fff`、`black`）。
- 禁止彩色渐变（`linear-gradient` 等）与玻璃拟态效果。

### 5.3 JS

- 网络：`fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`、`import()`。
- 动态代码：`eval`、`new Function`、字符串版 `setTimeout`/`setInterval`、`document.write`。
- 存储与凭据：`cookie`、`localStorage`、`sessionStorage`、`indexedDB`、`caches`、`credentials`、`clipboard`。
- 父窗口/跨框架：`parent`、`top`、`opener`、`frames`、`open`、直接 `postMessage`（只能通过 `MockFinal`）。
- 动态注入：创建/修改 `script`、`link`、`iframe`、`object`、`embed` 元素。
- 其他：`Worker`、`ServiceWorker`、`location` 赋值、`document.domain`、`window.name`。
- 允许：DOM 查询与修改、事件监听、`requestAnimationFrame`、`setTimeout`/`setInterval`（必须能清理）、`Math`、`Intl`、Canvas 2D、内联 SVG 操作。
- 注释与字符串里也不要出现上述词（静态检查可能按字符串匹配，避免误报）。

## 6. 零滚动骨架（最小可复制）

```css
.mp-page {
  height: 100dvh;          /* 唯一允许的根高度 */
  overflow: hidden;        /* 根元素必须 */
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;  /* 需要时加 auto 行 */
  gap: clamp(10px, 1.6vh, 20px);
  padding: clamp(16px, 2.4vw, 36px);
}
.mp-page > * { min-width: 0; }
.mp-body { min-height: 0; display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
```

- 字号线用 `clamp()`，栅格用 `minmax(0, …)`/`fr`；禁止固定大 px 堆内容。
- 内容预算：1 个核心观点、3–5 个内容块、1 个主交互；正文 ≤ 250 中文字符（图注、公式不计）。
- 最小字号 12px（契约下限 11px）；标题层级最多 3 层。
- 验收视口：1280×720、1440×900、1920×1080 必须零滚动（error）；1024×768 为目标（warning）。
- 小于 768 宽为阅读模式，允许纵向滚动，但不得横向溢出。

## 7. 版本与失败方式

- `runtime_version` 与宿主不匹配 → 宿主拒绝渲染（`RUNTIME_VERSION_MISMATCH`），页面不能靠 try/catch 兜底。
- `schema_version` 主版本不同 → 拒绝解析。
- bundle 超 2 MiB → `BUNDLE_TOO_LARGE`，不截断。
- 组装时宿主会转义 `</script`、`</style`；但页面**本来就不允许**出现这些序列，不要依赖转义。
