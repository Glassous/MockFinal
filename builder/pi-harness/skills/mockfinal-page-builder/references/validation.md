# references/validation.md · 校验、失败码与修复

> 权威版本：`docs/pageref/PAGE_CONTRACT.md` 第 10 节。本文件是修复手册，不新增规则；冲突以契约为准。
> 判定标准只有一个：**Validator 的静态 + 浏览器检查**。Builder 自检只供参考，不能替代。

## 1. check_page 的使用

- 写完 4 个文件后调用一次 `check_page`（参数：构建目录与 `page_id`）。
- 返回结构：

```json
{
  "status": "failed",
  "issues": [
    { "severity": "error", "code": "ZERO_SCROLL_OVERFLOW", "message": "1280x720 下纵向溢出 24px", "selector": "#mp-root", "viewport": "1280x720" }
  ],
  "screenshots": ["1280x720.png"],
  "duration_ms": 12345
}
```

- 按 `issues[]` 逐条修，最多 2 轮；**最后一次必须 `passed`** 才能结束。
- `error` 阻止放行；少量 `warning` 可放行但要在收尾说明。
- 只改与问题相关的文件；不要整页重写，不要删除检查逻辑，不要改 manifest 来“绕过”检查。
- 没有 bash，不能自己跑浏览器；不要把“本地看起来正常”当作通过。

## 2. 静态失败码

| 失败码 | 常见原因 | 修复步骤 |
| --- | --- | --- |
| `BUNDLE_SCHEMA_INVALID` | 字段缺失/类型错、`schema_version` 写成数字、JSON 尾逗号、BOM | 用最小 bundle 对照字段表；数字字段不要加引号；保存 UTF-8 无 BOM |
| `BUNDLE_TOO_LARGE` | 内联大图、长 base64、重复 CSS | 删 base64；图示改 SVG 路径；压缩 CSS；必要时拆页 |
| `MANIFEST_INVALID` | `page_id` 与 brief 不一致、`knowledge_point_ids` 为空、`importance` 自造、`interactions` 为空 | 逐项对照 `page-contract.md` 第 3 节；`page_id` 复制 brief 原值 |
| `HTML_FORBIDDEN_TAG` | 出现 `<style>`/`<script>`/`<html>`/`<form>`/`<link>` | 删除标签；样式进 `page.css`，脚本进 `page.js` |
| `HTML_FORBIDDEN_ATTR` | `onclick` 等 `on*`、`target`、`srcdoc`、`download` | 改为 `data-mp-action` + `page.js` 监听 |
| `HTML_EXTERNAL_URL` | `href="https://…"`、`src="//…"`、`xlink:href`、SVG 写了 `xmlns="http://www.w3.org/2000/svg"` | 删除属性；内联 SVG 不需要 `xmlns`；锚点只允许 `#` |
| `SHELL_ESCAPE_SEQUENCE` | html/css/js 中出现 `</script`、`</style`、`<!--` | 不要在字符串/注释里写这些序列；必须表达时用拆分字符串 |
| `CSS_EXTERNAL_URL` | `@import`、`url(https://…)`、相对 `url()` | 全部删除；渐变/纹理用 CSS 绘制或内联 SVG |
| `POSITION_FIXED`（警告） | `position: fixed` 的浮层 | 改成 `absolute` 并在 stage 内定位；页面内不要浮层 |
| `JS_FORBIDDEN_API` | 网络/存储/动态执行/父窗口/动态注入 | 删除调用；只保留 DOM、事件、rAF、Math、Intl。注释与字符串里也不要出现这些词 |
| `SMOKE_INVALID` | `action` 不在 `click/input/step`、选择器语法错、`expect` 缺失 | 用属性选择器；`expect` 指向点击后才出现的元素 |
| `SMOKE_SELECTOR_NOT_FOUND` | `selector` 在 HTML 中不存在（如按钮由 JS 生成但拼写不一致） | 在 HTML 里静态写按钮，或保证 JS 渲染后属性完全一致 |
| `RUNTIME_VERSION_MISMATCH` | `runtime_version` 不是 brief 指定的版本（新页面 1.1.0，旧页面 1.0.0） | 复制 brief 的 `constraints.runtime_version`，不要猜兼容 |
| `TEACHING_MISSING` / `TEACHING_INVALID` | schema 1.1 页面缺少 `manifest.teaching` 或字段不合法 | 按模板补齐 role/objectives/chain/check/summary；版本写 `1.0` |
| `TEACHING_BLOCK_MISSING` | `teaching.chain[].block_id` 在 HTML 中找不到对应 `data-mp-block` | 给每个讲解块加 `data-mp-block="bN"`，并让 chain 引用一致 |
| `TEACHING_CHECK_MISSING` / `TEACHING_OBJECTIVE_MISMATCH` | 缺少检查题，或 `objective_id` 不指向 objectives | 至少 1 题；`objective_id` 用 `o1`–`oN` 对应 objectives 顺序 |
| `CSS_BUDGET_WARNING`（警告） | 教学页 `page.css` >4 KiB，或重定义了 Kit 基础类 | 删除对 `.mp-page/.mp-head/.mp-body/.mp-card/.mp-btn` 的重定义，只保留页面专属增量样式 |

## 3. 浏览器失败码

| 失败码 | 定位 | 修复步骤 |
| --- | --- | --- |
| `PAGE_NOT_READY` | `MockFinal.ready` 未调用、调用两次、JS 首行报错 | 确认 js 末尾只调用一次；把可能抛错的查询放在 `if (el)` 保护内；不要在页面加载前访问不存在的节点 |
| `ZERO_SCROLL_OVERFLOW` | 1280×720 最常见：主体内容高于 1fr 行 | 先查根是否 `100dvh` + `overflow: hidden`；再查主体是否 `min-height: 0`；减内容/缩字号一档，不要加滚动 |
| `INTERNAL_SCROLL` | 某个可见元素 `overflow: auto/scroll` 且内容超出 | 删除该声明；列表限条数（≤ 6）；日志固定行数；改用分步揭示 |
| `MOBILE_HORIZONTAL_OVERFLOW` | 390 宽下元素撑破视口 | 长公式/表格换行或缩放；网格改单列；图片 `max-width: 100%` |
| `MOBILE_SCROLL_BLOCKED` | 移动端内容超出但页面禁止纵向滚动 | 删除 `html/body` 的 `overflow: hidden`；移动端阅读模式交给 Shell 基线 |
| `CONTENT_BUDGET_EXCEEDED` | 整页正文 >700 汉字 | 拆页或删次要块；不要缩小字号硬塞 |
| `CONTENT_CLIPPED` | `data-mp-block` 内容被固定高度裁剪 | 去掉固定高度或 `overflow: hidden`；减少块内文字；改用渐进式披露 |
| `MIN_FONT_TOO_SMALL` | 可见文本 <11px | 正文 ≥13px、注释 ≥12px；删掉装饰性小字 |
| `CONSOLE_ERROR` | 空节点访问、重复 `ready`、非法选择器 | 用 `querySelector` 后判空；选择器写死为已知存在的；不要 `console.error` 调试残留 |
| `NETWORK_REQUEST` | 外链字体/图片/`src`、SVG `xlink:href` | 全部内联；data URI 不算外链，但注意体积 |
| `SMOKE_FAILED` | 点击后 `expect` 未出现 / 不变化 | 确认 `step` 只推进一轮、`expect` 指向点击后新增状态；`solve`/`compare` 类直达动作必须一步到位 |
| `A11Y_WARNING`（警告） | 图标按钮无 `aria-label`、页面缺少 h1 | 按钮写文字或 `aria-label`；页面保留一个 h1；焦点规则保留 |
| `TEACHING_SCORE_LOW`（警告） | 教学评分 <70：缺易错点、检查题或来源 | 补 `teaching.summary.misconceptions`、带解析检查题与 `source_refs` |

## 4. 修复顺序（重要）

1. **先修违规**（禁用标签/API/外链/逃逸序列）：这些是硬失败，且可能连带其它检查。
2. **再修布局**（零滚动/内部滚动）：布局不改，冒烟也可能因元素不可见而失败。
3. **再修交互**（冒烟）：只改相关的选择器/状态设置。
4. **最后修提示性 warning**（A11Y、教学评分）。
5. 每轮只改必要文件；改完重新调用 `check_page`，不要把上一轮问题当作已解决。

## 5. 2 轮仍失败的收敛策略

- 内容超预算：删掉一个次要内容块，或把 5 步合并为 3 步。
- 交互过于复杂：降级为「下一步 / 重置」两按钮 + 单一状态。
- 公式太长：拆成两行或改用图示 + 一句结论；不要低于 12px。
- 图示占位过大：SVG 改 `viewBox` 自适应，限制 `max-height`。
- 仍不行：在返回中如实报告失败码与原因，不伪造通过。

## 6. 提交前自检清单

- [ ] 4 个文件齐全：`manifest.json`、`page.html`、`page.css`、`page.js`；没有临时文件。
- [ ] `page.html` 是 body 片段，无 `html/head/body/script/style/link/iframe/object/embed/meta/form`。
- [ ] 无 `on*` 内联事件，无 `javascript:`、无 `http:`/`https:`/`//` 资源，SVG 无 `xmlns`/`xlink:href`。
- [ ] 无 `</script`、`</style`、`<!--` 序列。
- [ ] CSS 颜色只用 `var(--mp-*)`/`currentColor`/`transparent`；无 `#hex`、`rgb()`、`hsl()`、命名色；无渐变。
- [ ] CSS 无 `@import`、无 `url(`、无 `position: fixed`、无 `overflow: auto/scroll`。
- [ ] JS 无网络/存储/动态执行/父窗口/动态注入；无 `console` 调试残留；无全局变量泄漏（IIFE 包裹）。
- [ ] `MockFinal.ready` 恰好一次，位于 js 末尾。
- [ ] 根元素 `height: 100dvh; overflow: hidden;`，主体 `min-height: 0`。
- [ ] 单页总正文 ≤700 汉字、单层可见 ≤500 汉字；内容块总计 5–8 个、单层可见 3–6 个。
- [ ] 移动端（390 宽）无横向溢出；内容超出时允许纵向滚动。
- [ ] schema 1.1：`design_system: "1.0"`；`teaching` 完整；每个讲解块有 `data-mp-block`。
- [ ] `teaching.chain` 3–5 步；至少 1 道带解析检查题；summary 页有 `summary.key_points`。
- [ ] 交互按钮是 `<button type="button">`，有文字或 `aria-label`；焦点可见。
- [ ] reduced-motion 规则存在，状态不依赖过渡结束。
- [ ] manifest：`page_id` 与 brief 一致；`source_refs` 的 `section_id`/`heading`/`quote` 来自 materials；`smoke.expect` 初始不存在。
- [ ] 已调用 `check_page`，最后一次 `passed`。
