# MockFinal · 期末复习助手（Serverless / Qoder Sites）

上传课程资料（**仅 md / txt**），AI 提炼后生成两份 Markdown 成品：
**《期末终极复习》**（考纲概览 / 核心概念 / 重点公式 / 易错点 / 记忆口诀 / 复习优先级）与
**《期末模拟考试》**（选择 / 填空 / 简答 / 综合 + 独立「参考答案与解析」，数学公式使用 KaTeX `$` 语法）。

当前仓库是**纯 Serverless 形态**：前端静态资源、HTTP API、PostgreSQL 与文件存储全部运行在
**Qoder Sites** 内，不依赖任何自有服务器、Docker、nginx 或云厂商密钥。

## 架构

```text
Qoder Sites 站点
├── 静态前端        frontend/  → pnpm build → frontend/dist（spa: true）
│   └── API 前缀    /functions/v1/app/api
├── Edge Function   functions/（唯一函数 app，Deno.serve 单入口）
│   ├── router.ts   路径归一化 + 方法分派
│   ├── routes/     auth · workspaces · materials · generation · artifacts · decks · health
│   ├── lib/        db · storage · jwt · auth · parse · section · llm · jobs · …
│   └── migrations/ 0000_probe.sql（临时）· 0001_tables.sql · 0002_indexes.sql
├── 托管 PostgreSQL 13 张表（应用侧生成 bigint 主键，无外键/事务）
└── 私有 Storage    签名直传/下载，替代阿里云 OSS + STS

backend/   旧 FastAPI 实现，仅作回滚与行为参考，已标记 deprecated
builder/   旧 Pi Builder（页面构建下线，不再部署）
validator/ 旧 Page Validator（页面构建下线，不再部署）
shared/    PageRef 页面运行时与 shell（保留）
```

### 平台边界带来的产品变化

| 项 | 现状 |
| --- | --- |
| 生成流水线 | 无后台 worker：`POST /jobs/:id/advance` 由前端逐步推进，`cursor` 持久化，可断线续跑 |
| 资料解析 | 仅 `md` / `txt`；单文件 ≤ 8 MiB；登记时同步解析分节 |
| 文件存储 | Qoder Sites Storage 签名直传；下载为 302 跳转签名地址 |
| 复习页构建 | 暂时下线：`build` / `rebuild` / `cancel` 返回 503，页面 AI 助手返回 501 |
| 鉴权 | 自建 JWT（HS256）+ PBKDF2；密钥来自 Sites Secrets |
| 限流 | 密保校验失败 5 次 / 15 分钟，落 `auth_limiter` 表 |

详细平台探测结论与常量来源见 [docs/serverless/PLATFORM_LIMITS.md](./docs/serverless/PLATFORM_LIMITS.md)。

## 本地开发

```bash
# 前端（API 默认代理到本地旧后端 http://127.0.0.1:8000）
cd frontend
pnpm install
pnpm dev            # http://localhost:5173

# 前端构建
pnpm typecheck      # vue-tsc
pnpm build          # → frontend/dist

# 函数类型检查（复用前端 TypeScript）
cd frontend && npx tsc --noEmit -p ../functions/tsconfig.json

# 函数纯函数单测（Node 24 原生 TS）
node --test "functions/tests/*.test.ts"
```

连接已发布站点联调：

```bash
VITE_API_BASE=https://<site>/functions/v1/app/api pnpm dev
```

## 部署（全部在 Qoder Sites 内完成）

1. `open_design_workbench` 登记站点目录与页面。
2. `prepare_site`：`webDirectory: "frontend/dist"`、`spa: true`，创建草稿并取得 Project/Site ID。
3. `ensure_backend`：`database` + `functions`，`databaseAccessModel: "function_backend"`。
4. 应用 `functions/migrations/0001_tables.sql`、`0002_indexes.sql`。
5. 在 Sites Settings 配置 Secrets：`JWT_SECRET`（必填）、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。
6. 完整 `prepare_site`（`functionDirectory: "functions"`、`databaseAccess: "read_write"`、`schemaRef`）→ `publish_site`。
7. 冒烟：

```bash
SITES_BASE_URL=https://<site> node scripts/smoke-sites.mjs
```

平台能力探测（Phase 0，仅临时使用）：

```bash
# 需在 Secrets 配置 PROBE_TOKEN，且已发布含 functions/routes/probe.ts 的版本
SITES_BASE_URL=https://<site> PROBE_TOKEN=<secret> node scripts/probe-sites.mjs
```

> 探测结束后删除 `probe.ts` 的注册与 `PROBE_TOKEN`，再发布最终版本。

## Secrets / 环境变量

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | **是** | 随机会话密钥；缺失时函数回退开发占位值，生产必须配置 |
| `LLM_BASE_URL` | 否 | OpenAI 兼容网关，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_API_KEY` | 生成必填 | 缺失时 `POST /workspaces/:id/generate` 返回 400 |
| `LLM_MODEL` | 否 | 默认 `qwen-plus` |
| `LLM_TIMEOUT_SECONDS` | 否 | 默认 `90` |
| `LLM_MAX_OUTPUT_TOKENS` | 否 | 默认 `4096` |
| `MATERIAL_MAX_BYTES` | 否 | 默认 `8388608`（8 MiB） |
| `PROBE_TOKEN` | 探测期 | Phase 0 探测开关；最终版本移除 |

## 接口

前端统一调用 `/functions/v1/app/api/...`。函数同时接受平台剥离后的 `/api/...` 与物理名
`/functions/v1/app-d<hex32>/...`，由 `functions/lib/path.ts` 归一化。

- 错误统一 `{ "detail": "中文文案" }`；字段校验失败为 `422 { "detail": [{ loc, msg, type }] }`。
- 未登录 401；他人资源一律 404；删除 204 无体。
- `GET /api/health` → `{ status: "ok", database: "ok" | "unreachable" }`。

## 测试

按约定只保留**构建测试**与**接口健康测试**：

```bash
cd frontend && pnpm typecheck && pnpm build
cd frontend && npx tsc --noEmit -p ../functions/tsconfig.json
node --test "functions/tests/*.test.ts"          # 30 项纯函数单测
SITES_BASE_URL=https://<site> node scripts/smoke-sites.mjs   # 注册→上传→生成→下载→权限隔离
```

## 项目文档

- [AGENT.md](./AGENT.md) —— Agent/开发者必读：目录、入口、契约与陷阱
- [RULE.md](./RULE.md) —— 代码规范、接口契约、文档义务与 Git 纪律
- [DESIGN.md](./DESIGN.md) —— 前端设计语言
- [Plan.md](./Plan.md) —— PageRef 与 Pi 构建流水线的历史规划
- [docs/serverless/PLATFORM_LIMITS.md](./docs/serverless/PLATFORM_LIMITS.md) —— 平台能力、实测边界与保守常量
- [docs/pageref/](./docs/pageref/) —— 页面契约、教学页规范、发布与回滚手册（构建已下线，保留作参考）
