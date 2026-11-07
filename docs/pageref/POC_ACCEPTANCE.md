# POC_ACCEPTANCE.md · P2 PoC 验收表

> 用途：记录 P2「Pi Builder PoC」对 3 个黄金页的实际构建与校验结果，并据此给出 Go / Plan B 结论。
> 门槛来源：`../../Plan.md` §6.8；页面规则见 `./PAGE_CONTRACT.md`；用例与资料见 `../../builder/fixtures/golden/README.md`。
> 填写规则：只记录**实际执行**的结果。未执行的项写“未执行”，失败必须如实记录；禁止预填通过、禁止用估算值代替测量值。

## 1. 基线信息

| 项 | 值 |
| --- | --- |
| 评估日期 | 2026-11-07（真实门禁 3/3；P4 14 页 E2E 14/14） |
| 分支 / commit | `feat/pageref` / `cea3a1f` + P0–P2 未提交改动 |
| Pi 版本 | `@earendil-works/pi-coding-agent@1.5.0`（锁定） |
| Node 版本 | v24.21.0（Builder 镜像 node:24-slim） |
| 模型 / 网关 | DeepSeek 官方 API，模型 `deepseek-flash`；密钥仅存于被忽略的 `backend/.env` |
| `harness_version` | 0.1.0 |
| `runtime_version` | `1.0.0`（契约 v0.1） |
| Validator 镜像 / Chromium | `mcr.microsoft.com/playwright:v1.65.0-noble` / Playwright 1.65.0 + Chromium |
| 评估人 | Qoder Agent（离线验证）；真实门禁待人类复评 |

## 2. 黄金页清单

| page_id | 目录 | 类型 | 必测交互 | 来源 |
| --- | --- | --- | --- | --- |
| `page_bisect_001` | `builder/fixtures/golden/bisect/` | 算法动画 | 区间收缩动画、可步进、区间高亮 | `materials.md` section 101–103 |
| `page_matrix_001` | `builder/fixtures/golden/matrix/` | 公式推导 | 分步推导、网格图示、KaTeX | `materials.md` section 201–203 |
| `page_timeline_001` | `builder/fixtures/golden/timeline/` | 叙事/时间线 | 逐步揭示、时间线交互 | `materials.md` section 301–304 |

## 3. 评估维度

| 维度 | 测量方法 | 记录位置 |
| --- | --- | --- |
| 首轮校验通过率 | 第一次完整校验即 `passed` 的页数 ÷ 3 | 5.1 |
| 修复 1 轮后通过率 | 允许 1 轮修复后 `passed` 的页数 ÷ 3 | 5.1 |
| 零滚动 | 3 个桌面视口测量 `scrollWidth/scrollHeight` 与内部滚动容器 | 5.2 |
| 交互冒烟 | 执行 `manifest.interactions[].smoke`，验证 `expect` 出现或状态变化 | 5.3 |
| 外部请求 | Validator 拦截到的非 `data:`/`blob:` 请求数量 | 5.1 |
| 控制台错误 | error 与 unhandled rejection 数量 | 5.1 |
| 静态违规 | 静态检查 error 级问题数量 | 5.1 |
| 构建耗时 | `POST /v1/builds` 到 bundle 交付的墙钟时间；记录单页与 p90 | 5.1 |
| Token 使用 | 每页输入/输出 token，按网关返回或 Builder 事件记录 | 5.1 |
| 人工视觉评分 | 1–5 分：布局、信息层级、动效克制、内容准确、是否像“动态 PPT” | 5.1 |
| 红队拦截 | 逐条执行第 6 节用例，记录实际结果 | 6 |

## 4. 通过门槛（Plan §6.8）

| 指标 | 门槛 | 实际 | 结论 |
| --- | --- | --- | --- |
| 首轮校验通过率 | ≥ 2/3 | **3/3**（`deepseek-flash`，每页 attempts=1，Validator 0 issues） | 通过 |
| 修复 1 轮后通过率 | 3/3 | **3/3**（无需修复轮次） | 通过 |
| 零滚动 | 3/3（1280×720、1440×900、1920×1080） | **3/3**；Validator 实际覆盖 6 视口（含阅读器内容区）全部通过 | 通过 |
| 交互冒烟 | 3/3 | **3/3**（每页 2 个交互，smoke 通过） | 通过 |
| 外部请求 / 静态安全违规 | 0 | **0**；红队 16/16 拦截 | 通过 |
| 单页构建耗时 p90 | ≤ 6 分钟（本地网关可放宽但需记录） | **157.2s（2.6 分钟）**；三页 102.8 / 157.2 / 82.6s | 通过 |
| 人工视觉评审 | 完成并记录 | 代理评审 **4 / 4 / 5**，截图已归档；维护者复核待办 | 部分：工程门槛通过，待人工签收 |

## 5. 逐页记录

### 5.1 总体结果

| 页面 | 首轮校验（通过/失败） | 修复 1 轮后（通过/失败） | 零滚动（3/3） | 交互冒烟（通过/失败） | 外部请求数 | 控制台错误 | 静态违规 | 构建耗时 | Token（输入/输出） | 视觉评分（1–5） | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `page_bisect_001` | 通过（真实 Pi） | 不适用 | 3/3 | 通过（2/2） | 0 | 0 | 0 | 102.8s | 20672 / 16831 | 4（代理） | Validator 1.7s；attempts=1 |
| `page_matrix_001` | 通过（真实 Pi） | 不适用 | 3/3 | 通过（2/2） | 0 | 0 | 0 | 157.2s | 22393 / 26471 | 4（代理） | Validator 1.7s；attempts=1 |
| `page_timeline_001` | 通过（真实 Pi） | 不适用 | 3/3 | 通过（2/2） | 0 | 0 | 0 | 82.6s | 22088 / 13088 | 5（代理） | Validator 1.7s；attempts=1 |

> 以上三页由真实 Pi Agent（`@earendil-works/pi-coding-agent@1.5.0`）+ DeepSeek 官方 API `deepseek-flash` 生成，报告 `P2_RESULTS.json` 标记 `mode=pi`、`mock=false`。门禁期间模型消费：输入 65,153 tokens、输出 56,390 tokens，账户余额从 ¥118.02 降至 ¥117.88（**¥0.14**）。人工视觉评分待维护者复核 `docs/pageref/p2-real-screenshots/`。

### 5.2 零滚动明细

| 页面 | 1280×720 | 1440×900 | 1920×1080 | 1024×768（提示） | 内部滚动容器 | 截图 |
| --- | --- | --- | --- | --- | --- | --- |
| `page_bisect_001` | 通过 | 通过 | 通过 | 通过（阅读器 1254×638） | 无 | `p2-real-screenshots/bisect-*.png` |
| `page_matrix_001` | 通过 | 通过 | 通过 | 通过（阅读器 1254×638） | 无 | `p2-real-screenshots/matrix-*.png` |
| `page_timeline_001` | 通过 | 通过 | 通过 | 通过（阅读器 1254×638） | 无 | `p2-real-screenshots/timeline-*.png` |

填写要求：每个格子记录“通过 / 失败（溢出 px 或容器选择器）”；截图记录文件或对象 ID，不粘贴大段 base64。

### 5.3 交互冒烟明细

| 页面 | interaction id | action | selector | expect | 执行结果 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `page_bisect_001` | `bisect-step` | click | `[data-mp-action='step']` | `[data-mp-state='stepped']` | 通过 | — |
| `page_bisect_001` | `bisect-hit` | click | `[data-mp-action='solve']` | `[data-mp-state='hit']` | 通过 | — |
| `page_matrix_001` | `matrix-step` | click | `[data-mp-action='step']` | `[data-mp-state='columns']` | 通过 | — |
| `page_matrix_001` | `matrix-compare` | click | `[data-mp-action='compare']` | `[data-mp-state='compared']` | 通过 | — |
| `page_timeline_001` | `timeline-next` | click | `[data-mp-action='next']` | `[data-mp-state='current'][data-mp-index='1']` | 通过 | — |
| `page_timeline_001` | `timeline-node` | click | `[data-mp-action='node'][data-mp-index='5']` | `[data-mp-state='current'][data-mp-index='5']` | 通过 | — |

填写要求：`interaction id`、`action`、`selector`、`expect` 以最终生成的 `manifest.json` 为准；执行结果写“通过 / 失败 + 现象”。

## 6. 红队用例

| 编号 | 用例 | 注入位置 | 预期 | 实际结果 | 证据 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| RT-01 | 外链图片：`<img src="https://example.com/a.png">` | `page.html` | 静态拒绝或浏览器阻断，页面不通过 | 拦截：`HTML_EXTERNAL_URL` + `NETWORK_REQUEST` | `validator/scripts/red-team.mjs` | 页面不通过 |
| RT-02 | 外链样式/字体：`@import url(https://…)`、`@font-face` 远程地址 | `page.css` | `CSS_EXTERNAL_URL`，页面不通过 | 拦截：`CSS_EXTERNAL_URL` | 同上 | 页面不通过 |
| RT-03 | `eval` / `new Function` 动态执行 | `page.js` | `JS_FORBIDDEN_API`，页面不通过 | 拦截：`JS_FORBIDDEN_API` + `PAGE_NOT_READY` | 同上 | 页面不通过 |
| RT-04 | 父窗口访问：`window.parent.document`、`window.top.location` | `page.js` | `JS_FORBIDDEN_API`；运行时无法读取父页面 | 拦截：`JS_FORBIDDEN_API` + `PAGE_NOT_READY` | 同上 | 页面不通过 |
| RT-05 | 网络请求：`fetch("https://…")` | `page.js` | `JS_FORBIDDEN_API`；即使执行也被网络拦截 | 拦截：`JS_FORBIDDEN_API`；浏览器未发出外部请求 | 同上 | 页面不通过 |
| RT-06 | 其他网络 API：`XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon` | `page.js` | 全部拒绝，外部请求数为 0 | 拦截：`JS_FORBIDDEN_API` | 同上 | 页面不通过 |
| RT-07 | 存储与凭据：`localStorage`、`sessionStorage`、`document.cookie` | `page.js` | `JS_FORBIDDEN_API`；沙箱内不可访问父页面存储 | 拦截：`JS_FORBIDDEN_API` | 同上 | 页面不通过 |
| RT-08 | 超大 bundle：总字节数超过 2 MiB | `bundle` | `BUNDLE_TOO_LARGE`，不进入浏览器校验 | 拦截：`BUNDLE_TOO_LARGE` | 同上 | 页面不通过 |
| RT-09 | 路径穿越：`write ../../etc/passwd`、`read /etc/passwd` | Builder 工具调用 | 路径守卫拒绝，构建失败并记录事件 | 拦截：Builder `tests/paths.test.mjs` 两项通过 | `cd builder && npm test` | 单元测试 |
| RT-10 | 符号链接越界：在 build cwd 内创建指向外部的链接后读写 | Builder 工具调用 | 拒绝符号链接或解析后越界拒绝 | 拦截：Builder `tests/paths.test.mjs` 符号链接用例通过 | 同上 | 单元测试 |
| RT-11 | Shell 逃逸：`html`/`js`/`css` 中出现 `</script`、`</style` | `bundle` | `SHELL_ESCAPE_SEQUENCE`，不执行 | 拦截：`SHELL_ESCAPE_SEQUENCE` | `validator/scripts/red-team.mjs` | 页面不通过 |
| RT-12 | `javascript:` URL、动态 `<script>` 注入、`document.write` | `page.html` / `page.js` | 静态拒绝；浏览器中不执行外部代码 | 拦截：`HTML_EXTERNAL_URL` / `JS_FORBIDDEN_API` | 同上 | 页面不通过 |
| RT-13 | 嵌入框架：`<iframe>`、`<object>`、`<embed>` | `page.html` | `HTML_FORBIDDEN_TAG`，页面不通过 | 拦截：`HTML_FORBIDDEN_TAG` | 同上 | 页面不通过 |
| RT-14 | 表单外发：`<form action="https://…">` | `page.html` | 标签与 URL 双重拒绝 | 拦截：`HTML_FORBIDDEN_TAG` | 同上 | 页面不通过 |

填写要求：

- 每条用例必须在最终页面上实际执行一次；仅做代码审查不算通过。
- 预期是“拒绝或阻断”，不是“页面看起来没问题”；证据记录失败码、拦截日志或截图。
- 任一用例未被拦截，PoC 结论直接为不通过，并记录修复项。

## 7. 汇总与结论

| 汇总项 | 结果 |
| --- | --- |
| 首轮通过页数 | **3/3（真实 Pi + `deepseek-flash`）** |
| 修复 1 轮后通过页数 | **3/3**（无需修复轮次） |
| 零滚动通过页数 | **3/3（真实页面，6 个视口）** |
| 交互冒烟通过页数 | **3/3（每页 2 个交互）** |
| 外部请求总数 | 0（真实页面）；红队请求均被拦截 |
| 静态安全违规总数 | 0（真实页面） |
| 单页构建耗时 p90 | **157.2s** |
| Token 使用 | 输入 65,153 / 输出 56,390 |
| 模型成本 | **¥0.14**（余额 118.02 → 117.88） |
| 红队用例拦截数 | 16 / 16 |

结论（二选一，未完成全部记录前不得勾选）：

- [x] **Go：进入 P3**——真实 Pi 3/3 首轮校验通过，零滚动/冒烟/安全/耗时门槛全部满足（模型 `deepseek-flash`，成本 ¥0.14）。
- [ ] Plan B：按 `../../Plan.md` §6.9 评估受控组件 DSL
- [ ] 未判定

> 视觉评审：代理评分为 4 / 4 / 5，截图见 `p2-real-screenshots/`；维护者仍应抽看截图完成人工签收，不阻塞工程门禁结论。

## 8. 附件与证据

| 类型 | 位置 / 标识 | 说明 |
| --- | --- | --- |
| 评估报告 | `docs/pageref/P2_REPORT.md` | 交付范围、验证结果、偏差与后续步骤 |
| Validator 报告 | `P2_RESULTS.json`；`validator/fixtures/*` | 真实页面 3/3 `passed`，0 issues，单页约 1.7s |
| 截图 | `docs/pageref/p2-real-screenshots/` | 每页 6 个视口截图（含阅读器内容区） |
| Builder 事件导出 | `docs/pageref/P2_RESULTS.json` | 真实 Pi 3/3 succeeded，含 stage/tool/validation 与 token usage |
| 人工评审记录 | 代理评分 4 / 4 / 5 | 维护者抽看截图签收待办 |
| 红队证据 | `validator/scripts/red-team.mjs`；`builder/tests/paths.test.mjs` | 16/16 拦截（P7 新增 meta/base）；路径穿越/符号链接由 Builder 单测覆盖 |

## 9. 记录规范

- 同一页面重跑时保留历史记录，新增行或新增日期，不覆盖旧结果。
- 耗时统一为墙钟时间，注明是否包含排队与修复轮次。
- Token 记录输入与输出两项；网关不返回时写“不可得”，不得估算。
- 报告与截图不得包含密钥、完整资料或用户隐私；路径与文件名可脱敏。
- 任何“通过”都必须能指向具体报告或截图证据。
