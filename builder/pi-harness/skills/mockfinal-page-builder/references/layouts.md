# references/layouts.md · 单屏布局范式

> 目的：把「一屏一个知识点」落成可复制的 grid 结构，减少自由发挥导致的溢出与层级混乱。
> 所有布局共用根骨架：`height: 100dvh; overflow: hidden; display: grid;`，只有行/列定义不同。`layout` ID 只作 manifest 元数据，不限制组合。
> 视口基准：1280×720 为最紧视口，先按它预算，再放大到 1440/1920。

## 0. 通用骨架（所有布局的公共部分）

```css
.mp-page {
  height: 100dvh; overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;   /* 头部 / 主体 / 底部操作区 */
  gap: clamp(10px, 1.5vh, 20px);
  padding: clamp(16px, 2.4vw, 36px);
  background: var(--mp-panel); color: var(--mp-ink);
  font-family: var(--mp-font-sans);
}
.mp-head { display: grid; gap: 6px; }
.mp-body { min-height: 0; display: grid; }
.mp-foot { display: flex; justify-content: space-between; gap: 16px; font-size: 12px; color: var(--mp-muted); }
@media (max-width: 820px) {
  .mp-body { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: auto; }
}
```

- 主体必须 `min-height: 0`，否则 grid 子项按内容撑高，必溢出。
- 同一页面只允许一个主交互区；操作按钮集中在底部或主体右下。
- 内容块之间用 1px 边框或留白分隔，不要卡片套卡片。

## 1. `hero-side` · 主视觉 + 侧注

```text
┌───────────────────────────────┬──────────────┐
│  主视觉（数组 / 图 / 演示）    │ 侧注 1        │
│                               │ 侧注 2        │
│  [控制条]                     │ 侧注 3        │
└───────────────────────────────┴──────────────┘
```

```css
.mp-body { grid-template-columns: minmax(0, 1.6fr) minmax(240px, 1fr); gap: clamp(14px, 2vw, 28px); }
.mp-stage { min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; }
.mp-side { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 12px; }
```

- 适用：算法演示、单图讲解、实验现象、代码执行过程。
- 预算：主视觉占 60% 宽；侧注 2–3 块，每块 ≤ 2 行；主按钮 1 个。
- 常见溢出：侧注当正文写（每块 > 40 字）；主视觉与侧注都放交互；日志行数随步骤增长不封顶。
- 冒烟位：底部或主视觉下方的 `[data-mp-action='step']`；状态挂在根 `data-mp-state`。

## 2. `staged-derivation` · 分步推演

```text
┌───────────────────────┬───────────────────────┐
│ 图示（随步骤变化）     │ 步骤 1  ✔             │
│                       │ 步骤 2  ✔             │
│                       │ 步骤 3  ▸（当前）     │
└───────────────────────┴───────────────────────┘
```

```css
.mp-body { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: clamp(16px, 2.4vw, 36px); }
.mp-derive { min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.mp-steps { display: grid; align-content: start; gap: 10px; }
```

- 适用：公式推导、证明、算法正确性、因果链。
- 预算：可见步骤 ≤ 4（未展开的 `display: none`）；每步 ≤ 2 行；结论固定在一个区块，不随步骤增删。
- 常见溢出：一次显示全部步骤；每步塞公式 + 解释 + 例子；图示与步骤不同步导致高度抖动。
- 冒烟位：`[data-mp-action='step']`，`expect` 指向第一步出现后的根状态或首个步骤块。

## 3. `compare` · 左右对照

```text
┌──────────────┬──────────────┐
│   A 方案      │   B 方案      │
│   要点 1–3    │   要点 1–3    │
├──────────────┴──────────────┤
│  差异结论（一行，反转强调）  │
└─────────────────────────────┘
```

```css
.mp-body { grid-template-rows: minmax(0, 1fr) auto; }
.mp-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: clamp(12px, 1.6vw, 24px); min-height: 0; }
.mp-col { display: grid; grid-template-rows: auto minmax(0, 1fr); padding: 16px; border: 1px solid var(--mp-border); border-radius: 18px; }
```

- 适用：概念辨析、两种写法、先/后、正确/错误、AK/RS 顺序对比。
- 预算：每侧 ≤ 4 条；结论 1 行；不要两侧各放一个复杂图（最多一侧有图）。
- 常见溢出：两侧条目数不等导致结论被挤；对照项逐条动画同时展开；每侧再加小标题层级。
- 冒烟位：`[data-mp-action='toggle']` 切换 A/B 或 `[data-mp-action='compare']` 显示结论。

## 4. `timeline` · 时间线

```text
 1943   1956   1969   1986   1997   2012   2017   2022
  ●──────●──────●──────●──────●──────●──────●──────●
┌──────────────────────────────────────────────────────┐
│ 当前节点：标题 / 事件 / 为什么发生 / 范式变化          │
└──────────────────────────────────────────────────────┘
```

```css
.mp-page { grid-template-rows: auto minmax(0, 1fr) auto auto; }
.mp-track { position: relative; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; padding-top: 18px; }
.mp-node { width: 100%; min-width: 0; display: grid; gap: 2px; padding: 8px 6px; border: 1px solid var(--mp-border); border-radius: 12px; background: var(--mp-panel); color: var(--mp-ink); }
```

- 适用：历史演进、概念发展、协议版本、事故复盘。
- 预算：节点 6–8 个（硬上限 8）；同屏只展开 1 个详情；节点标签 ≤ 6 字，年份 4 位。
- 常见溢出：8 个节点各配一段说明（改成单详情）；节点标签过长换行撑高轨道；详情里再放步骤列表。
- 冒烟位：`[data-mp-action='next']`（推进）或 `[data-mp-action='node']`（点节点）；`expect` 用 `[data-mp-index='N'][data-mp-state='current']`。

## 5. `matrix-grid` · 网格矩阵

```text
┌────────────────────────┬───────────────────────┐
│  SVG 网格 / 坐标 / 矩阵 │  矩阵与列标注          │
│  （基向量、像向量）     │  [a b]  第一列 = e1 像 │
│                        │  [c d]  第二列 = e2 像 │
└────────────────────────┴───────────────────────┘
```

```css
.mp-body { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: clamp(14px, 2vw, 30px); }
.mp-figure { min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.mp-figure svg { width: 100%; height: 100%; max-height: 100%; }
```

- 适用：线性代数、坐标变换、图像处理、网络结构、状态矩阵。
- 预算：一张图（≤ 3 组向量）、一个矩阵块、2 条注记；SVG 用 `viewBox` 自适应，不写固定宽高。
- 常见溢出：SVG 写死 `width="800"`；矩阵元素用大字号；图注 3 行以上。
- 冒烟位：`[data-mp-action='step']` 高亮列，或 `[data-mp-action='compare']` 切到对照结论。

## 6. `formula-steps` · 公式推导

```text
┌──────────────────────────────────────────────┐
│ 前提：…                                       │
│ ① 公式 A           （当前步，反转/加粗）       │
│ ② 公式 B  =  展开                              │
│ ③ 结论：…                                      │
└──────────────────────────────────────────────┘
```

```css
.mp-body { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; align-content: start; gap: 12px; }
.mp-formula { font-family: var(--mp-font-mono); font-size: clamp(14px, 1.3vw, 19px); overflow-wrap: anywhere; }
```

- 适用：单线推导、复杂度分析、概率计算、递推式。
- 预算：可见公式 ≤ 5 行；每行 ≤ 60 字符；符号说明 2–3 条。
- 常见溢出：长公式不换行（用 `overflow-wrap: anywhere` + 缩小一档字号）；每步都加解释；矩阵与公式混排不设最小宽度。
- 冒烟位：`[data-mp-action='step']`，`expect` 指向新出现的公式块（`[data-mp-state='shown']`）。

## 7. `flow` · 流程 / 状态机

```text
┌────────┐   ┌────────┐   ┌────────┐
│ 状态 A │──▶│ 状态 B │──▶│ 状态 C │
└────────┘   └────────┘   └────────┘
       当前：B（反转）  说明：…
```

```css
.mp-flow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: center; min-height: 0; }
.mp-node { padding: 14px 10px; border: 1px solid var(--mp-border); border-radius: 16px; text-align: center; }
.mp-node[data-mp-state="current"] { background: var(--mp-invert); color: var(--mp-invert-ink); border-color: var(--mp-invert); }
```

- 适用：算法流程、协议握手、请求生命周期、构建状态机。
- 预算：节点 3–5 个；箭头用 CSS 伪元素或内联 SVG；每个节点 ≤ 6 字；说明 1 行。
- 常见溢出：节点文字过长换行；4 个以上状态挤在一行；每个节点都加副标题。
- 冒烟位：`[data-mp-action='next']` 推进当前状态，`expect` 为 `[data-mp-state='current'][data-mp-index='1']`。

## 8. `recap` · 总结速查

```text
┌────────────────┬────────────────┬────────────────┐
│ 要点 1          │ 要点 2          │ 易错 1          │
├────────────────┼────────────────┼────────────────┤
│ 要点 3          │ 公式            │ 自测 1 行        │
└────────────────┴────────────────┴────────────────┘
```

```css
.mp-body { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); gap: 12px; }
.mp-card { min-height: 0; padding: 14px; border: 1px solid var(--mp-border); border-radius: 16px; background: var(--mp-raised); }
```

- 适用：章节小结、考点速查、错题清单。
- 预算：6 张卡（2×3）为上限；每卡 ≤ 2 行；可声明 `interactions: [{ type: "none" }]`。
- 常见溢出：卡片内放长句；9 张卡；每卡再加图标与按钮。
- 冒烟位：总结页也要给 `smoke`；可放一个“展开易错点”的 `[data-mp-action='toggle']`。

## 9. 选型速查

| 知识点形态 | 首选 | 备选 |
| --- | --- | --- |
| 算法过程 / 单图演示 | `hero-side` | `staged-derivation` |
| 公式推导 / 证明 | `formula-steps` | `staged-derivation` |
| 概念辨析 / 顺序对比 | `compare` | `recap` |
| 历史 / 演进 | `timeline` | `flow` |
| 线性代数 / 坐标 | `matrix-grid` | `hero-side` |
| 流程 / 状态 | `flow` | `timeline` |
| 章节小结 | `recap` | `compare` |

## 10. 所有布局的溢出自查

1. 主体是否 `min-height: 0`，子项是否 `min-width: 0`。
2. 是否有元素随步骤增加高度（日志、列表）：给容器固定行数或 `overflow: hidden` + 只保留可见条数。
3. 是否用了 `100vh` 而不是 `100dvh`；是否给根加了 `padding` 却没用 `box-sizing: border-box`（宿主已全局设置）。
4. 长文本是否 `overflow-wrap: anywhere`；表格/矩阵是否允许收缩。
5. 1280×720 下把浏览器缩放到 100% 再核对一遍：视觉上一屏，测量上 `scrollHeight <= clientHeight`。
