# P4_REPORT.md · Deck 构建集成

> 日期：2026-11-07 ｜ 分支：`feat/pageref` ｜ 范围：P4（不含 P5 前端阅读器/工作台与 P6 页面助手）
> 结论先行：P4 的构建编排、最终校验门禁、bundle/缩略图存储、版本切换、重试、取消、超时与自愈已落地。后端默认测试 **69 passed**、隔离库集成 **3 passed**（P7 扩展为 6）；另用真实客户端打通容器协议链路。**真实 Pi 多页 E2E 已于 2026-11-07 使用 DeepSeek 官方 `deepseek-flash` 执行：14 页 Deck 全部 ready、14/14 Validator passed、0 issues、0 失败页，总耗时 15m11s，模型成本 ¥1.69（含规划）**；证据见 `P4_REAL_E2E.json` 与 `p4-real-screenshots/`。

## 1. 交付范围

| 模块 | 交付 |
| --- | --- |
| Builder 客户端 | `services/page_builder_client.py`：HMAC 签名（`X-MF-Timestamp`/`X-MF-Signature` = HMAC-SHA256(`ts.method.path.body`)，P7 起绑定 method/path）、创建/查询/事件/取 bundle/取消、超时、错误映射（409 冲突、503/504 不可用、其余请求错误） |
| Validator 客户端 | `services/page_validator.py`：Bearer token、报告结构校验、视口默认值、`passed/failed` 归一化；不可用时抛 `PageValidatorUnavailableError`（fail-closed） |
| Bundle 存储 | `services/bundle_store.py`：key 约定 `mockfinal/{user}/{workspace}/decks/{deck}/pages/{page}/{version}/{bundle.json,thumbnail.png}`、bundle 结构与大小校验、data URI 缩略图落盘、页面对象清理 |
| 页面编排 | `services/deck_builder.py`：`run_deck_build_job` 独立 `SessionLocal` + `tasks.spawn()`；规划后按 `PAGE_BUILDER_CONCURRENCY`（默认 2）并发逐页构建；Builder 事件转写；主 API 侧最终校验；失败页隔离；`DECK_PAGE_MAX_ATTEMPTS` 重试（默认 2，含首次） |
| 最终门禁 | Builder 成功的 bundle 必须再经主 API 调用 Validator 校验 `passed` 才保存并置 `ready`；校验失败带问题摘要重试，最终失败页面 `failed`，旧版本保持可读 |
| 状态机 | 首次构建 `planning → building`；整册重建/单页重建直接 `building`；聚合 `done/partial/failed/canceled`；单页 `planned → building → validating → ready/failed/canceled`；`rebuild_all` 逐页替换版本，单页重建只重建目标页 |
| 取消/超时 | `cancel_requested` 在轮询与页间检查；`POST /cancel` 取消活跃 job 并 best-effort 取消 Builder；单页超时 = Builder 超时 + Validator 超时；job 总超时 `DECK_JOB_TIMEOUT_SECONDS`（默认 1800s），超时取消在途 Builder、未完成页落失败 |
| 启动自愈 | lifespan 将遗留 `pending/planning/building/validating` job 置 failed，`building/validating` 页面与 `planning/building` Deck 置 failed；已 `ready` 页面与 bundle 保留 |
| 幂等补列 | 启动时幂等执行 `ADD COLUMN IF NOT EXISTS target_page_id / feedback`，兼容 P3 已建库 |
| API | `POST /api/decks/{id}/build`（首次/`rebuild_all`/`replan`）、`POST /api/decks/{id}/cancel`、`GET /api/deck-jobs/{id}`、`GET /api/deck-jobs/{id}/events?after_id=`、`GET /api/decks/{id}/pages/{page_id}`、`GET .../bundle`、`GET .../thumbnail`、`POST .../rebuild` |
| 配置 | `PAGE_BUILDER_URL/TOKEN/TIMEOUT_SECONDS/CONCURRENCY`、`PAGE_VALIDATOR_URL/TOKEN/TIMEOUT_SECONDS`、`DECK_PAGE_MAX_ATTEMPTS`、`DECK_JOB_TIMEOUT_SECONDS`；同步 `.env.example` 与 README |
| 测试 | 默认 `pytest` 69 项；P4 隔离库集成 3 项；另有真实容器协议检查（见第 2 节） |
| 文档 | 本报告；`AGENT.md` 构建流程、API 地图、陷阱与测试命令 |

**未改动**：`builder/`、`validator/`、`shared/` 的协议实现；未执行 git commit/push/merge。

## 2. 实际执行的验证

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 后端默认测试 | 测试容器内 `python -m pytest` | **69 passed in 1.84s** |
| P4 集成测试 | `P4_INTEGRATION=1 DATABASE_URL=.../mockfinal_p4_test PAGE_BUILDER_URL=http://builder.test ... pytest tests/test_decks_api.py` | **3 passed in 6.02s** |
| 镜像重建 | `docker compose up -d --build api` | 构建成功，API 容器重建并启动 |
| 健康检查 | `GET /api/health` | `{"status":"ok","database":"ok"}` |
| 依赖 | 容器内 `import httpx` | `httpx 0.28.1` |
| 幂等补列 | `information_schema.columns` | `deck_build_jobs.target_page_id`、`feedback` 均存在 |
| fail-closed 冒烟 | 注册→登录→工作区→Deck→`POST /build`→删除工作区 | build **503**「页面构建所需服务未配置：LLM…Builder…Validator…」；清理 204 |
| 真实协议链路 | 主 API 客户端（`PageBuilderClient`/`PageValidatorClient`）→ 容器 Builder（mock）→ 容器 Validator（真实 Chromium） | 创建 `bld_p4_protocol_1794037801`；Builder `succeeded`；bundle `page_bisect_001` **16414 bytes**；Validator **passed / 0 issues / 3 screenshots** |
| **真实 Pi 14 页 E2E** | 主 API（源码挂载）→ 本地 Builder（`mode=pi`，DeepSeek `deepseek-flash`）→ 本地 Validator | **job done，14/14 ready，0 failed；14 页 Validator 全部 passed、0 issues；attempts 均为 1；911s；¥1.69**；证据 `P4_REAL_E2E.json` |
| 真实页面阅读器 | 主 API + 前端（Vite 5173），1280×720，登录演示用户 | 总览显示 14/14 已就绪；阅读器 iframe `data-mp-ready=true`；**0 控制台错误**；截图 `p4-real-screenshots/reader-overview-1280.png`、`reader-page-1280.png` |

集成测试覆盖：首次构建 2 页（1 成功 1 失败 → Deck `partial`）、Validator 失败后重试直至上限、取消保留已 ready 页并取消 Builder、单页重建、`rebuild_all` 旧版本在新页成功前保持 ready、bundle/thumbnail API、跨用户 404、Builder 不可用 fail-closed。测试不依赖真实 LLM（monkeypatch 大纲/页面计划）与真实内部服务（`httpx.MockTransport`）。

> P7 加固补充（2026-11-07）：隔离库集成扩展为 **6 passed**，新增「12 页构建（并发 2、单页失败隔离、客户端断线后重连、失败页重试后整册收敛 ready）」与「启动自愈按页面可用性收敛 ready/partial/failed」；同时修复启动自愈 `select` 未导入导致整体跳过、单页重试后 Deck 状态不收敛两个缺陷。真实 Pi 14 页 E2E 已完成（见上表与 `P4_REAL_E2E.json`）。

真实 E2E 环境：演示工作区 8，新建资料《图论与网络算法》13 个分节，Deck 18（style density=`standard`）由规划器生成 **14 页**；主 API 独立容器（源码挂载，端口 8001）连接宿主机 Builder（9100，真实 Pi）与 Validator（9200）。构建期间客户端断线不影响任务；最终 14 页全部 ready、0 failed、每页 attempts=1。模型总消费从 ¥118.02 降至 ¥116.19（P2 门禁 ¥0.14 + P4 E2E ¥1.69 = **¥1.83**，预算 ¥10）。

协议检查环境：临时 Docker 网络、`mockfinal-api:pageref` 挂载源码运行 Python 客户端、`mockfinal-page-builder:pageref`（`PAGE_BUILDER_MOCK=1`）与 `mockfinal-page-validator:pageref`；检查后容器已停止。该检查证明内部协议与最终门禁可连通，**不代替**真实 Pi 生成质量门禁。

## 3. 单页构建流程

```text
job: building → 并发 worker（Semaphore = PAGE_BUILDER_CONCURRENCY）
  └─ page: planned → building（build_attempts+1）
      ├─ POST Builder /v1/builds（brief + feedback，build_id=bld_{page}_v{attempt}_{uuid}）
      ├─ 轮询 GET /v1/builds/{id} 与 /events?after_seq=（事件转写，cancel_requested 检查）
      ├─ succeeded → GET /v1/bundle → page: validating
      ├─ 主 API POST Validator /v1/validate（真实 Chromium，多视口）
      │   ├─ failed → 带 issues 摘要重试（若仍有次数）→ 新 build_id
      │   └─ passed → 保存 bundle/缩略图（新 version）→ 原子切换 current_version/bundle_key
      │                → page ready → job.ready_pages+1 → 事件 page_ready/validation
      └─ failed/超时/不可用 → page failed → job.failed_pages+1；job 继续其他页
job 收敛：全部页 ready→done；有成败混合→partial；全失败→failed；取消→canceled
Deck：任意构建/单页重建完成后按全部页面可用性收敛——全部 ready→ready；有可用页→partial；无可用页→failed
```

- **旧版本保护**：重建页在成功前 `current_version/bundle_key` 不切换；`rebuild_all` 中失败页保留旧 `ready` 与旧 bundle，Deck 记 `partial/failed` 但阅读器仍可读旧页。
- **失败隔离**：单页异常不会中断其他页；`gather` 内部逐页兜底，异常不向事件循环外溢。
- **事件预算**：Builder 事件按页分配预算，单条文本截断，单 job 最多 200 条；超出只记日志，不阻断构建。
- **取消语义**：客户端断开不取消（fire-and-forget）；只有显式 `POST /cancel` 置 `cancel_requested`。已 ready 页面保留。

## 4. 失败注入结果

| 场景 | 行为 | 验证方式 |
| --- | --- | --- |
| Builder 返回 503 | 页面失败，错误中文可见；Deck 聚合 `partial/failed` | 集成测试 `test_p4_builder_unavailable_fails_closed` |
| Builder 构建 failed/canceled | 页面失败并记录 Builder 错误；其他页继续 | 集成测试（首构建 1 失败页） |
| Validator 校验 failed | 页面带 issues 重试，达到 `DECK_PAGE_MAX_ATTEMPTS` 后失败 | 集成测试（重试计数） |
| Validator 不可用 | 页面直接失败，**不放行**（fail-closed） | 客户端单测 + 集成测试 |
| 单页/任务超时 | 单页取消在途构建；job 总超时终止并取消 Builder | 代码路径 + `_fail_job_timeout` 单测/逻辑检查；未做真实长时超时演练 |
| 取消 | 活跃 job `canceled`，已 ready 页保留，Builder 收到 cancel | 集成测试 |
| 服务重启 | 活跃 job/页/Deck 置 failed；ready 页保留 | P3 启动自愈测试沿用 |
| Deck/工作区删除 | 删除后页面 bundle 读取 404；存储对象 best-effort 清理 | 归属 404 集成测试；存储清理为尽力而为 |

## 5. 未实现项与边界

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 真实 Pi 多页 E2E | **已完成** | 14/14 ready、0 failed、全部 `passed`；规划器密度规则实际产出 14 页（`standard`，13 分节），超过原定 12 页规模；证据 `P4_REAL_E2E.json` |
| 真实 Pi 修复闭环质量 | 未触发 | 14 页均首轮通过，未产生 Validator 失败重试样本；代码路径仍由集成测试覆盖 |
| 多 API worker | 未实现 | 事件走 DB 轮询，单 worker 可用；多副本需 `LISTEN/NOTIFY` 或 Redis |
| 事件保留/清理 | 未实现 | 随 job/Deck 级联删除；30 天清理策略留待运维 |
| 构建队列背压 | 部分 | 主 API 侧并发受 `PAGE_BUILDER_CONCURRENCY` 限制；Builder 容器自身队列上限由其配置负责，未做跨服务全局配额 |
| 缩略图失败 | 容忍 | 缩略图保存失败只记日志，不影响页面 ready；前端需有占位图 |
| 中文文件名/资料 | 已覆盖 | 与 P1/P3 一致；本阶段未新增文件上传路径 |

## 6. 与 Plan 的偏差 / 实现取舍

1. **主 API 做最终门禁**：Builder 内部也会跑 Validator，但主 API 不信任构建侧结论，取 bundle 后再次调用 Validator；两次校验成本换 fail-closed 与防篡改。Validator 不可用时页面直接失败，不落库。
2. **重试次数语义**：`DECK_PAGE_MAX_ATTEMPTS=2` 表示含首次共 2 次；`next_page_attempt_action` 为纯函数，便于测试。Plan 中「修复 2 轮 + 后端重试 1 次」在此统一为可配置总次数，避免叠加成 4 次。
3. **单页超时**：以 `PAGE_BUILDER_TIMEOUT_SECONDS + PAGE_VALIDATOR_TIMEOUT_SECONDS` 作为单次尝试上限；Builder 侧还有自身 deadline，二者独立兜底。
4. **rebuild_all 不重规划**：复用现有页面计划与知识点；只有首次构建或 `replan=true`（且无页面/全部失败）才调用大纲规划。避免重建时页面结构漂移。
5. **反馈仅单页重建携带**：`job.feedback` 只在 `target_page_id` 匹配时传给 Builder，避免整册重建把单页意见扩散到所有页。
6. **测试门禁**：集成测试默认不收集（`P4_INTEGRATION=1` 才定义用例），避免无测试库环境出现 skip 噪音；测试库名必须含 `test`，测试会 drop 业务表。
7. **未新增 P4 报告前 AGENT 状态**：本报告落地后，`AGENT.md` 中「未执行真实容器端到端」的旧描述已更新为实际协议检查结果。