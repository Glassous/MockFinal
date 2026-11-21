# MockFinal · 期末复习助手（Serverless / Qoder Sites）

上传课程资料（**仅 md / txt**），AI 提炼后生成两份 Markdown 成品：
**《期末终极复习》**（考纲概览 / 核心概念 / 重点公式 / 易错点 / 记忆口诀 / 复习优先级）与
**《期末模拟考试》**（选择 / 填空 / 简答 / 综合 + 独立「参考答案与解析」，数学公式使用 KaTeX `$` 语法）。
还可把复习稿进一步构建成可翻页的「动态复习页」，并在页面内针对当前内容向 AI 提问。

当前仓库是**纯 Serverless 形态**：前端静态资源、HTTP API、PostgreSQL 与文件存储全部运行在
**Qoder Sites** 内，不依赖任何自有服务器、Docker、nginx、Pi Builder 或云厂商密钥。

## 架构

```text
Qoder Sites 站点
├── 静态前端        frontend/  → pnpm build → frontend/dist（spa: true）
│   └── API 前缀    /functions/v1/app
├── Edge Function   functions/（唯一函数 app，Deno.serve 单入口，零第三方依赖）
│   ├── router.ts   路径归一化 + 方法分派
│   ├── routes/     auth · workspaces · materials · generation · artifacts · decks · health
│   ├── lib/        db · storage · jwt · auth · parse · section · corpus · planner · llm · page-kit
│   └── migrations/ 0001_tables.sql · 0002_indexes.sql · 0003_deck_build_advance.sql
├── 托管 PostgreSQL 13 张表（应用侧生成 bigint 主键，无外键/事务）
├── 私有 Storage    签名直传/下载 + 生成中间产物、页面 bundle
└── shared/         PageRef 页面运行时与 shell（前端阅读器与 bundle 共用）
```

### 平台边界带来的产品形态

| 项 | 现状 |
| --- | --- |
| 生成流水线 | 无后台 worker：前端循环 `POST /jobs/:id/advance`，`cursor` + 租约持久化，断线可续跑 |
| 资料使用 | **全文分块 map-reduce**，不截断：20,000 字/块（400 字重叠）逐块提炼，每 4 份合并 |
| 复习页构建 | 前端循环 `POST /deck-jobs/:id/advance`，函数内规划 + 逐页生成 + page-kit 校验渲染 |
| 页面渲染 | 纯 TS page-kit 输出 HTML；公式为占位，前端用 KaTeX（MathML）替换 |
| 页面 AI 助手 | 非流式问答：一次 `POST` 调用，持久化 user/assistant 消息 |
| 资料解析 | 仅 `md` / `txt`；单文件 ≤ 8 MiB；登记时同步解析分节 |
| 文件存储 | Qoder Sites Storage 签名直传；下载为 302 跳转签名地址 |
| 鉴权 | 自建 JWT（HS256）+ PBKDF2；密钥来自 Sites Secrets |
| 限流 | 密保校验失败 5 次 / 15 分钟，落 `auth_limiter` 表 |

详细阶段、预算与幂等约定见 [docs/serverless/GENERATION_PIPELINE.md](./docs/serverless/GENERATION_PIPELINE.md)；
平台能力与保守默认值见 [docs/serverless/PLATFORM_LIMITS.md](./docs/serverless/PLATFORM_LIMITS.md)。

## 本地开发

```bash
# 前端
cd frontend
pnpm install
pnpm dev            # http://localhost:5173；默认调用 /functions/v1/app

# 连接已发布站点联调（不使用本地函数）
VITE_API_BASE=https://<site>/functions/v1/app pnpm dev

# 前端测试与构建
pnpm test           # Vitest
pnpm typecheck      # vue-tsc
pnpm build          # → frontend/dist

# 函数类型检查（复用前端 TypeScript）
cd frontend && npx tsc --noEmit -p ../functions/tsconfig.json

# 函数纯函数单测（Node 24 原生 TS）
node --test "functions/tests/*.test.ts"
```

> 本地没有站点时，前端页面能打开但接口会 404；完整联调请指向已发布站点，或在 Qoder Sites 草稿中预览。

## 部署（全部在 Qoder Sites 内完成）

1. `open_design_workbench` 登记站点目录与页面。
2. `prepare_site`：`webDirectory: "frontend/dist"`、`spa: true`，创建草稿并取得 Project/Site ID。
3. `ensure_backend`：`database` + `functions`，`databaseAccessModel: "function_backend"`。
4. 依次应用 `functions/migrations/0001_tables.sql`、`0002_indexes.sql`、`0003_deck_build_advance.sql`。
5. 在 Sites Settings 配置 Secrets（见下表），必须包含 `JWT_SECRET` 与三项 `LLM_*`。
6. 完整 `prepare_site`（`functionDirectory: "functions"`、`databaseAccess: "read_write"`、`schemaRef`）→ `publish_site`。
7. 线上冒烟（注册 → 上传 → 生成 → Deck 构建 → 页面问答 → 重做）：

```bash
SITES_BASE_URL=https://<site> node scripts/smoke-sites.mjs
```

## Secrets / 环境变量

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | **是** | 随机会话密钥；缺失时函数回退开发占位值，生产必须配置 |
| `LLM_API_KEY` | **是** | OpenAI 兼容网关密钥；缺失时生成 / Deck 构建 / 页面问答返回 400 或 503 |
| `LLM_BASE_URL` | 否 | 默认 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | 否 | 默认 `qwen-plus`；建议支持 ≥32k 上下文 |
| `LLM_TIMEOUT_SECONDS` | 否 | 默认 `60`；单次 advance 只做一次主要 LLM 调用 |
| `LLM_MAX_OUTPUT_TOKENS` | 否 | 默认 `4096` |
| `MATERIAL_MAX_BYTES` | 否 | 默认 `8388608`（8 MiB） |

> 所有 Secret 只能填在 Qoder Sites Settings，不得写入仓库或前端。

## 接口

前端统一调用 `/functions/v1/app/...`。函数同时接受平台剥离后的 `/api/...` 与物理名
`/functions/v1/app-d<hex32>/...`，由 `functions/lib/path.ts` 归一化。

- 生成：`POST /workspaces/:id/generate` 创建任务，前端循环 `POST /jobs/:id/advance` 推进。
- 复习页：`POST /decks/:id/build`、`POST /deck-jobs/:id/advance`、`POST /decks/:id/cancel`、
  `POST /decks/:id/pages/:page/rebuild`。
- 页面问答：`GET|POST /decks/:id/pages/:page/messages`（非流式）。
- 错误统一 `{ "detail": "中文文案" }`；字段校验失败为 `422 { "detail": [{ loc, msg, type }] }`。
- 未登录 401；他人资源一律 404；删除 204 无体。
- `GET /api/health` → `{ status: "ok", database: "ok" | "unreachable" }`。

## 测试

```bash
cd frontend && pnpm test && pnpm typecheck && pnpm build
cd frontend && npx tsc --noEmit -p ../functions/tsconfig.json
node --test "functions/tests/*.test.ts"
SITES_BASE_URL=https://<site> node scripts/smoke-sites.mjs
```

冒烟脚本覆盖：注册/登录、签名上传小 md、索引分节、全文分块生成、两篇工件、
Deck 构建到 ready、页面 bundle、页面问答、取消后旧版本仍可读、单页重做版本 +1、权限隔离。
`SMOKE_MAX_ADVANCE`（默认 400）与 `SMOKE_ADVANCE_DELAY_MS`（默认 400）可调节推进节奏。

## 项目文档

- [AGENT.md](./AGENT.md) —— Agent/开发者必读：目录、入口、契约与陷阱
- [RULE.md](./RULE.md) —— 代码规范、接口契约、文档义务与 Git 纪律
- [DESIGN.md](./DESIGN.md) —— 前端设计语言
- [docs/serverless/GENERATION_PIPELINE.md](./docs/serverless/GENERATION_PIPELINE.md) —— 生成与 Deck 构建状态机
- [docs/serverless/PLATFORM_LIMITS.md](./docs/serverless/PLATFORM_LIMITS.md) —— 平台能力与保守常量
- [docs/pageref/](./docs/pageref/) —— PageContent 2.0 契约与历史 Pi 管线报告（构建已改为函数内实现，仅作参考）
- [Plan.md](./Plan.md) —— 历史规划
