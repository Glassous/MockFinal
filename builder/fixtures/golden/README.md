# Golden Fixtures · P2 黄金用例

> 用途：为 P2「Pi Builder PoC」提供固定的 3 个页面 brief 与来源段落，用于评估 Harness（Skill / Prompt Template / Extension / 模型）的页面生成质量，并作为后续升级回归的基线（见 `../../../Plan.md` §6.8、§13.2）。目录中的资料为自编教学材料，仅用于评估，不来自真实用户上传，不进入用户数据。

## 1. 目录

```text
builder/fixtures/golden/
├── README.md                 # 本文件
├── bisect/
│   ├── brief.json            # 算法动画：二分查找区间收缩
│   ├── materials.md          # 来源段落（section_id 101–103）
│   └── bundle.json           # 黄金示例页面 bundle（手写基线，见第 6 节）
├── matrix/
│   ├── brief.json            # 公式推导：矩阵变换
│   ├── materials.md          # 来源段落（section_id 201–203）
│   └── bundle.json           # 黄金示例页面 bundle
└── timeline/
    ├── brief.json            # 叙事/时间线：人工智能简史
    ├── materials.md          # 来源段落（section_id 301–304）
    └── bundle.json           # 黄金示例页面 bundle
```

- `brief.json` 遵循 `../../../Plan.md` §8.5 的 PageBrief 结构：`page_id`、`deck_title`、`knowledge_point`、`source_excerpts`、`style`、`interaction_idea`、`constraints`、`previous_page`、`next_page`。
- `materials.md` 与 brief 的 `source_excerpts` 一一对应，`section_id` 不得随意改动；修改资料必须同步 brief。
- 三个 brief 的 `previous_page` / `next_page` 均为 `null`，按独立页面评估；不要为了“更像整册”而伪造相邻页上下文。

## 2. 页面与必需交互

| 目录 | page_id | 类型 | 必须体现的交互 | 内容硬要求 |
| --- | --- | --- | --- | --- |
| `bisect/` | `page_bisect_001` | 算法动画 | 区间收缩动画、可步进、当前 `[left, right]` 高亮 | 展示 mid、比较结果与排除的一半；不得只放静态代码 |
| `matrix/` | `page_matrix_001` | 公式推导 | 分步推导、网格图示、KaTeX 公式 | 矩阵列与基向量像的对应关系必须正确；复合顺序可见 |
| `timeline/` | `page_timeline_001` | 叙事/时间线 | 逐步揭示、时间线交互 | 至少 8 个节点，年份与事件准确；体现范式转移 |

## 3. 评估方法

每次修改 Skill、Prompt Template、Extension、模板或模型后，对 3 个 brief 各构建一次，按以下维度记录：

| 维度 | 方法 | 数据来源 |
| --- | --- | --- |
| 首轮通过率 | 第一次 `check_page` / 最终 Validator 即 `passed` 的页数 ÷ 3 | Validator 报告 |
| 修复后通过率 | 允许 1 轮修复后 `passed` 的页数 ÷ 3 | Builder 修复记录 + Validator 报告 |
| 零滚动 | 1280×720、1440×900、1920×1080 三个视口均无页面与内部滚动 | Validator 报告 |
| 交互冒烟 | 执行 `manifest.interactions[].smoke`，`expect` 出现或状态变化 | Validator 报告 |
| 外部请求数 | 页面加载与交互期间被拦截的非 `data:`/`blob:` 请求数量，目标为 0 | Validator 网络日志 |
| 控制台错误 | error 与 unhandled rejection 数量，目标为 0 | Validator 报告 |
| 静态违规 | 静态检查中 `error` 级问题数量，目标为 0 | Validator 报告 |
| 构建耗时 | 从 `POST /v1/builds` 到 bundle 交付的墙钟时间，记录 p50 / p90 | Builder 事件时间戳 |
| Token 使用 | 每页输入/输出 token，按模型网关返回值记录 | Builder 事件 / 网关日志 |
| 人工视觉评分 | 1–5 分：布局、信息层级、动效克制、内容准确、是否像“动态 PPT” | 人工评审 |

记录统一写入 `../../../docs/pageref/POC_ACCEPTANCE.md`，不要只留在聊天或临时文件中。

## 4. P2 门禁阈值（Plan §6.8）

| 指标 | 门槛 |
| --- | --- |
| 首轮校验通过率 | ≥ 2/3 |
| 修复 1 轮后通过率 | 3/3 |
| 零滚动 | 3/3（三个桌面视口） |
| 交互冒烟 | 3/3 |
| 外部请求 / 静态安全违规 | 0 |
| 单页构建耗时 p90 | ≤ 6 分钟（本地模型网关条件下可放宽，但必须记录） |
| 人工视觉评审 | 必须完成并记录；是否像“动态 PPT”由评审人给出结论 |

未通过则按 `../../../Plan.md` §6.9 启动 Plan B，不进入 P3 全量开发。

## 5. 使用规则

- 不得为了让门禁通过而修改 brief 降低要求；确需修改内容，必须记录原因并重跑全部基线。
- 不得把本目录资料当作真实用户数据或生产种子数据。
- 评估记录必须包含失败页面与失败原因；禁止只记录通过项。
- 路径与命令以 P2 实际实现的 Builder 接口为准；本目录不提供构建/评估脚本，避免虚构命令（第 6.4 节只给可直接复制的静态自检命令）。

## 6. 示例 bundle 说明

三个 `bundle.json` 是**手写基线**，用于对照 Harness 生成质量、校准 Skill/Prompt，并在 Validator 可用前充当契约样例。它们遵循 `docs/pageref/PAGE_CONTRACT.md`：`schema_version` `"1.0"`、`runtime_version` `"1.0.0"`、html 仅为 body 片段、CSS 只用 `--mp-*` 变量、JS 只用 `window.MockFinal`。

### 6.1 三个页面

| 目录 | page_id | layout | 结构 | 主交互 |
| --- | --- | --- | --- | --- |
| `bisect/` | `page_bisect_001` | `hero-side` | 10 格有序数组 + 状态句 + 右侧推演记录 | 下一步 / 跳到命中 / 重置；区间外单元格降透明，mid 反转高亮 |
| `matrix/` | `page_matrix_001` | `staged-derivation` | 左侧内联 SVG 网格（单位正方形与 SR 像平行四边形）+ 右侧 5 步推导 + SR/RS 矩阵对照 | 下一步 / 上一步 / 对比顺序；步骤逐条出现，图示与 RS 在对应步骤显示 |
| `timeline/` | `page_timeline_001` | `timeline` | 8 节点横向时间线 + 单节点详情 + 范式/易错侧栏 | 下一步 / 上一步 / 重置 / 点击节点；当前节点反转，未揭示节点虚线 |

### 6.2 冒烟动作（与 manifest 一致）

| 页面 | action | selector | expect | 说明 |
| --- | --- | --- | --- | --- |
| bisect | click | `[data-mp-action='step']` | `[data-mp-state='stepped']` | 单步推进一轮，根状态由 `idle` 变为 `stepped` |
| bisect | click | `[data-mp-action='solve']` | `[data-mp-state='hit']` | 一次点击直达命中（第 3 轮） |
| matrix | click | `[data-mp-action='step']` | `[data-mp-state='columns']` | 展开第 1 步「列观点」 |
| matrix | click | `[data-mp-action='compare']` | `[data-mp-state='compared']` | 直达第 5 步，RS 矩阵出现 |
| timeline | click | `[data-mp-action='next']` | `[data-mp-state='current'][data-mp-index='1']` | 推进到 1956 节点 |
| timeline | click | `[data-mp-action='node'][data-mp-index='5']` | `[data-mp-state='current'][data-mp-index='5']` | 直接点击 2012 节点 |

- 冒烟遵循「一次点击、确定性、`expect` 初始不存在」：bisect 的 `step` 只推进一轮，命中由独立的 `solve` 一步到达；不要改成连点三次才出现 `hit`。
- 所有可点击元素都是 `<button type="button">`，有文本，键盘 Tab + Enter/空格可用；焦点样式 `:focus-visible` 使用 `--mp-ink` 描边。
- 每页 `MockFinal.ready` 恰好调用一次；`html[data-mp-reduced-motion="true"]` 与 `prefers-reduced-motion` 下关闭全部过渡，状态立即生效。

### 6.3 刻意的约定（不要当作用户数据）

- `material_id` 固定为 `0`：黄金资料不在数据库，`0` 表示「本地黄金资料占位」；接入真实 Deck 时由后端替换为真实 `material_id`。
- `knowledge_point_ids` 使用 `kp_golden_bisect` / `kp_golden_matrix` / `kp_golden_timeline`：黄金用例没有真实大纲；真实构建必须使用大纲给出的 ID。
- `source_refs[].heading` 是 `materials.md` 的小节标题，便于人工核对；`quote` 为原文片段。
- 公式不使用 KaTeX 或任何外部资源：`matrix` 用内联 SVG + HTML/CSS 排版的矩阵块 + Unicode 符号呈现；brief 中的「KaTeX」要求与契约禁止外链冲突，以契约为准（`PAGE_CONTRACT.md` 第 13 节 O-1 仍未冻结）。
- 三个页面按独立页面评估：brief 的 `previous_page` / `next_page` 均为 `null`，页面不伪造相邻页。

### 6.4 自检方法（在仓库根目录执行）

```bash
# 1) JSON 可解析 + 关键字段 + 禁用字符串（无输出异常即通过）
node -e "const fs=require('fs');for(const d of ['bisect','matrix','timeline']){const b=JSON.parse(fs.readFileSync('builder/fixtures/golden/'+d+'/bundle.json','utf8'));const s=JSON.stringify(b);const bad=['http://','https://','fetch(','eval(','localStorage','postMessage','</script','</style','@import'].filter(x=>s.includes(x));console.log(d,b.schema_version,b.runtime_version,b.manifest.page_id,'smoke='+b.manifest.interactions.length,bad.length?'BAD '+bad:'clean');}"

# 2) HTML 禁止标签（应无输出）
node -e "const fs=require('fs');for(const d of ['bisect','matrix','timeline']){const b=JSON.parse(fs.readFileSync('builder/fixtures/golden/'+d+'/bundle.json','utf8'));const bad=[...b.html.matchAll(/<\s*\/?\s*([a-zA-Z][\w-]*)/g)].map(x=>x[1].toLowerCase()).filter(t=>['html','head','body','script','style','link','iframe','object','embed','meta','form'].includes(t));if(bad.length)console.log(d,bad);}"
```

- 零滚动、控制台错误、网络拦截与冒烟执行需要 Validator（Playwright）：`check_page` / Validator 可用后必须对三个 bundle 各跑一次，并记录到 `docs/pageref/POC_ACCEPTANCE.md`。
- 本目录未运行 Playwright，因此**不声称**零滚动与冒烟已在浏览器中通过；第 3 节的评估表仍按实际执行结果填写。

