# P13_REPORT.md · 回归、成本与发布

> 日期：2026-11-08。范围：PageRef v2 P8–P13 收尾。原始数据见 `P13_RESULTS.json`；发布/回滚见 `P7_RELEASE.md`。
> 结论：功能与门禁全部通过，成本在预算内；**等待维护者审阅，未 commit/push/merge**。

## 1. 真实 14 页整册重建（主门禁）

| 指标 | 结果 |
| --- | --- |
| 任务 | Deck 18 整册重建，job 12，2 lane × Deck 会话复用 |
| 模型/配置 | `deepseek-flash`，thinking=low，compact prompt，schema 1.1 |
| 结果 | **14/14 ready，0 failed**，job `done` |
| 时长 | **940.8s**（约 15.7 分钟；P4 基线 911s，页面更厚但持平） |
| 教学结构 | 14/14 带 `manifest.teaching`，schema 1.1，`design_system=1.0` |
| 教学评分 | 14 页全部 **80**（最低 80，门槛 ≥70；`worked_example` 角色例题项按口径为 0） |
| 首轮通过 | **14/14**（每页 1 次后端构建、Builder `attempts=1`；无 retry 事件） |
| Validator | 14/14 `passed`，0 issues |
| CSS | 全部 ≤4,096 B（最大 4,082 B；中位数约 3,468 B） |
| 页面唯一性 | 14 个 `manifest.page_id` 唯一，无跨页内容串页 |
| 资料引用 | 每页 1–3 个 `source_refs`，无未核验知识点 |

角色分布：mechanism ×9、concept ×5（由该章知识点与角色序列决定；未强制凑齐六角色）。

逐页明细（标题/角色/评分/CSS/HTML/source_refs/检查数/预计分钟）见 `P13_RESULTS.json` 的 `pages` 字段。

## 2. 成本与缓存

| 项 | 数值 |
| --- | --- |
| DeepSeek 余额（E2E 前 → 后） | 114.06 → 112.53 CNY |
| 14 页 E2E 实际支出 | **¥1.53** |
| 遥测修复验证（单页重建 ×2） | **¥0.10** |
| P13 合计 | **¥1.63**（预算 ≤¥2） |
| P8–P13 累计 | **¥3.76**（总预算 ≤¥6，按会话开始余额 116.19 − 112.43）；其中 P11 报告累计 ¥1.96，另含 P11 结束至 P13 开始的 ¥0.17 未归属余额差 |
| 输入 / 输出 token | 246,317 / 274,052（14 页，约 17.6k / 19.6k 每页） |
| Cache read | 9,589,504 tokens，命中率 **97.5%** |
| Builder 记录用时 | 1,534,812 ms（两 lane 并行，故大于墙钟 940.8s） |

- 与 P8 基线（每页 20.7k–22.4k 输入、无 cache 记录）相比，输入下降约 15–21%，主要来自 lane 会话复用与 compact prompt。
- Builder `usage.cost` 恒为 0（Pi SDK 未计价）；成本以 DeepSeek 余额差为准，逐页 token 见 `P13_RESULTS.json.usage`。

## 3. 全量回归

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| 后端单元/编排 | `pytest tests -q`（Windows，单元） | **101 passed** |
| 后端 Deck 集成 | Linux 容器 `P4_INTEGRATION=1 pytest tests/test_decks_api.py` | **6 passed**（含 12 页断线恢复、启动自愈） |
| 前端 | `pnpm test && pnpm typecheck && pnpm build` | **20 passed**，类型/构建通过 |
| Builder | `npm test` | **31 passed** |
| Validator | `npm test`（需先停 9200 常驻实例） | **50 passed** |
| 红队 | `node scripts/red-team.mjs` | **16/16 拦截**（外链、eval、父窗口、超大 bundle、Shell 逃逸、iframe/form/meta/base 等） |
| P5 浏览器验收 | `validator/scripts/p5-acceptance.mjs` | **41/41**（P12 运行；此后前端/Validator 无变更） |
| 旧页面兼容 | Deck 4 的 1.0 bundle 经 `buildShell` 组装 | **3/3 正常**（schema 1.0 / runtime 1.0.0） |

> Windows 本机无法直接跑 async psycopg 集成测试（ProactorEventLoop 限制），P7 手册已规定用 Linux 测试镜像执行；这不是代码缺陷。

## 4. P13 发现并修复的问题

1. **内部 HTTP 客户端误用系统代理**：后端进程环境中的畸形代理导致 Builder/Validator 请求在构造 URL 时抛 `Invalid port`，14 页全部失败（无模型调用、无费用）。修复：Builder/Validator 客户端统一 `trust_env=False`。
2. **成功页用量未落库**：`_attempt_page` 成功返回时漏传 `build_id` 与 `usage`，导致 `deck_build_jobs.usage` 永远为空（失败/重试页才有）。修复并新增单测 `test_successful_page_records_usage`；用单页 job 14 验证真实落库（24,357 输入 / 24,038 输出 / 386,304 cache read）。
3. **E2E 采集口径**：后端事件镜像上限 200 条，末页 `page_ready` 会缺失；采集脚本改为分页拉事件，超出时回退 Builder 快照补齐构建页与首轮通过统计。

## 5. 发布与回滚

- 一键回退：`DECK_TEACHING_ENABLED=false`（回到旧契约）与 `DECK_SESSION_REUSE_ENABLED=false` + Builder `BUILDER_SESSION_MODE=page`（回到逐页会话）；无需回滚已生成页面。
- 详细顺序、数据迁移、HMAC 成对升级要求与回滚矩阵见 `P7_RELEASE.md`；P13 已补充新配置与门禁结论。
- 已知残留风险（iframe 自导航、HMAC 同端点重放、进程内限流等）与缓解见 `P7_RELEASE.md` §6.1。

## 6. 限制

- 教学评分是结构/承接启发式（满分 100），不等于人工教学审阅；本次全为 80 分，符合当前评分口径。
- 首轮通过率依赖 Builder 快照（后端事件镜像截断），任务 TTL 过期后只能退回事件口径。
- 成本依赖 DeepSeek 余额差；若后续更换供应商需同步更新计价口径。
- 本次未重新运行 P6 助手验收（P6 代码路径未变更），沿用 `P6_RESULTS.json` 的 24/24 证据。

## 7. 结论

P13 DoD 满足：真实 14 页 E2E 全绿、教学与设计门禁通过、成本 ¥1.63（P13）/ ¥3.59（累计）在预算内、四端回归与红队通过、旧 1.0 页面可读、发布/回滚可一键切换。
**待维护者签收后**方可 commit/push/merge。
