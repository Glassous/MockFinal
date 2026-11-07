# AGENT.md · MockFinal 工作区指南

> 本文件是本仓库所有 Agent 的**必读入口**。开始任何工作前，按顺序阅读：
> 1. `AGENT.md`（本文件）—— 项目是什么、在哪里、怎么跑；
> 2. `RULE.md` —— 代码规范、Git 提交与分支纪律；
> 3. `DESIGN.md` —— 只在前端/视觉相关改动时阅读。
>
> 文档与代码冲突时以代码为准，并顺手修正文档。

## 1. 项目速览

**MockFinal（期末终极复习助手）**：用户按科目建立工作区，上传课程资料（PDF / DOCX / PPTX / MD / TXT），后端解析、分块、Embedding 入 pgvector；调用 LLM 并行提炼摘要后，生成两份 Markdown 成品：

- 《期末终极复习》：考纲概览 / 核心概念 / 重点公式 / 易错点 / 记忆口诀 / 复习优先级；
- 《期末模拟考试》：选择 / 填空 / 简答 / 综合 + 独立的「参考答案与解析」。

数学公式统一使用 KaTeX `$...$` / `$$...$$` 语法。系统支持多工作区、JWT 鉴权、密保问题找回密码、阿里云 OSS 前端直传（STS 临时凭证）；**未配置任何云密钥时自动降级为本地存储**，注册/登录/上传/下载全链路仍可用。

| 维度 | 选型 |
| --- | --- |
| 后端 | Python 3.12 · FastAPI 0.162 · SQLAlchemy 2（async + psycopg3）· Pydantic v2 |
| 数据库 | PostgreSQL 17 + pgvector（宿主端口 **5433**，容器内 5432） |
| AI | LangChain 1.x（`PGEngine` / `PGVectorStore`）· OpenAI 兼容网关（默认 `qwen-plus`） |
| 存储 | 阿里云 OSS V2 SDK + STS；未配置时回退 `backend/data/` |
| 前端 | Vue 3.5 `<script setup>` · TypeScript strict · Vite 8 · Pinia 4 · vue-router 5 |
| 样式 | Tailwind CSS 4（CSS-first，无 `tailwind.config.js`）· lucide 图标 |
| Markdown | markdown-it + KaTeX + highlight.js + DOMPurify |
| 包管理 | 后端 pip（`requirements.txt`）· 前端 pnpm（`pnpm-lock.yaml`） |

## 2. 目录结构

```text
MockFinal/
├── AGENT.md / RULE.md / DESIGN.md   # 本套工作区文档
├── README.md                        # 面向人类的使用与部署说明（环境变量、OSS 配置）
├── .env.example                     # 仅供 docker compose
├── docker-compose.yml               # db（pgvector/pg17）+ api
├── docker-initdb.d/01-init.sql      # 首次初始化 CREATE EXTENSION vector
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example                 # 后端全部环境变量样例
│   └── app/
│       ├── main.py                  # FastAPI 入口、lifespan、CORS、路由注册、/api/health
│       ├── config.py                # pydantic-settings 全局配置（settings 单例）
│       ├── database.py              # AsyncEngine、SessionLocal、get_db
│       ├── models.py                # SQLAlchemy 2.0 ORM：User/Workspace/Material/GenerationJob/Artifact
│       ├── schemas.py               # 请求/响应模型（字段名即前端契约）
│       ├── security.py              # bcrypt、JWT 签发/校验、token_version
│       ├── deps.py                  # Bearer 鉴权 → current_user
│       ├── tasks.py                 # spawn()：后台任务强引用注册表
│       ├── prompts.py               # 全部中文 Prompt + 阶段文案 + 工件标题
│       ├── routers/
│       │   ├── auth.py              # 注册/登录/密保/重置/me
│       │   ├── workspaces.py        # 工作区 CRUD、上传凭证、资料登记（OSS/local 双通道）
│       │   ├── materials.py         # 资料列表/删除/下载
│       │   ├── generation.py        # 触发生成、查询任务
│       │   └── artifacts.py         # 工件列表/详情/删除
│       └── services/
│           ├── parser.py            # PDF/DOCX/PPTX/MD/TXT → LangChain Document
│           ├── indexer.py           # 解析→分块(1000/200)→embedding→pgvector；向量检索/清理
│           ├── generator.py         # 摘要子代理 → 复习/出卷代理 → 落库
│           ├── storage.py           # OSS/本地统一存储接口；OSS key 与防穿越
│           └── sts.py               # AssumeRole + 最小权限会话 Policy
└── frontend/
    ├── index.html                   # 防 FOUC 主题内联脚本
    ├── vite.config.ts               # @ 别名、/api → 127.0.0.1:8000 代理
    ├── package.json / pnpm-lock.yaml
    └── src/
        ├── main.ts                  # createApp、Pinia、router、主题初始化、全局 401
        ├── App.vue                  # RouterView 过渡 + ToastHost
        ├── style.css                # 设计 token、深浅主题、动画、.markdown-body 排版
        ├── router/index.ts          # /login /register /forgot / /workspace/:id + 登录守卫
        ├── layouts/AppLayout.vue    # 侧栏 + 移动端抽屉 + 主区域
        ├── views/                   # Login / Register / ForgotPassword / Home / Workspace / EmptyState
        ├── components/              # AppButton/AppInput/Modal/... 与业务组件
        ├── api/                     # client.ts + 各资源 API 封装
        ├── stores/                  # auth / theme / toast / workspace（Pinia setup store）
        ├── lib/                     # oss 上传、markdown 渲染、highlight 主题、格式化
        └── types/index.ts           # 全局类型，与后端契约逐字对齐
```

## 3. 入口与启动

### 3.1 关键入口

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| 后端应用 | `backend/app/main.py` → `app` | 容器内 `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| 后端配置 | `backend/app/config.py` → `settings` | 读取 `backend/.env`；业务代码不得直接 `os.getenv` |
| 数据库会话 | `backend/app/database.py` | 请求用 `get_db`；**后台任务必须自建 `SessionLocal`** |
| 前端应用 | `frontend/src/main.ts` | 挂载 Pinia、router、主题、401 回调 |
| 前端路由 | `frontend/src/router/index.ts` | 登录守卫、页面标题、访客页重定向 |
| 前端外壳 | `frontend/src/layouts/AppLayout.vue` | 桌面侧栏 / 移动抽屉 |
| 设计系统 | `frontend/src/style.css` | 所有颜色、阴影、圆角、动画的唯一来源 |

### 3.2 启动（推荐方式）

```bash
# 1. 准备环境变量（backend/.env 必须存在，compose 的 env_file 引用它）
cp .env.example .env
cp backend/.env.example backend/.env
#    至少修改 backend/.env 的 JWT_SECRET

# 2. 数据库 + 后端（首次构建约几分钟）
docker compose up -d --build

# 3. 前端
cd frontend
pnpm install
pnpm dev
```

> PowerShell 等价写法见 `README.md`（`Copy-Item`）。

- 前端：<http://localhost:5173>（`/api` 由 Vite 代理到 `127.0.0.1:8000`）
- 健康检查：<http://127.0.0.1:8000/api/health>，期望 `{"status":"ok","database":"ok"}`
- API 文档：<http://127.0.0.1:8000/docs>
- 数据库外部连接：`postgresql://mockfinal:mockfinal@localhost:5433/mockfinal`（仅回环地址）

本地运行后端（不使用 Docker）时需自行安装 `requirements.txt` 依赖，并将 `DATABASE_URL` 指向可用的 PostgreSQL/pgvector，例如 `postgresql+psycopg://mockfinal:mockfinal@localhost:5433/mockfinal`。

### 3.3 验证

```bash
cd frontend
pnpm typecheck   # vue-tsc -b
pnpm build       # typecheck + vite build
```

- 仓库目前**没有自动化测试、lint 配置或 CI**。不要虚构 `pnpm test`、`pytest` 等命令。
- 后端改动的最低验证：`docker compose up -d --build` 后 `/api/health` 正常，并实际走一遍受影响接口（前端或 `/docs`）。
- 前端 UI 改动必须在浏览器中实际点过主路径和边界状态（空态、加载、失败、深色模式、移动端）。

## 4. 数据模型（`backend/app/models.py`）

| 表 | 关键字段 | 关系 / 状态 |
| --- | --- | --- |
| `users` | `username` 唯一、`password_hash`、`security_question`、`security_answer_hash`、`token_version` | 1:N `workspaces`（级联删除） |
| `workspaces` | `user_id`、`name`、`description` | 1:N materials / jobs / artifacts |
| `materials` | `workspace_id`、`filename`、`storage_key`、`size`、`content_type`、`chunk_count` | `uploaded → indexing → indexed / failed` |
| `generation_jobs` | `workspace_id`、`status`、`stage`、`error`、`finished_at` | `pending → running → done / failed`；同一工作区最多一个活跃任务 |
| `artifacts` | `workspace_id`、`job_id`、`kind`（`review` / `exam`）、`title`、`storage_key` | 每次生成各产出一份 |
| `material_chunks` | LangChain 创建（`content`、`langchain_metadata`、向量列等） | metadata：`workspace_id`、`material_id`、`source`、`page` |

- 时间统一使用带时区的 UTC（`utcnow()`）。
- 对象 key 统一形如 `mockfinal/{user_id}/{workspace_id}/{ts}-{filename}`；工件为 `mockfinal/{user_id}/{workspace_id}/artifacts/{job_id}/{review|exam}.md`。
- 工作区删除为应用层级联：先删 DB 行，再 **best-effort** 清向量与存储对象，外部清理失败只记日志、不影响 204。

## 5. 核心流程

### 5.1 认证

```text
注册/登录 → 签发 JWT（sub=user_id, tv=token_version, purpose=access）
请求 → HTTPBearer → decode_token → 校验 purpose 与 token_version → current_user
```

- 除 `/api/auth/*` 与 `/api/health` 外，全部接口要求 `Authorization: Bearer <JWT>`。
- bcrypt 计算一律 `asyncio.to_thread`，不得阻塞事件循环。
- 密保答案先 `strip + lower` 再哈希；`verify-answer` 按 `username + IP` 进程内限流（15 分钟内 5 次失败 → 429），仅单进程有效。
- 重置密码 token 有效期 10 分钟；重置成功后 `token_version += 1`，旧 access token 立即失效。
- **所有资源访问必须校验归属；他人资源统一返回 404，不泄露存在性。**

### 5.2 上传（双通道）

```text
POST /api/workspaces/{id}/upload-credentials
  ├─ STS 配置齐全 → { mode:"oss", 临时三元组, region, bucket, key_prefix }
  └─ 否则          → { mode:"local" }
```

- **OSS 直传**：前端用 ali-oss `multipartUpload` 直传 → 再以 JSON 登记 `{filename, storage_key, size, content_type}`；后端校验 key 前缀、扩展名、大小，并 `head_object` 比对实际大小。
- **local 回退**：`multipart/form-data`，字段名固定 `file`；后端流式写入 `SpooledTemporaryFile`（≤10MB 驻留内存），边读边计数，超过 50MB 立即中断；文件落 `backend/data/`（容器内 `/app/data`）。
- 两种模式登记成功后都会 `spawn(index_material_task(material.id))`。
- 长期 AK 只存在于后端；STS 会话 Policy 将权限收窄到 `mockfinal/{user_id}/{workspace_id}/*`，`Version` 必须为 `"1"` 且 ≤2048 字符。

### 5.3 资料索引

```text
uploaded → indexing → 下载 → 临时文件 → 按扩展名解析 → 分块(1000 / overlap 200)
         → metadata 注入(workspace_id, material_id, source, page)
         → Embedding → PGVectorStore.add → indexed / failed(中文 error)
```

- 解析器：pdfplumber / python-docx / python-pptx / 文本解码（UTF-8 优先，charset-normalizer 兜底）。
- 扫描版 PDF（无文字层）不支持，返回中文可读错误。
- 索引期间不持有 DB session；状态更新走独立短 session。
- 未配置 `EMBED_API_KEY` 时索引落 `failed`，不影响其他功能。

### 5.4 生成

```text
POST /generate
  ├─ 校验：LLM 已配置 / 存在 indexed 资料 / 无活跃任务（应用层 409 + DB 部分唯一索引兜底）
  ├─ 创建 job(pending) → spawn(run_generation_job)
  └─ 后台：
       (1) 从 material_chunks 按 workspace 取块并按资料分组
       (2) 每份资料一个摘要子代理，Semaphore(4) 并行；超 24000 字符走分段 map + reduce
       (3) 以工作区名+描述检索 top-8 片段作为 RAG 补充上下文（失败不阻断）
       (4) 复习代理 + 出卷代理并行 → 两份 Markdown
       (5) 写存储 + artifacts 落库 + job=done
```

- 任一份成品失败 → job=failed；摘要失败率 > 50% → 直接失败，否则 `job.error` 记录「部分资料摘要失败」。
- 后台任务任何异常都不得外溢到事件循环；必须通过 `_finish_failed` 落库。
- 服务重启会将遗留 `pending/running` 任务与 `indexing` 资料置为失败（启动自愈）。

## 6. API 地图（完整契约以 `/docs` 为准）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（无需鉴权） |
| POST | `/api/auth/register` | 注册并返回 token + user |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/security-question?username=` | 获取密保问题 |
| POST | `/api/auth/verify-answer` | 验证密保答案 → reset token |
| POST | `/api/auth/reset-password` | 重置密码（204） |
| GET | `/api/auth/me` | 当前用户 |
| GET / POST | `/api/workspaces` | 工作区列表 / 创建 |
| GET / PATCH / DELETE | `/api/workspaces/{id}` | 工作区详情 / 更新 / 级联删除（204） |
| POST | `/api/workspaces/{id}/upload-credentials` | OSS STS 或 local 上传凭证 |
| POST | `/api/workspaces/{id}/materials` | 资料登记（JSON=OSS）或上传（multipart=local） |
| GET | `/api/workspaces/{id}/materials` | 资料列表 |
| DELETE | `/api/materials/{id}` | 删除资料（204） |
| GET | `/api/materials/{id}/download` | 下载原文件 |
| POST | `/api/workspaces/{id}/generate` | 触发生成 → `{job_id}` |
| GET | `/api/jobs/{id}` | 查询任务状态/stage/error |
| GET | `/api/workspaces/{id}/artifacts` | 工件列表（按创建时间倒序） |
| GET | `/api/artifacts/{id}` | 工件详情（含 Markdown 全文） |
| DELETE | `/api/artifacts/{id}` | 删除工件（204） |

约定：创建类接口返回 **200**（不是 201）；删除返回 **204**；未认证 401；资源不存在或无权访问 404；冲突 409；参数错误 400（自定义校验）或 FastAPI 422。业务错误体统一为 `{"detail": "<中文文案>"}`，前端直接展示 `detail`；FastAPI 自动校验错误 422 的 `detail` 为数组，前端已提取首条 `msg`。

## 7. 前端结构约定

- **路由**：`/login`、`/register`、`/forgot` 为访客页（已登录会被重定向首页）；`/` 首页、`/workspace/:id` 位于 `AppLayout`；未登录访问受保护页会带 `redirect` 跳登录。守卫使用 vue-router 5 的返回值写法，**不要 `next()`**。
- **API 层**：所有 HTTP 请求集中在 `src/api/`；`client.ts` 统一注入 Bearer token、解析 `detail`、处理 401（清 token + 跳登录）。组件内不要直接 `fetch`。
- **状态**：Pinia setup store。跨页面共享（auth / theme / toast / workspace 列表）才放 store，页面局部状态用 `ref`。登录/登出必须清空 workspace 缓存，避免跨账号泄露。
- **轮询**：资料索引与生成任务均为 2s 轮询，组件卸载时必须清理定时器；上传组件卸载时 AbortController 中止 XHR。
- **上传**：`src/lib/oss.ts` 按工作区缓存 STS 客户端，过期前 5 分钟刷新；`ali-oss` 动态 import，避免进入首屏 chunk。
- **Markdown**：`markdown-it html:false` + KaTeX（dollars）+ DOMPurify 清洗后才允许 `v-html`；代码高亮只有 GitHub light/dark 两套主题，动态挂 `<link>`。
- **主题**：`index.html` 内联脚本负责防 FOUC，`stores/theme.ts` 负责运行时切换；两处逻辑必须保持一致。深浅色全部由 `style.css` 的语义变量驱动。
- **视觉**：任何新 UI 必须先读 `DESIGN.md`，只使用语义 token（`bg-panel`、`text-ink`、`border-border` 等），不要在组件里写裸色值。

## 8. 不可破坏的契约与常见陷阱

1. **契约字段名逐字对齐**：`schemas.py` ↔ `src/types/index.ts` ↔ `src/api/*.ts`。不要为了「风格统一」把 `storage_key`、`reset_token`、`job_id` 等改成驼峰；上传凭证例外（`accessKeyId` 等按现有契约）。
2. **后台任务不得复用请求 session**：必须 `async with SessionLocal() as db`，且长时间 IO（下载/解析/LLM）期间不持有 session。
3. **fire-and-forget 必须用 `tasks.spawn()`**：直接用 `asyncio.create_task` 会被 GC 提前回收，且未捕获异常会静默丢失。
4. **同步 SDK / 文件 IO 必须 `asyncio.to_thread`**：bcrypt、pdfplumber、OSS SDK、本地文件读写均属此类。
5. **新增数据库列不会自动生效**：没有 Alembic；`create_all` 不会给已存在表加列。新增列需在 `main.py` lifespan 中用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 幂等补齐，并同步模型。
6. **同一工作区只能有一个活跃生成任务**：应用层检查 + 部分唯一索引 `uq_job_active` 双保险；该索引必须在启动自愈之后创建。
7. **`EMBED_DIM` 必须与模型实际输出维度一致**：变更需删除 `material_chunks`（或重建卷）并重新索引。
8. **LangChain 版本约束**：使用 `PGEngine` + `PGVectorStore` 新 API；`langchain-postgres==0.0.19` 要求 `pgvector<0.4`，不要升级到 0.5+；`fastapi==0.162.0` 的 `UploadFile` 继承关系特殊，`request.form()` 的 isinstance 要比较 starlette 父类。
9. **OSS 密钥安全**：长期 AK 绝不下发前端、绝不写日志；STS 失败自动降级 local，不阻断上传；本地存储路径必须做目录穿越校验。
10. **OSS 2025 新政**：2024-01-01 后创建的内地 Bucket，默认域名禁止浏览器数据类 API，直传/预览需自定义域名或海外 Region。
11. **生成内容的 XSS 边界**：LLM 输出一律视为不可信；前端 Markdown 渲染保持 `html:false` + DOMPurify，不要放宽。
12. **AGENT 的 Git 操作边界**：不擅自 commit / push / merge；提交与合并规则见 `RULE.md`，合并 main 必须由人工敲定。
13. **不要引入大型依赖或改架构而不说明**：当前无测试框架、无 lint、无迁移工具、无消息队列；新增基础设施需先与人类维护者确认。

## 9. 常见任务导航

| 任务 | 应该改哪里 |
| --- | --- |
| 新增/修改接口 | `backend/app/schemas.py` → 对应 `routers/*.py` → 新路由在 `main.py` include → `frontend/src/types/index.ts` → `frontend/src/api/*.ts` |
| 修改数据表 | `models.py` + lifespan 幂等 DDL + `schemas.py` + 前端类型；必要时更新 README |
| 调整解析/分块 | `services/parser.py`、`services/indexer.py`（注意已索引资料需重新上传） |
| 调整生成策略/Prompt | `prompts.py` 与 `services/generator.py`；保持阶段文案与 `job.stage` 一致 |
| 调整上传链路 | `routers/workspaces.py`、`services/storage.py`、`services/sts.py`、`frontend/src/lib/oss.ts` |
| 鉴权/密码逻辑 | `security.py`、`deps.py`、`routers/auth.py`、`stores/auth.ts` |
| 新增环境变量 | `config.py` → `backend/.env.example` → README 环境变量表 →（compose 需要时）根 `.env.example` / `docker-compose.yml` |
| 前端新页面 | `router/index.ts` + `views/*View.vue` +（登录后页面）`layouts/AppLayout.vue`；先读 `DESIGN.md` |
| 前端视觉调整 | `style.css` token + 组件；同步 `DESIGN.md`；大改走独立分支 |
| 依赖升级 | `requirements.txt` / `package.json` + `pnpm-lock.yaml`；先确认第 8 节版本约束 |

## 10. 完成定义（DoD）

- [ ] 只改必要文件，没有顺手重构、调试日志、注释掉的代码或临时文件；
- [ ] 后端能构建启动，`/api/health` 正常，受影响的接口已实际调用验证；
- [ ] 前端 `pnpm typecheck` 通过，UI 改动已在浏览器验证深浅色、空态、加载、错误与移动端；
- [ ] 契约、环境变量、README / AGENT / RULE / DESIGN 中受影响的部分已同步；
- [ ] 没有提交 `.env`、密钥、`backend/data/`、构建产物；
- [ ] 改动可按 `RULE.md` 拆成一个原子 commit；未获人类明确指示不推送、不合并。
