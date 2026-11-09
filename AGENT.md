# AGENT.md · MockFinal 工作区指南

> 本文件是所有 Agent 的**必读入口**。开始工作前依次阅读：
> 1. `AGENT.md`（本文件）—— 项目是什么、在哪里、怎么跑；
> 2. `RULE.md` —— 代码规范、验证要求与 Git 纪律；
> 3. `DESIGN.md` —— 仅前端/视觉改动时阅读。
>
> 文档与代码冲突时以代码为准，并顺手修正文档。

## 1. 项目速览

**MockFinal（期末终极复习助手）**：按科目建工作区，上传课程资料（**仅 md / txt**），
LLM 通读全文后生成两份 Markdown 成品：

- 《期末终极复习》：章节结构 / 核心概念 / 重点公式 / 易错点 / 复习优先级；
- 《期末模拟考试》：选择 / 填空 / 简答 / 综合 + 独立「参考答案与解析」。

数学公式统一使用 KaTeX `$...$` / `$$...$$` 语法。复习页（Deck）进一步把知识点拆成
逐页可交互的 PageContent 2.0 页面，并提供页面 AI 助手。

**运行形态：Qoder Sites 全量 Serverless。** 静态前端、单个 Deno Edge Function、
托管 PostgreSQL 与私有 Storage 全部在站点内，不依赖自托管服务、Docker、nginx 或云厂商 AK。

| 维度 | 选型 |
| --- | --- |
| 前端 | Vue 3.5 `<script setup>` · TypeScript strict · Vite 8 · Pinia 4 · vue-router 5 |
| 样式 | Tailwind CSS 4（CSS-first）· lucide 图标 · 语义 token |
| 函数 | Deno Edge Function `app`（单入口 `Deno.serve`）· 零第三方依赖 |
| 数据库 | Qoder Sites 托管 PostgreSQL（仅 `app.*`、无事务/外键/serial） |
| 存储 | Qoder Sites 私有 Storage，签名直传 / 302 下载 |
| AI | OpenAI 兼容 Chat Completions（默认 `qwen-plus`，环境变量可换） |
| Markdown | markdown-it + KaTeX（MathML）+ highlight.js + DOMPurify |

## 2. 目录结构

```text
MockFinal/
├── AGENT.md / RULE.md / DESIGN.md / README.md
├── frontend/                     # Vue 静态站点（构建到 frontend/dist）
│   └── src/
│       ├── api/                  # client.ts + 各资源封装（decks.ts 含 advance/问答）
│       ├── views/                # Login/Register/Forgot/Home/Workspace/DeckOverview/DeckBuild/DeckReader
│       ├── components/deck/      # 路线图/工作台/构建台/PageFrame/选区/助手抽屉
│       ├── lib/                  # pageShell、mathUpgrade、deck 纯函数、markdown、upload
│       ├── stores/               # auth / theme / toast / workspace
│       └── types/index.ts        # 与函数契约逐字对齐
├── functions/                    # 唯一 Edge Function app
│   ├── index.ts                  # Deno.serve 入口
│   ├── router.ts                 # 路径归一化 + 方法分派
│   ├── routes/                   # auth · workspaces · materials · generation · artifacts · decks · health
│   ├── lib/                      # db/storage/jwt/auth/parse/section/llm/corpus/planner/json-chat/prompts
│   │   └── page-kit/             # PageContent 2.0 校验与渲染（纯 TS，公式占位）
│   ├── migrations/               # 0001 表 · 0002 索引 · 0003 构建 cursor/lease
│   └── tests/                    # Node 原生 node:test 纯函数单测
├── shared/                       # 浏览器端页面 shell 与 runtime（阅读器复用）
├── docs/serverless/              # 平台边界、生成流水线说明
└── scripts/smoke-sites.mjs       # 线上端到端冒烟
```

`backend/`、`builder/`、`validator/`、`design_lab/` 与 Docker 配置均已删除，不再作为修改目标。

## 3. 运行时入口

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| 函数入口 | `functions/index.ts` | 平台注入 `_qoder/backend.mjs`、`_qoder/storage.mjs` |
| 路由 | `functions/router.ts` | 接受 `/api/...` 与 `/functions/v1/app[-d<hex>]/...` |
| 前端 API 前缀 | `frontend/src/api/base.ts` | 默认 `/functions/v1/app`，`VITE_API_BASE` 可覆盖 |
| 前端应用 | `frontend/src/main.ts` | Pinia、router、主题、全局 401 |
| 设计系统 | `frontend/src/style.css` | 颜色/圆角/阴影/动画唯一来源 |

本地只验证纯函数与前端构建；函数运行依赖平台注入模块，不在本地启动。

## 4. 数据模型（`functions/migrations/`）

13 张表，全部 `app.*`；主键由 `lib/ids.ts` 在应用侧生成 bigint（< 2^53），无 serial/identity。

| 表 | 关键字段 | 状态 |
| --- | --- | --- |
| `users` | `username`、`password_hash`、`security_*`、`token_version` | — |
| `workspaces` | `user_id`、`name`、`description` | — |
| `materials` | `workspace_id`、`storage_key`、`size`、`chunk_count` | `uploaded → indexing → indexed / failed` |
| `material_sections` | `material_id`、`workspace_id`、`ordinal`、`heading`、`content` | 解析时整批替换 |
| `generation_jobs` | `workspace_id`、`status`、`stage`、`cursor`、`lease_*`、`usage` | `pending → running → done / failed` |
| `artifacts` | `workspace_id`、`job_id`、`kind`（`review`/`exam`）、`storage_key` | 每 job 各一份 |
| `review_decks` | `workspace_id`、`title`、`status`、`style`、`outline`、`source_signature` | `draft → building → ready/partial/failed/canceled` |
| `knowledge_points` | `deck_id`、`parent_id`、`ordinal`、`importance`、`objectives/key_points/formulas/misconceptions/source_refs` | 章节行与知识点行 |
| `deck_pages` | `deck_id`、`knowledge_point_ids`、`ordinal`、`kind`、`status`、`current_version`、`bundle_key`、`manifest`、`validation` | `planned → building → ready / failed` |
| `deck_build_jobs` | `deck_id`、`status`、`stage`、`cursor`、`lease_*`、`target_page_id`、`feedback`、页计数 | `pending → running → done/partial/failed/canceled` |
| `deck_build_events` | `job_id`、`page_id`、`type`、`payload`、`created_at` | 前端 `after_id` 增量拉取 |
| `page_chat_messages` | `user_id`、`deck_id`、`page_id`、`role`、`content`、`quote`、`context_refs` | user/assistant 两条落库 |
| `auth_limiter` | `username`、`ip`、`fail_count`、`window_start` | 密保失败限流 |

- 时间统一 ISO 8601 UTC；存储 key 由服务端派生，绝不信任前端传入路径。
- 无事务：多表写入顺序执行、单语句落库；失败即停，所有写入可重放。
- 计数器（`ready_pages` 等）在阶段结束时从 `deck_pages` 重算，不依赖增量累加。

## 5. 核心流程

### 5.1 认证

自建 JWT（HS256，`JWT_SECRET` Secret）+ PBKDF2 密码哈希。除 `/api/health` 与
`/api/auth/*` 外均要求 `Authorization: Bearer <JWT>`；他人资源一律 404。
密保找回使用 `auth_limiter` 做 5 次 / 15 分钟失败限制；重置密码递增 `token_version`。

### 5.2 资料上传与索引

```text
POST /workspaces/:id/upload-credentials?filename=
  → Storage 签名上传 URL（key 由服务端派生）
PUT 签名 URL（浏览器直传，函数不转发文件体）
POST /workspaces/:id/materials {filename, storage_key, size, content_type}
  → 校验归属/后缀/大小 → 读取对象 → md/txt 分节 → 写 material_sections
  → status = indexed（失败写中文错误）
```

- 仅 `md` / `txt`，单文件 ≤ 8 MiB（Storage 单对象上限 10 MiB）。
- 分节目标 1200 字；`section.ts` 为纯函数，单测覆盖。
- `storage_key` 必须匹配服务端派生前缀，拒绝 `..` 与控制字符。

### 5.3 全文生成（map-reduce，无截断）

```text
POST /workspaces/:id/generate → {job_id}
POST /jobs/:job_id/advance     ← 前端循环调用，每次只做一次主要 LLM 调用
```

cursor 阶段：`map → reduce → outline → review → exam → assemble → done`。

1. `corpus.ts` 把全部已索引资料按 20,000 字分块（400 字重叠），不截断全文。
2. `map`：逐块生成 ≤1200 字 digest（带 `§section_id` 来源），写
   `jobs/{uid}/{jobId}/digest/L0-{i}.md`。
3. `reduce`：每 4 份 digest 合并一层（≤1500 字），直到 ≤4 份或总长 ≤20,000 字。
4. `outline`：最终 digest → 严格 JSON 章节（4–10 章）→ `outline.json`。
5. `review`：逐章生成 1200–2200 字 Markdown → `review/{i}.md`。
6. `exam`：固定 5 片（选择/填空/简答/综合/参考答案）→ `exam/{i}.md`。
7. `assemble`：读回全部分片拼成两篇 Markdown → 先 Storage 后 `artifacts` 表。

- 单次 `advance` 一次 LLM 调用；`LLM_TIMEOUT_SECONDS` 60；租约 120s，429/502 释放租约让前端退避。
- `chatJson` 做宽松 JSON 提取 + 一次修复重试；非法输出落中文错误，不伪造内容。
- 同一 job 的分片 key 固定，重放 advance 覆盖写，天然幂等。

### 5.4 复习页构建

```text
POST /decks/:id/build            → {job_id, deck_id}
POST /deck-jobs/:job_id/advance  ← 前端驱动
POST /decks/:id/cancel           保留已就绪页面
POST /decks/:id/pages/:page/rebuild
```

cursor 阶段：`index → reduce → plan → detail → page → render → done`。

1. `index` / `reduce`：与生成相同的全文 digest。
2. `plan`：最终 digest + 风格 → 严格 JSON（3–6 章、6–16 个知识点）→ 写
   `knowledge_points`，`planner.ts` 按密度生成 6–16 页计划 → 写 `deck_pages(planned)`。
3. `detail`：逐章补全知识点的 objectives/key_points/formulas/misconceptions/source_refs；
   资料未覆盖时明确标注，不编造来源。
4. `page`：逐页组装 brief（≤12,000 字，含引用 section 原文）→ LLM 输出 PageContent 2.0 JSON
   → `decks/{deckId}/jobs/{jobId}/pages/{pageId}.json`。
5. `render`：`page-kit` 静态校验；有错且 `attempts < 2` 时带问题清单修复一次；
   通过后 `renderPage` 生成 bundle（`schema_version: 1.1`，≤2 MiB）→ 写
   `decks/{deckId}/pages/{pageId}/v{n+1}.json` → 条件更新 `current_version` → `page_ready` 事件。
6. `done`：按页面可用性收敛 deck 为 `ready / partial / failed`，写 `source_signature`。

- 单页重做只跑 `page → render → done`，不重规划；旧 bundle 在新版本成功前保持可读。
- 取消把 `building` 页面恢复为 `ready`（有旧 bundle）或 `planned`，已就绪页面不丢失。
- 同一 Deck 同时只允许一个活跃 job（应用层 409）；租约防止并发推进。

### 5.5 页面渲染与公式

- 函数内不运行浏览器：`page-kit` 只做结构与预算校验，并输出
  `<span class="mf-tex" data-tex="..." data-display="0|1">` 占位。
- 前端 `lib/mathUpgrade.ts` 在 `buildPageShell` 前把占位替换为 KaTeX MathML；
  公式不合法时显示原文，不阻断页面。
- 阅读器 iframe 固定 `sandbox="allow-scripts"`，**绝不加 `allow-same-origin`**。
- 阅读器使用 `shared/page-shell` 与 `shared/page-runtime`，不复制第二份实现。

### 5.6 页面 AI 助手（非流式）

```text
GET  /decks/:deckId/pages/:pageId/messages     最近 30 条
POST /decks/:deckId/pages/:pageId/messages     {content, quote?, block_text?}
  → 校验页面归属 / LLM 已配置 / content ≤ 2000 字
  → 上下文 = 页面 manifest + 所属知识点 + quote/block_text
  → 一次 chat 调用（maxTokens 900）
  → 落库 user + assistant 两条，返回 {message_id, content, refs}
```

- `refs` 只来自知识点的 `source_refs`；命中不到资料时标 `unverified`，不伪造引用。
- 前端仍用 `streamPageMessage` 调用，但实现改为一次性回填（`onDelta` 一次 + `onDone`）。
- 输出按不可信 Markdown 处理：`html:false` + KaTeX + DOMPurify。

## 6. API 地图

前缀 `/api`（站点内为 `/functions/v1/app`）。错误体统一 `{ "detail": "中文文案" }`；
删除 204；未登录 401；他人资源 404；冲突 409。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{status:"ok", database:"ok"\|"unreachable"}` |
| POST | `/auth/register` · `/auth/login` | 返回 token + user |
| GET | `/auth/me` · `/auth/security-question?username=` | 当前用户 / 密保问题 |
| POST | `/auth/verify-answer` · `/auth/reset-password` | 找回密码 |
| GET/POST | `/workspaces` | 列表 / 创建 |
| GET/PATCH/DELETE | `/workspaces/:id` | 详情 / 更新 / 级联删除 |
| POST | `/workspaces/:id/upload-credentials` | Storage 签名上传 URL |
| GET/POST | `/workspaces/:id/materials` | 资料列表 / 登记并解析 |
| DELETE | `/materials/:id` | 删除资料 |
| GET | `/materials/:id/download` | 302 到签名下载地址 |
| POST | `/workspaces/:id/generate` | 创建生成 job → `{job_id}` |
| GET | `/jobs/:id` · `/jobs/:id/events` | 任务快照 / 增量事件 |
| POST | `/jobs/:id/advance` | 推进一个生成工作单元 |
| GET | `/workspaces/:id/artifacts` | 工件列表 |
| GET/DELETE | `/artifacts/:id` | Markdown 全文 / 删除 |
| GET/POST | `/workspaces/:id/decks` | Deck 列表 / 创建 |
| GET/PATCH/DELETE | `/decks/:id` | 详情（含页面摘要/进度/active_job_id）/ 更新 / 删除 |
| POST | `/decks/:id/build` · `/decks/:id/cancel` | 创建整册构建 / 取消活跃任务 |
| GET | `/deck-jobs/:id` · `/deck-jobs/:id/events` | 构建任务快照 / 增量事件 |
| POST | `/deck-jobs/:id/advance` | 推进一个构建工作单元 |
| GET | `/decks/:id/pages/:page` · `/bundle` | 页面元数据 / bundle（有旧版本即可读） |
| POST | `/decks/:id/pages/:page/rebuild` | 单页重做（body `{feedback?}`） |
| PATCH | `/decks/:id/progress` | `last_page_id` / `completed_page_ids` |
| GET | `/decks/:id/pages/:page/thumbnail` | 暂不提供，404（前端有占位） |
| GET/POST | `/decks/:id/pages/:page/messages` | 页面问答历史 / 非流式提问 |

## 7. 前端结构约定

- **路由**：`/login`、`/register`、`/forgot` 为访客页；未登录访问受保护页带 `redirect` 跳登录。
  守卫使用 vue-router 5 返回值写法，**不要 `next()`**。
- **API 层**：所有请求走 `src/api/client.ts`（Bearer、`{detail}` 解析、401 跳登录）；
  组件内不直接 `fetch`。
- **状态**：Pinia setup store；登录/登出必须 `workspaceStore.reset()`。
- **推进循环**：`WorkspaceView` 与 `DeckBuildView` 由前端循环调用 `advance`；
  429/502 退避 1.2s/3s，其余错误 2s 兜底；组件卸载必须清理定时器。
- **Markdown**：`html:false` + KaTeX + DOMPurify 后才允许 `v-html`。
- **视觉**：只使用 `style.css` 的语义 token，先读 `DESIGN.md`。

## 8. 不可破坏的契约与陷阱

1. **函数零第三方依赖**：只用 WebCrypto、`fetch`、平台注入的 `_qoder/*`；不得 `npm:` 引入包。
2. **`_qoder/*` 仅存在于平台**：单测不得静态 import `lib/db.ts` / `lib/storage.ts`；
   纯逻辑拆到独立模块，或使用动态 import。
3. **无事务 / 无外键**：删除按子表→父表手工级联；多表写入可重放；计数器最后重算。
4. **主键应用侧生成**：禁止 serial/identity；不要依赖数据库默认值。
5. **Storage key 服务端派生**：`materials/{uid}/{wid}/...`、`decks/{deckId}/...`；
   拒绝 `..`；签名 URL 不进日志、错误体或持久化。
6. **LLM 输出不可信**：JSON 必须结构校验；页面内容必须经 `page-kit` 校验后才可 `ready`；
   Markdown 必须清洗。
7. **无后台 worker**：任务必须可由 `advance` 从 cursor 续跑；刷新/断网不得丢任务。
8. **页面 ready 必须有真实产物**：bundle + `current_version` 同时写成功；不得伪造或跳过校验。
9. **旧版本可读**：单页重做/取消期间，已有 `bundle_key` 的页面继续返回旧版本。
10. **Secrets 只在平台**：`JWT_SECRET`、`LLM_*` 由 Sites Secrets 注入；不提交、不打印、不在对话中传输。
11. **契约字段逐字对齐**：`functions/lib/serializers.ts` ↔ `frontend/src/types/index.ts` ↔ `api/*.ts`。
12. **前端不承载业务事实**：权限、状态机、任务终态以函数返回为准。

## 9. 常见任务导航

| 任务 | 应该改哪里 |
| --- | --- |
| 新增/修改接口 | `functions/routes/*.ts` → `functions/router.ts` 注册 → `types/index.ts` → `api/*.ts` |
| 修改数据表 | 新增 `functions/migrations/000N_*.sql` + `serializers.ts` + 前端类型 |
| 调整分块/生成策略 | `lib/corpus.ts`、`lib/prompts.ts`、`routes/generation.ts` |
| 调整页面规划/构建 | `lib/planner.ts`、`routes/decks.ts`、`lib/page-kit/**` |
| 调整公式/页面外观 | `lib/page-kit/**`、`shared/page-shell/**`、`frontend/src/lib/mathUpgrade.ts` |
| 页面问答 | `routes/decks.ts`（`createPageMessage`）、`lib/prompts.ts`、`DeckAssistantDrawer.vue` |
| 前端新页面 | `router/index.ts` + `views/*View.vue` + `layouts/AppLayout.vue`；先读 `DESIGN.md` |
| 平台常量/限额 | `docs/serverless/PLATFORM_LIMITS.md` + `lib/config.ts` |

## 10. 验证与完成定义

```bash
cd frontend && pnpm test && pnpm typecheck && pnpm build
cd frontend && npx tsc --noEmit -p ../functions/tsconfig.json
node --test "functions/tests/*.test.ts"
SITES_BASE_URL=https://<site> node scripts/smoke-sites.mjs   # 需已配置 LLM Secrets
```

- [ ] 只改必要文件，没有顺手重构、调试日志或临时文件；
- [ ] 前端 `pnpm test` / `typecheck` / `build` 通过；UI 改动已在浏览器验证主路径与边界状态；
- [ ] 函数类型检查与纯函数单测通过；
- [ ] 契约、环境变量、README / AGENT / RULE / DESIGN 中受影响部分已同步；
- [ ] 未提交密钥、构建产物或临时探测脚本；
- [ ] 未获人类明确指示不推送、不合并。
