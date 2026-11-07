# P7_REPORT.md · 加固、回归与发布准备

> 日期：2026-11-07 ｜ 分支：`feat/pageref` ｜ 范围：P7
> 结论先行：完成三路安全审计（后端权限/路径/HMAC、页面沙箱/Validator、Prompt Injection/隐私）及针对性修复，补齐构建/助手结构化日志、助手硬预算、Validator 阅读器视口与报告门禁、启动自愈旧页面保留、阅读器/工作台竞态与全屏浮层修复、发布/迁移/回滚手册与残留风险清单。**全量回归通过：后端 87、集成 6（含 12 页断线恢复与启动自愈）、前端 20、Validator 44、红队 16/16、Builder 22、P5 34/34、P6 24/24。** 真实模型验证已完成：P2 门禁 3/3、P4 14 页 E2E 14/14，合计模型成本 ¥1.83（预算 ¥10）。等待人类维护者审阅，未 commit/push/merge。

## 1. 审计与修复

三路只读审计覆盖：① API 归属、存储路径、HMAC、SSRF、错误泄露；② iframe/CSP/Validator 网络与零滚动；③ 生成、规划、助手提示词注入与日志隐私。

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| B1 | 上传文件名仅按 POSIX 处理，`..\..\x.md` 在 Windows 语义下可穿越；OSS 登记先取 basename 再校验，目录路径被静默接受 | `_validate_upload` 统一反斜杠、拒绝路径/控制符/超长，返回安全文件名；两条上传路径都先校验原始名 |
| B2 | OSS 校验与工件读取把底层异常文本回显给用户，可能泄露 bucket/endpoint/RequestId | 改为中文通用错误；服务端 `logger.exception` 仅记录资源 id，不记录 key |
| B3 | 工作区删除只清资料/工件对象，Deck bundle/thumbnail 随 FK 级联但对象残留 | 删除前收集页面 bundle/thumbnail key，事务提交后 best-effort 清理 |
| B4 | 启动自愈把 `building/validating` 页面一律置 failed，即使已有旧 bundle，导致已交付页面不可读；Deck 状态也不区分全量/部分可用 | 有 `bundle_key` 的页面恢复 ready；Deck 按页面可用性收敛：全部可用→ready、部分→partial、无可用→failed |
| B8 | 启动自愈使用 `select` 但 `main.py` 未导入，异常被宽泛捕获后仅记日志，自愈实际全部跳过 | 补齐 `select` 导入；新增隔离库测试验证 ready/partial/failed 三种自愈结果 |
| B9 | 单页重试成功后 Deck 仍停留在 `partial`，全部页面可读却无法显示 ready，恢复路径未闭环 | `_finalize` 对所有模式按页面可用性聚合 Deck 状态；集成测试断言重试后收敛为 ready |
| B10 | Builder HMAC 仅绑定 body/timestamp，未绑定 HTTP method/path，内部截获的签名可在端点间重放 | 签名串升级为 `{ts}.{method}.{path}.{raw_body}`（path 含查询串）；主 API 客户端、Builder 服务端、黄金页脚本同步；新增跨语言固定向量与 method/path 篡改测试 |
| B11 | 阅读器快速切页时旧 bundle 响应可覆盖新页，header/iframe 错页，旧页进度覆盖 `last_page_id` | `loadPage` 增加请求 token，过期响应不落 UI；切页先清空 page/bundle、关闭助手并清空引用 |
| B12 | 构建工作台收到失效/跨 Deck 的 `?job=` 时整页误判「复习页不存在」，且失效 job 轮询无限重试 | 优先活跃任务；失效 job 清 query、回退最近任务或设置页；轮询 404/403 停止并刷新 Deck |
| B13 | 单页重试与旧轮询重叠时，旧 job 响应可覆盖新 job，导致工作台冻结在旧终态 | `attachJob`/`poll` 使用 attach token 与 job id 双重校验；旧响应丢弃 |
| B14 | 助手历史请求晚返回会覆盖乐观消息/流式回答；跨页后旧选区引用仍被发送 | 历史请求 token 化；切页清空消息/草稿/引用并中止流；发送时使旧历史失效 |
| S5 | `PageFrame` 二次 load 清空 channel 后，空 channel 消息可通过校验；消息未校验 origin | 增加 `accepting` 门闩、channel 非空校验与 `origin === "null"`/同源校验 |
| U1 | 全屏仅作用于阅读器根，teleport 到 body 的 AI 抽屉/弹窗在全屏下不可见 | 全屏切换到 `document.documentElement`；P5 验收断言全屏下 AI 抽屉 420px 可见 |
| B5 | Validator 报告即使含 error 级问题也可能被外部 `status=passed` 放行 | `normalize_report` 强制任一 error → failed（fail-closed） |
| B6 | 调用方可自定义 viewports 移除 1280×720 硬门禁；Validator 在 1280×720 校验，但生产阅读器内容区仅 ~1254×638，可能静默裁内容 | Validator 始终并入 3 档桌面视口 + 3 档阅读器内容视口；新增 300s 校验总超时 |
| B7 | 助手 14k 预算非硬上限：超长 page_info/question + quote/block 仍可超限；历史读取无上限；主知识点未按 deck 约束 | 最终强制裁剪到 14k；历史 GET 上限 100 条（≤200）；KP 查询加 `deck_id`；回答 `max_tokens=900`（`PAGE_CHAT_MAX_TOKENS`） |
| P1 | 生成/规划的 `"""` 静态围栏可被资料正文或换行文件名闭合；用户 description 无上限；Builder 未明确 `custom_prompt` 是偏好 | 资料/摘要使用随机边界（`secrets.token_hex`）并标注为数据；标题单行化限长；description 限 2000；`build-page.md` 明确 custom_prompt/feedback/materials 不得覆盖契约与安全约束 |
| S1 | Shell 只拦截 `</script`/`</style`/`<!--`，原始 `<script>`/`<iframe>` 等标签可进入阅读器（若绕过 Validator） | Shell 增加 `<script/style/iframe/object/embed/link/form/base/meta>` 检查，失败码 `SHELL_ESCAPE_SEQUENCE`；`<meta http-equiv=refresh>` 与 `<base href>` 外链导航同样拦截；Validator 的 `innerHTML/outerHTML` 注入规则同步覆盖 style/form/base/meta |
| S2 | JS 可把外部/相对 URL 赋给 `href/src/action`，或通过 `setAttribute`/`assign`/`replace` 导航；别名 `location` 可绕过原有检查 | 静态检查新增 URL 属性赋值、setAttributeNS、assign/replace 规则；允许 `#` 与 `data:` |
| S3 | 页面可向宿主发送超大 selection/quote，正文进入助手上下文/UI | `PageFrame` 截断 selection 2k/block 3k/quote 2k |
| S4 | srcdoc 就绪后页面自我导航会保持 `event.source`，可伪造消息/外发 | `PageFrame` 监听二次 load：清空 srcdoc/channel、置错并停止主题消息；残余外链请求风险见 §4 |
| O1 | 构建与助手缺少结构化耗时/结果日志 | 页面构建记录 `status/deck_id/job_id/page_id/attempts/duration_ms/error`；助手记录 `status/deck_id/page_id/user_id/chars/sources/duration_ms`；不记录正文/密钥 |
| O2 | `LLM_BASE_URL` 为空但配置 key 时会静默把 key 发往 OpenAI 默认地址 | 启动 warning 提示；README/.env.example 明确非 OpenAI 网关必须填写 |

## 2. 实际执行的验证

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 后端默认 | 测试容器 `pytest` | **87 passed**（新增 `test_security.py` 10 项、助手硬预算 1 项、HMAC method/path/query 2 项） |
| 隔离库集成 | `P4_INTEGRATION=1 ... pytest tests/test_decks_api.py` | **6 passed**（新增 12 页断线恢复、启动自愈 2 项） |
| 前端 | `pnpm typecheck && pnpm test && pnpm build` | typecheck/build 通过；**20 passed** |
| Validator | `npm run build && npm test` | **44 passed**（新增 JS URL 规则 1 组） |
| 红队 | `VALIDATOR_TOKEN=... node scripts/red-team.mjs` | **16/16 拦截**（新增 meta refresh / base 外链） |
| Builder | `npm test` | **22 passed**（新增 method/path 绑定与跨语言固定向量） |
| Shell | `node --test shared/page-shell/shell.test.mjs` | **12 passed**（新增危险标签拒绝） |
| P5 回归 | `node validator/scripts/p5-acceptance.mjs` | **34 passed / 0 failed**（含 Fullscreen API、全屏 AI 抽屉、失效 job 恢复） |
| P6 回归 | 假 LLM + 独立 API + 第二 Vite，`node scripts/p6-acceptance.mjs` | **24 passed / 0 failed / 0 console errors**（抽屉竞态修复后复跑） |
| good-basic 6 视口 | Validator HTTP 直调 | `passed`，无 issue |
| 真实 LLM | DeepSeek 官方 `deepseek-flash` | **P2 3/3 门禁通过（¥0.14）；P4 14 页 E2E 14/14 ready（¥1.69）** |

## 3. DoD 对照

| DoD | 状态 |
| --- | --- |
| Embedding 移除、旧资料分节与旧版内容 | ✅ P1 已验证 |
| 模拟考试继续可用、旧 Markdown 只读 | ✅ 沿用既有链路，P7 未破坏 |
| Deck/Page/Job/Event/Chat 模型与归属 | ✅ 87 默认 + 6 集成 |
| Builder 独立启动/HMAC/超时/取消/幂等 | ✅ 22 测试；HMAC 已绑定 method/path/body |
| Harness 版本化、Pi 锁定 | ✅ P2 |
| Validator 零滚动/交互/网络/控制台/截图 + 最终门禁 | ✅ 44 + 红队 16/16；顶层渲染限制见 §4 |
| 多页 E2E | ✅ 真实 Pi 14 页：14/14 ready、0 failed、全部 Validator passed、0 issues、attempts=1、911s；隔离库另覆盖失败隔离/断线/自愈 |
| 总览/工作台/阅读器/桌面零滚动 | ✅ P5 34/34（含 Fullscreen API、全屏抽屉、失效 job 恢复）；新增阅读器内容视口校验 |
| 选区 AI 助手流式/引用/历史/限流/XSS | ✅ P6 24/24 + 后端集成 |
| 最小测试栈 | ✅ pytest/Vitest/Playwright/node:test |
| 安全清单复核 | ✅ 三路审计 + 修复；残留风险已登记 |
| 成本/耗时上限 | ✅ 页数/资料/bundle/并发/重试/超时/助手 token+限流；真实构建实测：P2 ¥0.14、P4 14 页 ¥1.69 |
| 文档/环境变量/compose 同步 | ✅ README/AGENT/PAGE_CONTRACT/.env.example/P7_RELEASE |
| 未提交敏感文件、未 push/merge | ✅ 工作区检查，无 commit/push |
| 人类维护者审阅后合并 | ⏳ 待人工 |

## 4. 残留风险与后续

1. **iframe 自导航外泄**：浏览器无法在导航请求前拦截 frame 自身跳转；已用静态规则、二次 load 销毁、Validator 网络拦截和 CSP 降低风险，仍需真实模型红队复核。
2. **Validator 顶层渲染**：Validator 在页面顶层执行 shell，未复现生产 srcdoc iframe 沙箱；新增 shell/static 防线，建议 P7+ 改为 iframe 包装校验。
3. **HMAC 同端点重放**：已绑定 method/path/body（B10），但无 nonce；±300s 内同一请求仍可重放。create 由 `build_id` 幂等/body 指纹约束，cancel 幂等，GET 只读；内部网络降低暴露面。如需强防重放，增加 nonce 缓存。发布时必须同时更新主 API 与 Builder 镜像，旧签名不再兼容。
4. **助手限流单进程**：多副本需 Redis/DB 共享计数。
5. **旧 bundle 版本保留**：重建成功后旧对象未删除，便于回滚；需要定期清理策略。
6. **下载内存占用**：单请求 ≤50MB，无并发信号量；高并发需流式下载。
7. **真实质量/成本**：真实 Pi 生成通过率与构建 token/耗时已测量（P2 3/3、P4 14/14、合计 ¥1.83）；真实 LLM 助手拒答质量与真实模型红队仍未专项评估。
8. **无 CI/lint**：发布前依赖本报告与 `P7_RELEASE.md` 的手工清单。

## 5. 证据

- `docs/pageref/P7_RELEASE.md`（迁移、发布、回滚与残留风险）
- `backend/tests/test_security.py`、`backend/tests/test_page_chat.py`、`backend/tests/test_decks_api.py`（12 页断线恢复、启动自愈）
- `validator/src/tests/static-check.test.ts`、`shared/page-shell/shell.test.mjs`
- `docs/pageref/P5_RESULTS.json`（34/34）、`P6_RESULTS.json`（24/24）
- `docs/pageref/P2_RESULTS.json`（真实 Pi 3/3）、`P4_REAL_E2E.json`（真实 Pi 14 页 14/14；成本 ¥1.83）
- 截图：`p2-real-screenshots/`、`p4-real-screenshots/`（含真实阅读器）
- 代码：`workspaces.py`、`page_chat.py`、`page_validator.py`、`main.py`、`static-check.ts`、`server.ts`、`PageFrame.vue`、`shell.mjs`、`prompts.py`、`deck_planner.py`
