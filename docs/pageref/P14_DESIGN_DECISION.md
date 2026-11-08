# P14 设计方向决策

日期：2026-11-08
最终主基调：**B · 工作台型（workbench）**（维护者 2026-11-08 选定；细节打磨见第 8 节）

## 1. 评审对象

三个方向使用同一套内容、同一个 Page Kit 渲染器，只切换 CSS 布局与排版：

| 方向 | 定位 | 本地预览 |
|---|---|---|
| A · 讲义型（editorial） | 纸面讲义，44rem 正文 + 页边注，17px/1.85，正文优先 | `design_lab/out/editorial/*.html` |
| B · 工作台型（workbench） | 左侧路线 + 中央正文 + 右侧速查/图，16px/1.75，密度最高 | `design_lab/out/workbench/*.html` |
| C · 题解型（problem） | 左侧步骤小地图 + 题解 hero，16.5px/1.8，贴近期末刷题 | `design_lab/out/problem/*.html` |

3 个页面：

- `page-1`：C-R 条件（mechanism，flow，带复平面双路径图）
- `page-2`：留数定理例 25（worked_example，flow，带围道/极点图）
- `page-3`：拉普拉斯变换四步法（worked_example，flow，无图，专门测试纯文字密度）

评分标准：[`rubric.md`](rubric.md)；人工评分卡：[`SCORECARD.md`](SCORECARD.md)。

## 2. 盲评方法

- 3 个独立子代理（J1/J2/J3）并行评分，互相不可见，只看到打乱后的方向标签 A/B/C。
- 每个方向 13 张截图：3 页 ×（desktop 1280 整页 / mobile 390 首屏 / dark 1280），有图的页加 `figure.png`，有检查的页加 `check.png`。
- 主题名从盲评目录中移除；子代理被明确禁止读取源码、主题 CSS 与其他 judge 目录。
- 盲评映射在评分结束后才公开（见第 6 节）。

## 3. 盲评分数

| 盲评方向 | J1 | J2 | J3 | 均值 |
|---|---:|---:|---:|---:|
| A（J1=workbench，J2=problem，J3=editorial） | 83 | 85 | 82 | 83.3 |
| B（J1=problem，J2=editorial，J3=workbench） | 86 | 83 | 87 | 85.3 |
| C（J1=editorial，J2=workbench，J3=problem） | 82 | 87 | 86 | 85.0 |

按真实主题还原：

| 主题 | J1 | J2 | J3 | 盲评均值 |
|---|---:|---:|---:|---:|
| **workbench（工作台型）** | 83 | 87 | 87 | **85.7** |
| **problem（题解型）** | 86 | 85 | 86 | **85.7** |
| **editorial（讲义型）** | 82 | 83 | 82 | **82.3** |

盲评排序：

- J1：problem > workbench > editorial
- J2：workbench > problem > editorial
- J3：workbench > problem > editorial

**结论：workbench 与 problem 盲评均分打平（85.7），editorial 三个评审均排最后（82.3）。** 按计划由人工评分作为 tie-break。

## 4. 三个方向的主要评审意见

### workbench（工作台型）

- 阅读体验最好：16px 正文、38–40 字行长，长页连读最舒服；三页 2.24–2.58 屏，密度最高。
- 公式余量最足，page-2 的 Res 双式仍有约 30px 余量；批量生成最稳。
- 扣分点：卡片层级多，有评审觉得偏「仪表盘」；无图的 page-3 右栏在速查卡结束后仍留约半列空白；page-1 副标题在部分宽度下出现「咬合。」孤行。

### problem（题解型）

- 图示与题解气质最好：图最大、caption/takeaway 明确，page-2 的答案分隔线与 page-3 的四步法最有「期末刷题」感。
- 教学链条完整，检查反馈清楚；左侧步骤小地图在移动端仍保留。
- 扣分点：页面偏长（page-3 约 2.58 屏）；无图页右栏同样提前结束；图内 `y=x`、`Δx`、`z₀` 在 300px 画布上仍偏挤；有评审误读为「桌面无路线」（实际左侧有 9rem 路线，但视觉上较细）。

### editorial（讲义型）

- 正文观感最像印刷讲义：17px/1.85、44rem 行长，连续阅读最松。
- 图在页边、正文优先，最符合「图是点缀」的原始诉求。
- 三个评审一致排最后：桌面隐藏路线，扫读路径弱；无图页右栏空白感最明显；page-3 最长（约 2.57 屏）；有评审把缩放后的截图误判为 13–14px 正文。

## 5. 客观证据

| 检查 | 结果 |
|---|---|
| 静态检查（9 页） | 0 issue |
| 浏览器检查（9 页 × 390/1280/1440/1920） | 0 issue（workbench 0 error / 0 warning） |
| 教学结构分 | 90–100 |
| 图示占内容面积 | workbench 11.3%–12.6%（flow） |
| 图示宽度 | workbench 320px（SVG 内容约 304px） |
| 横向溢出 | 0 |
| 最小可见字号 | 12px（标签下限；MathML 上下标不计入标签字号） |
| workbench flow 页高度 | 1280：2.41–2.72 屏（1735–1958px）；1440：1.89–2.16 屏 |
| 截图 | `docs/pageref/design-lab/screenshots/`（含 1280/1440/390/dark/state2/check/reduced/full/scrolled） |
| 实验数据 | `docs/pageref/design-lab/results.json` |

选定 workbench 后的细节打磨见第 8 节；下列问题已在打磨中处理：

1. 图示标签放大到 14px，重排 `z₀`、`4 圈外` 锚点，复平面改为等比例映射（圆是圆、45° 是 45°）。
2. 无图页右栏补「答案速记 / 下一步」，减少整列空置感。
3. workbench 副标题放宽到 48rem，消除「特解。」孤行。
4. 长公式在 390px 下增加「左右滑动查看完整公式」提示（kit JS 检测溢出后显示）。
5. 移动端标题 23px + `word-break: keep-all`，避免「条/件」拆字；路线改为双列，减少首屏占用。

## 6. 盲评映射（评分结束后公开）

| 评审 | A | B | C |
|---|---|---|---|
| J1 | workbench | problem | editorial |
| J2 | problem | editorial | workbench |
| J3 | editorial | workbench | problem |

## 7. 人工评分与最终决策

人工评分卡：[`SCORECARD.md`](SCORECARD.md)

最终总分（计划）：

```
最终分 = 盲评均值 × 50% + 人工分 × 50%
```

盲评结果：workbench 85.7 = problem 85.7 > editorial 82.3。

维护者未逐项填写人工分，而是直接选定 **B · 工作台型（workbench）** 作为 tie-break。决策记录：

- 主基调：**workbench**（唯一主结构，不做 A/C 混合）。
- 盲评依据：workbench 阅读体验最好、批量生成最稳；problem 图示与题解气质最好但页面更长；editorial 三个评审均排最后。
- 后续：在 workbench 上做细节打磨（第 8 节），完成后进入 Phase 2 流水线接入。

## 8. 选定后的细节打磨（2026-11-08）

在 workbench 上完成了两轮修改，并重新跑通全部检查：

| 项 | 修改 |
|---|---|
| 正文 | 15.5px → 16px；说明/步骤 15px；选项 14.5px；副标题 15px/48rem |
| 字体 | 标题与讲解/核心卡的 h2 改用衬线展示字体（Iowan/Palatino/Songti 栈）；正文保持无衬线；tabular numerals |
| 左路线 | 链接 13px；移动端双列网格；真正 sticky（html 承担滚动、body overflow visible），桌面 top 18px / 移动端 top 8px；滚动 spy 高亮当前项 |
| 路线跳转 | worked_example 的每一节路线改为指向具体步骤锚点（`b4-s1…s4`），可逐步骤跳转；教学 `chain.block_id` 仍指向整个例题块 |
| 右栏 | 17rem → 20rem；图示 SVG 约 250px → 304px；视口矮于 860px 时右栏改为随正文滚动，避免底部速查永远不可见 |
| 图示 | SVG 标签 12px → 14px；`z₀`/`4 圈外` 锚点重排；复平面等比例映射；暗色轴标签改用 muted；去掉非必要 `y=x` 行标签，改由 caption 说明 |
| 公式 | 所有可见数学改为 LaTeX → 构建期 KaTeX MathML；例题/检查新增展示公式（`problemTex` / `questionTex`）；行内 `$...$` 统一渲染，零字体、零网络请求 |
| 亚克力 | 页面加单色渐变光斑；路线、图示、速查、例题、检查、核心结论改为半透明玻璃卡（blur 24px + saturate 120% + 内高光 + 软阴影），不再像嵌进纸面 |
| 速查 | 新增「答案速记」「下一步」卡片，填充无图页右栏 |
| 手机 | 标题 23px + keep-all，消除「条/件」拆字；meta 分隔线在手机隐藏；长公式溢出时显示「左右滑动」提示；sticky 路线避免遮挡，步骤 `scroll-margin-top: 150px` |
| 检查 | 错误选项 ✕ / 正确答案 ✓；新增「答错了，正确答案是 B。」结果行 |

打磨后客观指标（workbench）：

- 1280×720：2.41 / 2.66 / 2.72 屏（1735 / 1913 / 1958px，均低于 2000px 警戒线）；1440×900：1.89 / 2.14 / 2.16 屏；1920×1080：1.59 / 1.80 / 1.82 屏。
- 图示占内容面积 11.3%–12.6%，宽 320px。
- 最小可见字号 12px；横向溢出 0；移动端有公式溢出提示。
- 静态/浏览器检查（390/1280/1440/1920）：workbench 0 error / 0 warning；教学结构分 90–100。
- builder 42、validator 54、shell 18 测试全绿。

说明：页面比早期 2.2 屏目标更长，来自新增的题面/检查展示公式、亚克力卡片内边距与更完整的例题步骤；在 1440×900 仍 ≤2.2 屏，1280×720 的绝对高度仍低于 2000px 警戒线。方向结论不变。**Phase 2 可以开始。**

## 9. Phase 2 接入记录（2026-11-08）

Phase 2 已把 workbench 主基调接入生成流水线：

| 层 | 改动 |
|---|---|
| Builder | `content_schema="2.0"` 只读 `content.json`；构建期渲染 bundle；Guard 白名单、prompt、角色骨架、修复提示全部切换 |
| Validator | 2.0 static/browser 规则；新增 3 个 good + 5 个 bad fixtures；fit 页 `CONTENT_CLIPPED` 拦截底部裁剪；flow 图示 >380px 升级为 error |
| Backend | `DeckStyle.design_system/page_theme/outline_override`；brief 下发 `content_schema/design_system/page_theme/scroll`；`outline_override` 走同一套 Pydantic 校验 |
| Frontend | manifest 类型支持 `renderer`/`teaching.scroll`；flow 页只拦截 ←/→，Space/PageDown 交给 iframe；flow iframe 可 Tab 聚焦 |

门禁：builder 44、validator 54、shell 18、frontend 20 测试全绿；backend 106 项通过（隔离库集成测试按默认跳过）。规范见 [PAGE_CONTENT_2.0.md](PAGE_CONTENT_2.0.md)。

### Phase 3 回归修正（2026-11-08）

真实生成 16 页后补了以下契约修正，均不影响 1.0：

- compare 角色从 fit 改为 flow：两栏对照 + 结论 + 检查在 1280×720 连续两次溢出约 290px；用户原始混合滚动要求只强制 practice/summary 单屏。
- summary 上限从 360 调到 380、下限 240 调到 220；fit 页最多 3 块。
- 公式 label / 路线标题支持行内 LaTeX；图示 SVG 标注禁止 LaTeX，靠右自动右对齐并夹在画布内。
- Validator 不再把 2.0 可见溢出误报为内容裁剪（仅检查真正的裁剪/滚动容器）；页面级 fit 裁剪仍保留。
- eyebrow 由 backend 的 `deck_context.chapter_title` 兜底，禁止把 section_id 当讲次。
- PageFrame 忽略 2.0 srcdoc 的首个 load，修复真实阅读器把正常挂载误判为外部跳转的问题。

复变函数 deck 结果见 [P15_RESULTS.md](P15_RESULTS.md)，成本见 [P15_COST.md](P15_COST.md)。
