# P2_REPORT.md · Pi Builder PoC 评估报告

> 日期：2026-11-07 ｜ 分支：`feat/pageref` ｜ 基线 commit：`cea3a1f` + 未提交的 P0–P2 改动
> 结论先行：**P2 基础设施与真实 Pi 生成门禁均已执行并通过（Go）。** 2026-11-07 使用 DeepSeek 官方 API `deepseek-flash` 完成 3 个黄金页真实构建：3/3 首轮校验通过、0 issues、单页 82.6–157.2s，模型成本 **¥0.14**；截图归档于 `p2-real-screenshots/`。代理视觉评分为 4 / 4 / 5，建议维护者复核签收。

## 1. 基线与环境

| 项 | 值 |
| --- | --- |
| Node | v24.21.0（Builder 镜像 node:24-slim；Validator 官方镜像内 Node v26.13.0） |
| Pi | `@earendil-works/pi-coding-agent@1.5.0`（锁定） |
| Harness | `harness_version=0.1.0`（Skill / Prompt / Template / Guard Extension） |
| 页面契约 | `schema_version=1.0`、`runtime_version=1.0.0`（`PAGE_CONTRACT.md` v0.1） |
| Validator | `@playwright/test@1.65.0` + Chromium，镜像 `mcr.microsoft.com/playwright:v1.65.0-noble` |
| 模型 / 网关 | DeepSeek 官方 API（`https://api.deepseek.com/v1`），模型 `deepseek-flash`（DeepSeek-V4.1-Flash）；密钥仅存于被忽略的 `backend/.env` |
| 构建模式 | 真实 Pi（`mode=pi`，未启用 `PAGE_BUILDER_MOCK`） |

## 2. 交付范围

| 模块 | 交付 |
| --- | --- |
| 共享运行时 | `shared/page-runtime/runtime.js`：7 个 Runtime API、channel 信封、选区/错误/尺寸上报、reduced-motion |
| 共享 Shell | `shared/page-shell/shell.mjs`：CSP、token、`</script`/`</style` 转义、bundle 大小与版本校验 |
| Validator | 静态检查（parse5 + acorn AST）、Playwright 三视口零滚动/网络拦截/控制台/交互冒烟/截图/a11y、Bearer 鉴权、结构化报告 |
| Builder | 内部 HTTP + HMAC + 并发队列 + 超时/取消 + 事件流；Pi SDK 会话适配；Guard Extension；`check_page`/修复闭环；bundle 打包；Mock 模式 |
| Harness | Skill 8 步工作流 + 5 份 references；`/build-page` Prompt Template；页面脚手架；3 个黄金示例 bundle |
| 脚本 | `builder/scripts/run-golden.mjs`（门禁执行器）、`validator/scripts/red-team.mjs`（红队执行器） |
| 文档 | `PAGE_CONTRACT.md`、`INTERNAL_API.md`、`DECISIONS.md`、`POC_ACCEPTANCE.md`、本报告 |

## 3. 实际执行的验证

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 后端 P1 回归 | Docker 内 `pytest` | **6 passed** |
| 前端 | `pnpm test` / `pnpm typecheck` | **2 passed / 通过** |
| Validator 单元 + 浏览器测试 | `cd validator && npm test` | **43 passed**（含真实 Chromium） |
| Builder 单元 + HTTP 测试 | `cd builder && npm test` | **20 passed**（HMAC、路径守卫、事件、MOCK E2E、fail-closed） |
| 黄金页直连 Validator | `POST /v1/validate`（3 个手写 bundle，三视口） | **3/3 `passed`，0 issues，单页 1.3–1.4s** |
| Builder Mock 本地 E2E | `run-golden.mjs --base http://127.0.0.1:9100` | **3/3 succeeded，单页约 2.0s**（报告 `P2_RESULTS.mock.json`） |
| Builder + Validator 容器 E2E | 只读根 + cap_drop ALL + no-new-privileges，内部网络 | **3/3 succeeded，单页约 1.0s**（报告 `P2_RESULTS.container-mock.json`） |
| 容器安全属性 | `docker inspect` | `ReadonlyRootfs=true`、`CapDrop=[ALL]`、`no-new-privileges:true` |
| 红队 | `validator/scripts/red-team.mjs` | **14/14 拦截**（P2 时点；P7 扩充至 16/16，结果见 `POC_ACCEPTANCE.md` §6） |
| **真实 Pi 黄金页门禁** | Builder + Validator 本地实跑，`BUILDER_TOKEN=... npm run gate:run` | **3/3 succeeded；Validator 全部 `passed`，0 issues；`mode=pi`、`mock=false`**；报告 `P2_RESULTS.json` |

### 3.1 黄金页面（手写示例，非 Pi 生成）

| 页面 | 零滚动 1280/1440/1920 | 交互冒烟 | 外部请求 | 控制台错误 | 静态违规 | 校验耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| `page_bisect_001` | 通过 / 通过 / 通过 | 2/2 通过 | 0 | 0 | 0 | 1447ms |
| `page_matrix_001` | 通过 / 通过 / 通过 | 2/2 通过 | 0 | 0 | 0 | 1419ms |
| `page_timeline_001` | 通过 / 通过 / 通过 | 2/2 通过 | 0 | 0 | 0 | 1333ms |

- 三个 bundle 均为手写、用于固定页面契约与 Validator 行为；它们证明「契约 + 校验器 + 运行时」可用，**不证明 Pi 能生成同等质量的页面**。
- matrix 页面未使用 KaTeX：当前契约禁止外部资源，KaTeX 的引入方式（shell 注入或 bundle 自包含）仍是冻结项 O-1；示例改用内联 SVG + HTML 矩阵排版。

### 3.2 真实 Pi 生成结果（2026-11-07）

| 页面 | 状态 | 首轮校验 | 构建耗时 | 输入 / 输出 tokens | 代理视觉评分 | Validator |
| --- | --- | --- | --- | --- | --- | --- |
| `page_bisect_001` | succeeded | 通过（attempts=1） | 102.8s | 20,672 / 16,831 | 4 / 5 | passed，0 issues，6 截图 |
| `page_matrix_001` | succeeded | 通过（attempts=1） | 157.2s | 22,393 / 26,471 | 4 / 5 | passed，0 issues，6 截图 |
| `page_timeline_001` | succeeded | 通过（attempts=1） | 82.6s | 22,088 / 13,088 | 5 / 5 | passed，0 issues，6 截图 |

- 合计输入 65,153 / 输出 56,390 tokens；账户余额 ¥118.02 → ¥117.88（**¥0.14**，远低于 ¥10 预算）。
- 三页均一次生成即通过，无修复轮次；零滚动覆盖 1280×720、1440×900、1920×1080 与 3 档阅读器内容区。
- 截图：`docs/pageref/p2-real-screenshots/`（每页 6 张）；页面事件与 usage 见 `P2_RESULTS.json`。

## 4. 已执行项与残留

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 真实 Pi 构建 3 个黄金页 | **已完成** | 3/3 succeeded，Validator 全部 passed，0 issues |
| 首轮通过率、修复后通过率 | **已测** | 首轮 3/3；无需修复轮次 |
| 单页构建耗时 p90 / token | **已测** | p90 157.2s；输入 65,153 / 输出 56,390 tokens；成本 ¥0.14 |
| 代理视觉评审（1–5 分） | **已完成** | 4 / 4 / 5；截图在 `p2-real-screenshots/`，维护者签收待办 |
| 人工视觉签收 | **待办** | 不阻塞工程门禁；建议维护者抽看截图 |
| REDUCED_MOTION_IGNORED 检测 | 未实现 | Validator 已设置 `data-mp-reduced-motion`，但未检测页面是否真的降级；列为后续增强 |
| 主 API ↔ Builder 集成 | **已完成** | P4 已接入 Deck 编排；真实 12+ 页 E2E 见 `P4_REPORT.md` |

## 5. 与计划/契约的偏差

1. **Mock 模式不是门禁证据**：Builder 启动日志与报告均标记 `mock=true`；Gate 结论必须使用 `mode=pi` 的 `P2_RESULTS.json`。
2. **内部创建接口返回 202**（`/v1/builds`），主 API 对外仍保持 200 约定；仅内部接口。
3. **Validator 失败码**在 `INTERNAL_API.md` 与 `PAGE_CONTRACT.md` 的早期草案间存在命名差异（如 `JS_FORBIDDEN_API` vs `FORBIDDEN_JS_API`），实现以 `INTERNAL_API.md` 为准并记录在 `validator/README.md` 第 9 节。
4. **KaTeX 未冻结**（O-1）：为满足「无外链」硬约束，示例不加载 KaTeX；后续需决定 shell 注入 KaTeX 资源或允许受限内联。
5. **Mock bundle 查找**：优先 `PAGE_BUILDER_MOCK_BUNDLE`，否则扫描 `fixtures/golden/*/bundle.json` 的 `manifest.page_id`；生产镜像不包含 fixtures。
6. **页面事件与截图**：门禁 runner 默认 `screenshot=false`；本次已用 Validator `screenshot=true` 复验并归档每页 6 张截图。

## 6. P2 Gate 结论与复现

**结论：Go。** 6 项工程门槛全部满足：首轮 3/3、零滚动 3/3、交互冒烟 3/3、外部请求/静态违规 0、p90 157.2s、安全红队 16/16；真实模型为 DeepSeek 官方 API `deepseek-flash`，成本 ¥0.14。人工视觉评分由代理完成 4 / 4 / 5，维护者复核签收为发布前待办。

复现步骤：

1. 在 `backend/.env` 配置 `LLM_BASE_URL=https://api.deepseek.com/v1`、`LLM_API_KEY`、`LLM_MODEL=deepseek-flash`（密钥文件已被 `.gitignore` 忽略）。
2. 启动 Validator 与 Builder（设置 `BUILDER_TOKEN`、`VALIDATOR_TOKEN`，Builder 额外设置 `PAGE_BUILDER_MODEL=deepseek-flash`，不要启用 `PAGE_BUILDER_MOCK`）。
3. 执行：

   ```bash
   cd builder
   BUILDER_TOKEN=<token> npm run gate:run -- --base http://<builder>:9100
   ```

   输出 `docs/pageref/P2_RESULTS.json`（`mode=pi`、`mock=false`、每页 usage/validation）。
4. 需要截图时，用 Builder bundle 调 Validator `POST /v1/validate`（`screenshot=true`），归档到 `p2-real-screenshots/`。

## 7. 主要风险与观察

- **Pi SDK 适配已在真实模型下完成 3 页会话**：工具调用、`check_page` 与最终校验均正常；首轮 3/3 通过。
- **零滚动**在真实生成页面上 6 视口全部通过；内容密度仍是主要风险，Skill 的内容预算与拆页建议有效。
- **Validator 单次校验约 1.7s（含截图）**；不会成为构建瓶颈。
- **安全边界**：Builder 不执行页面代码；Validator 在只读、cap_drop、网络拦截下运行；红队 16/16 拦截。
- **模型成本**：黄金页 3 页共 ¥0.14；按此估算 14 页 Deck 约 ¥0.7，远低于本次 ¥10 预算。
