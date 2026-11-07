# references/animation-recipes.md · 交互与动效配方

> 目的：高频教学交互不再即兴设计。每个配方给状态模型、DOM 约定、事件绑定、reduced-motion 降级与冒烟选择器。
> 通用原则：状态**立即**更新，动画只是过渡；不依赖动画回调推进逻辑；不用 `setTimeout` 承担状态；单次动画 150–400ms；无循环装饰。
> 契约：`data-mp-action` 只标在可执行元素（`<button>`），`data-mp-state` 标在状态承载元素（根或卡片）；样式类名不进入冒烟。

## 0. 通用状态模型与骨架

```js
var state = { step: 0, max: 3 };
var root = document.querySelector('.mp-page');
var els = root.querySelectorAll('[data-mp-action]');

function render() {
  root.dataset.mpStep = String(state.step);
  root.dataset.mpState = state.step === 0 ? 'idle' : (state.step >= state.max ? 'done' : 'stepped');
  // 逐元素切换 data-mp-state / 文本 / aria-live
}
```

- 单一事实来源：一个 `step`（或 `index`）整数，渲染函数幂等，任何入口（按钮、键盘、节点点击）都只改这个整数。
- 根 `data-mp-state` 取 `idle` / `stepped` / `done`（或更语义化的值），**初始值写在 HTML 上**，冒烟的 `expect` 必须指向初始不存在的值。
- 可交互元素必须是 `<button type="button">`（原生键盘可达），文本按钮写文字，图标按钮写 `aria-label`。
- 键盘：原生按钮已支持 Enter/Space；不要自造 tabindex 顺序；不要绑定全局快捷键（翻页由宿主处理）。
- 需要 `aria-live="polite"` 的只有状态文案区域，避免整页朗读。
- 收到 `pause` 时停止所有计时器/rAF，`resume` 后按当前状态重新渲染（不要补播动画）。
- reduced-motion：CSS 关闭 `transition`/`animation`；JS 不判断媒体查询，直接改状态即可，因此天然降级。

## 1. 区间收缩（二分查找）

**状态**：`applied`（已执行轮数，0..3）；由预置步骤表推导 `[left, right]`、`mid`、`hits`。
**DOM**：单元格列表 `[data-mp-index]`；区间内 `data-mp-state="in-range"`，区间外 `data-mp-state="excluded"`；当前中点 `data-mp-role="mid"`（反转 + 2px outline）。根 `data-mp-state` = `idle | stepped | hit`。
**事件**：

| 元素 | 行为 |
| --- | --- |
| `[data-mp-action='step']` | `applied + 1`（到 3 后停） |
| `[data-mp-action='solve']` | `applied = 3`，直接命中 |
| `[data-mp-action='reset']` | `applied = 0` |

**动画**：被排除的单元格 `opacity .38`（200ms）；中点切换用背景反转，不加位移。
**reduced-motion**：`transition: none`；状态一步到位。
**冒烟**：

```json
{ "action": "click", "selector": "[data-mp-action='step']", "expect": "[data-mp-state='stepped']" }
{ "action": "click", "selector": "[data-mp-action='solve']", "expect": "[data-mp-state='hit']" }
```

**注意**：日志最多 3 行且行高固定；不要一次渲染全部步骤；`step` 只推进一轮，`solve` 才直达命中——两者都必须确定。

## 2. 矩阵变换分步

**状态**：`step`（0..4）：0 空态、1 列观点、2 乘向量、3 复合计算、4 顺序对比。
**DOM**：`<svg>` 网格 + 单位正方形（虚线）+ 像平行四边形（`data-mp-layer="image"`，step≥3 显示）；右侧步骤列表，未到步骤 `display: none`；底部 SR / RS 两个矩阵块，RS 在 step<4 时 `opacity: 0`（**保留占位**，避免高度抖动）。
**事件**：`[data-mp-action='step']` 前进；`[data-mp-action='prev']` 后退；`[data-mp-action='compare']` 直接到 step 4。
**动画**：图示图层 `opacity` 200ms；步骤出现 150ms 淡入；矩阵不做位移动画。
**reduced-motion**：无过渡，图层瞬间显隐。
**冒烟**：

```json
{ "action": "click", "selector": "[data-mp-action='step']", "expect": "[data-mp-state='columns']" }
{ "action": "click", "selector": "[data-mp-action='compare']", "expect": "[data-mp-state='compared']" }
```

**注意**：公式不要依赖外部渲染库；用内联 SVG / HTML 矩阵（CSS 网格 + 左右边框模拟方括号）/ Unicode 符号。SVG 不写 `xmlns`，不给 `href`。

## 3. 时间线逐步揭示

**状态**：`current`（0..7）、`revealed`（最大已展开下标）。节点三态：`hidden`（未揭示，虚线 + `--mp-faint`）、`revealed`、`current`（反转）。
**DOM**：8 个 `<button data-mp-action="node" data-mp-index="i">`；详情区用 `textContent` 更新标题/正文/为什么/范式；进度线宽度用 `style.width`。
**事件**：`[data-mp-action='next']`、`[data-mp-action='prev']`、`[data-mp-action='reset']`、节点点击（跳转并揭示到该节点）。
**动画**：详情卡片 `opacity` 200ms；节点背景过渡 150ms；不做横向位移（减少抖动）。
**reduced-motion**：无过渡；直接替换详情文本。
**冒烟**：

```json
{ "action": "click", "selector": "[data-mp-action='next']", "expect": "[data-mp-state='current'][data-mp-index='1']" }
{ "action": "click", "selector": "[data-mp-action='node'][data-mp-index='5']", "expect": "[data-mp-state='current'][data-mp-index='5']" }
```

**注意**：节点标签 ≤ 6 字；详情正文 ≤ 60 字；8 个节点必须一屏放下，1280 宽每列约 140px。

## 4. 流程推进 / 状态机

**状态**：`index`（0..n-1）+ 可选的 `path`（已走过节点）。
**DOM**：节点 `data-mp-index` + `data-mp-state="done|current|pending"`；连线上 `data-mp-role="edge"`，走过的边加深。
**事件**：`[data-mp-action='next']` / `[data-mp-action='prev']`；点击节点直接跳转（可选）。
**动画**：当前节点反转 150ms；边的高亮用 `border-color` 过渡；不做路径描边动画。
**reduced-motion**：无过渡。
**冒烟**：`{ "action": "click", "selector": "[data-mp-action='next']", "expect": "[data-mp-state='current'][data-mp-index='1']" }`
**注意**：节点 ≤ 5；每条边只画一次；不要给每个节点加副标题。

## 5. 对比切换（A/B、顺序对比）

**状态**：`mode`（`a` / `b` / `both`）；`both` 时展示差异结论。
**DOM**：两个对照面板 `data-mp-panel="a|b"`；结论块 `data-mp-role="verdict"`，初始 `hidden` 或 `opacity: 0`。
**事件**：`[data-mp-action='toggle']` 在 a/b 间切换；`[data-mp-action='compare']` 进入 both 并显示结论。
**动画**：面板 `opacity` 150ms；不要用左右滑动（容器溢出风险）。
**reduced-motion**：无过渡。
**冒烟**：`{ "action": "click", "selector": "[data-mp-action='compare']", "expect": "[data-mp-state='compared']" }`
**注意**：两面板等高等宽；结论出现不得改变整体高度（预留行）。

## 6. 公式分步展开

**状态**：`visible`（1..n）；每行 `data-mp-step="i"`，未到步骤 `display: none`；当前行加左侧 2px 墨线。
**DOM**：`<ol>` + `<li data-mp-step>`；行内用等宽字体 + `overflow-wrap: anywhere`；矩阵用 HTML 网格或内联 SVG。
**事件**：`[data-mp-action='step']`、`[data-mp-action='reset']`。
**动画**：新行淡入 150ms；不做逐字打字机效果（reduced-motion 难降级、易超时）。
**reduced-motion**：无过渡。
**冒烟**：`{ "action": "click", "selector": "[data-mp-action='step']", "expect": "[data-mp-step='1'][data-mp-state='shown']" }`
**注意**：可见行 ≤ 5；长公式先缩一档字号再考虑换行；不要引入外部公式渲染库。

## 7. 冒烟选择器约定（所有配方共用）

1. 只在**动作元素**上写 `data-mp-action`，值用短横线小写：`step`、`prev`、`next`、`reset`、`solve`、`compare`、`toggle`、`node`。
2. 状态写在状态元素上：根 `.mp-page` 用 `data-mp-state`（`idle`/`stepped`/`hit`/`compared`…），局部元素另加 `data-mp-index` / `data-mp-step` / `data-mp-panel`。
3. `smoke.expect` 必须是**点击后才出现**的选择器；初始就存在的选择器会让冒烟误判通过。
4. 一个 `smoke` 只点一次；不要写需要连点 N 次才命中的期望。
5. 同一页面多个交互时，`expect` 之间不要互相冲突；`solve` / `compare` 这类直达动作要幂等。
6. 选择器只用属性选择器与元素名，不用 `:nth-child`、`:has`、样式类名。

## 8. 反例

- 用 `setInterval` 自动轮播步骤：无法暂停、reduced-motion 失效、Validator 等待不稳定。
- `expect` 写 `[data-mp-state='hit']` 但页面初始就是 hit：冒烟恒真。
- 连续点击 3 次才能看到终态：单次 `click` 冒烟必然失败。
- 用 `transitionend` 触发下一步状态：reduced-motion 下（无过渡）永远不触发。
- 动画改变容器高度（展开/收起列表）：直接触发零滚动或抖动。
