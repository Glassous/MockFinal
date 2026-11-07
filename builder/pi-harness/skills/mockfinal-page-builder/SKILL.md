---
name: mockfinal-page-builder
description: 把一份 PageBrief 与来源段落构建成单个 MockFinal 复习页 PageBundle（manifest.json、page.html、page.css、page.js），满足单屏零滚动、单色纸感、可访问交互与可执行冒烟，并在结束前调用 check_page 直到通过。
---

# Skill: mockfinal-page-builder

把一份 PageBrief 与对应来源段落转换为**一个** PageBundle（4 个文件），通过 Validator 的静态与浏览器检查。

## 0. 何时使用

Builder 收到 `/build-page` 或等价的页面构建请求时使用；一次会话只构建**一页**，不规划大纲、不改 brief、不写构建目录之外的文件。

## 1. 输入

| 输入 | 位置 | 用法 |
| --- | --- | --- |
| PageBrief | `briefs/{page_id}.json`（即 `{{brief_path}}`） | `page_id`、标题、知识点、目标、交互建议、约束为唯一事实来源 |
| 来源段落 | `materials/`（即 `{{materials_dir}}`） | 只按 brief 的 `section_id` 取原文；`quote` 从这里摘 |
| 契约 | 本 skill `references/page-contract.md` | 必读；冲突以 `docs/pageref/PAGE_CONTRACT.md` 为准 |
| 设计语言 | `references/design-language.md` | 必读；单色纸感、token、密度 |
| 布局 | `references/layouts.md` | 选版式时读 |
| 动效 | `references/animation-recipes.md` | 需要交互时读 |
| 修复 | `references/validation.md` | 写完与修复时读 |
| 脚手架 | `templates/page-base/`（只读参考） | 复制结构，不保留占位注释 |

## 2. 输出（只允许这 4 个文件，写入 cwd）

- `manifest.json`：契约第 4 节字段；`page_id` 与 brief 一致；`source_refs` 来自 materials；`interactions[].smoke` 必填。
- `page.html`：**body 片段**；无 `<script>`/`<style>`/`<link>`/外链/内联事件；交互元素带 `data-mp-action`。
- `page.css`：只用 `--mp-*` 变量；根 `100dvh` + `overflow: hidden`；无 `@import`/外部 `url()`/裸色值。
- `page.js`：只用 `window.MockFinal` 与常规 DOM/事件/rAF；末尾调用一次 `MockFinal.ready`。

不输出 Markdown 说明、总结、截图；不创建 README、不改 brief/materials。

## 3. 工作流：固定 8 步，禁止跳步

1. **加载技能**：确认已读本 `SKILL.md`；若由 `/skill:mockfinal-page-builder` 加载，仍要读取第 1 步列出的两份必读 references。
2. **读 brief**：读 `{{brief_path}}`，记下 `page_id`、`knowledge_point`（title/summary/objectives/key_points/formulas/misconceptions）、`style.preset`、`content`、`density`、`interaction_idea`、`constraints`（视口、`no_scroll`、`max_bundle_bytes`、`runtime_version`、`language`）。
3. **读资料**：按 `source_excerpts[].section_id` 在 `materials/` 中找到原文，核对 heading 与正文；为 `source_refs` 选 1–3 条可引用的原句（不改写事实）。
4. **定版式与交互**：按 `layouts.md` 选 1 个主布局，按 `animation-recipes.md` 选 1 个配方；先在纸上确定：1 个核心观点、3–5 个内容块、1 个主交互、1 个冒烟路径（点击一次 → 出现新状态）。
5. **写 manifest**：`schema_version`、`runtime_version`、`page_id`、`title`、`subtitle`、`knowledge_point_ids`、`importance`、`estimated_minutes`、`layout`、`interactions`（含 `smoke`）、`source_refs`、`assistant`、`a11y: { reduced_motion: true }`。先写它，后续代码以它为准。
6. **写 page.html + page.css**：先结构后样式。根 `.mp-page` 用 `100dvh` grid（`auto 1fr auto`），主体 `min-height: 0`；字号/间距用 `clamp()`；颜色只用 `--mp-*`；按钮用 `<button type="button">` 并写文本或 `aria-label`；补 reduced-motion 规则。
7. **写 page.js**：单一 `step/index` 状态 + 幂等 `render()`；事件绑定 `data-mp-action`；`data-mp-state` 反映状态；状态立即更新、动画只做过渡；末尾 `MockFinal.ready({ title })` 恰好一次。IIFE 包裹避免全局变量。
8. **调用 check_page 并修复**：至少调用一次；按 `issues[]` 先修违规、再修布局、再修冒烟；最多 2 轮；**最后一次必须 `passed`** 后结束，并返回文件清单与校验摘要。

## 4. 硬约束（任何一条不满足都不得结束）

- 无网络、无外链资源、无外部字体/CDN/公式库；所有图示内联 SVG / CSS / Unicode。
- 桌面 1280×720 / 1440×900 / 1920×1080 零滚动；无内部滚动容器；移动端不横向溢出。
- 只使用 `--mp-*` 变量与 `currentColor`/`transparent` 表达颜色；无裸色值、无渐变、无玻璃拟态、无 emoji。
- 不使用 bash；只写 cwd 内文件；不执行页面代码。
- 必须调用 `check_page` 至少一次；不伪造通过、不跳过检查。

## 5. 完成判定

- `check_page` 最终 `passed`（warning 已解释）。
- 3 个桌面视口零滚动；冒烟可执行且期望状态出现。
- `source_refs` 与 materials 对应；`page_id` 与 brief 一致。
- 4 个文件齐全、无临时文件、无 Markdown 说明。

## 6. 出错时的优先级

内容准确性 > 零滚动 > 交互可用 > 动效 > 视觉润色。冲突时删内容、拆步骤，不要缩字号硬塞，也不要为了动效牺牲 reduced-motion。
