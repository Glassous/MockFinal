# P3_REPORT.md · Deck 领域、规划与页面计划

> 日期：2026-11-07 ｜ 分支：`feat/pageref` ｜ 范围：P3（不含 P4 构建集成与 P5 前端）
> 结论先行：P3 后端能力已落地并通过纯函数测试与独立 Postgres 集成测试；**规划完成不代表页面就绪**——P3 的 build 只生成大纲与页面计划，页面保持 `planned`，真实 Builder/Validator 集成留待 P4。

## 1. 交付范围

| 模块 | 交付 |
| --- | --- |
| 数据模型 | `models.py` 新增 `review_decks`、`knowledge_points`、`deck_pages`、`deck_build_jobs`、`deck_build_events`、`page_chat_messages`；全部 `JSONB`/UTC；workspace→deck→page/job/event/chat 级联 |
| 启动自愈 | lifespan 把遗留 `deck_build_jobs`（pending/planning/building/validating）、`deck_pages`（building/validating）、`review_decks`（planning/building）置 failed；随后幂等创建 `uq_deck_job_active` 部分唯一索引。P4/P7 更新：有旧 bundle 的页面改为保持 ready，Deck 按页面可用性收敛为 ready/partial/failed（见 AGENT.md 与 P7_REPORT） |
| Schemas | `DeckStyle`（中文预设别名 → `editorial/blueprint/drill/story`，密度、内容偏好、custom_prompt ≤500）、Deck/Page/Job/Event/Progress/Build/PageBundle/Message 模型，长度与枚举边界校验 |
| 规划服务 | `services/deck_planner.py`：大纲 prompt、JSON 提取（代码块/说明文字/嵌套括号）、Pydantic + 业务约束校验、最多 2 次自动修复、source_refs 解析与回退、页面计划、Page Brief |
| 编排服务 | `services/deck_builder.py`：`run_deck_build_job`（独立 `SessionLocal`、`tasks.spawn()`）、source_signature、事件（stage/text/error，≤4KB、≤200 条）、取消检查、`build_page_briefs(deck_id)` |
| 路由 | `routers/decks.py` 并在 `main.py` include：Deck 列表/创建/详情/更新/删除、build/cancel、job/events、page/bundle/rebuild、progress、messages |
| 配置 | `Settings` 新增 `DECK_MIN_PAGES/DECK_MAX_PAGES/DECK_MAX_MATERIAL_CHARS/DECK_MAX_BUNDLE_BYTES`，同步 `backend/.env.example` 与 README |
| 测试 | 43 个新增用例（含 2 个集成），见第 2 节 |
| 文档 | 本报告；`AGENT.md` 数据模型、API 地图、核心流程、陷阱与测试命令 |

**未改动**：`builder/`、`validator/`、`shared/`、`Plan.md` 既有决策；未执行 git commit/push。

## 2. 实际执行的验证

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 语法编译 | `python -m compileall -q app` | 通过 |
| 后端默认测试 | Docker 测试容器内 `python -m pytest` | **47 passed, 2 skipped**（2 个集成用例默认跳过） |
| 集成测试 | `P3_INTEGRATION=1 DATABASE_URL=.../mockfinal_p3_test LLM_API_KEY=test-key python -m pytest` | **49 passed**（含 2 个集成用例） |
| 镜像重建 | `docker compose up -d --build api` | 构建成功、容器启动 |
| 启动/健康 | `/api/health` | `{"status":"ok","database":"ok"}`；日志显示「业务表初始化完成」「启动自愈与唯一索引/补列初始化完成」 |
| 表与索引 | `psql \dt` / `pg_indexes` | 6 张新表存在；`uq_deck_job_active`、`ix_deck_build_events_job_id_id` 存在 |
| 启动自愈 | 测试库预置 planning job / building deck / building page 后重启 lifespan | 三者均变 `failed`，job.error=「服务重启导致规划/构建任务中断，请重新发起」；索引创建成功 |
| OpenAPI | `/openapi.json` | 11 条 Deck 路径全部注册 |
| 真实服务冒烟 | 容器内 httpx 走注册→工作区→创建/列表/详情/PATCH/404/删除 | 创建 200、删除 204、删除后 404；PATCH 只改密度时保留预设 |

测试环境：临时 `postgres:17`（库名 `mockfinal_p3_test`，仅测试用，测试开始会 drop 业务表）+ `mockfinal-api:pageref` 镜像挂载 `backend/` 后安装 pytest/pytest-asyncio。未写入仓库。

## 3. 规划中间态与状态语义

```text
POST /api/decks/{id}/build → job pending → planning
  → 读取分节 / source_signature → LLM 大纲（校验 + 修复）
  → source_refs 回退 → 页面计划 → 写 knowledge_points + deck_pages(planned)
  → job done, progress=100, stage="规划完成；页面构建待 P4 接入", deck=draft
```

- `job.total_pages` 是**计划页数**；`ready_pages=0`、`failed_pages=0`，页面全部 `planned`。
- 不调用 Builder/Validator、不写 `bundle_key`、不标 ready；`GET .../bundle` 返回 404「页面尚未生成」。
- 已有页面时再次 build 返回 409；`replan=true` 仅当无页面或全部页面失败；`rebuild_all=true` 返回 503（P4）。
- 取消：`POST /cancel` 只设 `cancel_requested`，后台在 LLM 前后与写库前检查并落 `canceled`；客户端断开不取消。
- 失败：规划异常 → job/deck `failed`，`error` 中文截断，写 error 事件；服务重启由 lifespan 自愈。

## 4. 源引用回退策略（source_refs）

1. **有效引用**：`section_id` 存在于当前 workspace 的 `material_sections` → 生成 `{material_id, section_id, heading, quote}`，`quote` 取正文前 200 字，`unverified=false`。
2. **无效引用**：id 不存在 / 非整数 → 该知识点标记 `unverified=true`；若提供关键词（知识点标题 + key_points 前 5 + objectives 前 3），在当前 workspace 分节中回退匹配：标题命中 +3/关键词、正文命中 +1/关键词，最高分 ≥2 且未被占用才采用；回退 ref 仍标 `unverified=true`，不伪造出处。
3. **无匹配**：不生成 ref；知识点保留空引用；大纲写入时若 `section_ids` 为空且 summary 未注明，自动追加「资料未覆盖」。
4. **Page Brief**：`source_excerpts` 单节 ≤6000 字、总量 ≤12000 字，按 objectives/key_points 命中数优先保留；`source_meta` 记录 `truncated_section_ids`、`missing_section_ids`、`unverified` 与预算。`source_meta` 是 P3 新增的扩展字段（Plan §8.5 结构之外），仅供 P4/前端诊断。

## 5. 未实现项与边界

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 真实 Builder/Validator 集成（P4） | **未实现** | 未写 builder client、bundle 存储、版本切换、修复闭环；`rebuild_all` 与单页 rebuild 返回 503 |
| 前端阅读器/工作台（P5） | **未实现** | 未改 `frontend/`；Deck 类型与页面组件留待 P5 |
| 页面 AI 助手（P6） | **未实现** | 表已建；GET messages 返回已存历史（通常空），POST 返回 503 |
| 真实 LLM 大纲 | **未实测** | 缺少可用 `LLM_API_KEY`/网关；测试用 monkeypatch 固定大纲，生产路径由真实网关决定 |
| 多 worker 事件通道 | 未实现 | 事件走 DB 轮询（`after_id`），单 API worker 下可用；多副本需 `LISTEN/NOTIFY` 或 Redis |
| 事件保留策略 | 未实现 | 当前随 job/Deck 级联删除；30 天清理策略留待运维 |

## 6. 与 Plan 的偏差 / 实现取舍

1. **`knowledge_points` 章节行**：为章节创建 `parent_id` 为空的行，叶子知识点挂其下；大纲快照同时存于 `review_decks.outline`。页面计划索引只指向叶子知识点。
2. **页面计划合并**：当知识点数超过密度上限（如 16 个知识点 + concise 上限 9）时，将多余知识点合并到已有页面的 `kp_indices`，保证总数 6–16 且每个知识点至少覆盖一次；前 N 个知识点各有一页 primary。真实流程由大纲限制 6–16 个知识点，正常不会触发。
3. **`DeckOut` 扩展字段**：增加 `active_job_id` 与页面摘要 `has_bundle`，便于前端判断；不影响既有契约。
4. **进度合并语义**：`completed_page_ids` 采用并集（只增不减），避免多标签页互相回退；`last_page_id` 为覆盖写。
5. **删除级联**：Deck 子表使用 `passive_deletes=True`，由数据库 `ON DELETE CASCADE` 完成，避免自引用知识点删除告警；删除 Deck 前 best-effort 设置活跃 job 的 `cancel_requested`。
6. **测试配置**：`backend/pytest.ini` 增加 `asyncio_mode = auto` 与 fixture loop scope，供 2 个集成用例使用。
7. **配置范围**：只新增 P3 实际使用的 4 个 `DECK_*` 变量；§8.8 中 Builder/Validator 相关变量在 P4 接入时再加。
