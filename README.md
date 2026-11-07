# MockFinal · 期末复习助手

上传课程资料（PDF / DOCX / PPTX / MD / TXT），AI 代理并行提炼后生成两份 Markdown 成品：
**《期末终极复习》**（考纲概览 / 核心概念 / 重点公式 / 易错点 / 记忆口诀 / 复习优先级）与
**《期末模拟考试》**（选择 / 填空 / 简答 / 综合 + 独立「参考答案与解析」，数学公式使用 KaTeX `$` 语法）。

`feat/pageref` 分支另提供**动态复习页**：按知识点规划并逐页构建全屏可交互页面，通过 Validator 校验后交付；前端包含总览路线图、构建工作台、全屏阅读器与**页面 AI 助手**（选区/段落上下文、SSE 流式回答、来源引用、20 次/分限流与历史）。

支持多工作区（一科一区）、安全问题找回密码、阿里云 OSS 前端直传（STS 临时凭证）；
**未配置任何云密钥时自动降级为本地存储**，注册/登录/上传/下载全链路仍可用。

## 项目文档

- [AGENT.md](./AGENT.md) —— Agent/开发者必读：项目结构、入口、核心流程、API 地图与契约陷阱
- [RULE.md](./RULE.md) —— 代码规范、接口契约、文档义务与 Git 分支/提交纪律
- [DESIGN.md](./DESIGN.md) —— 前端设计语言：单色纸感、设计 token、布局、组件与动效规范
- [Plan.md](./Plan.md) —— PageRef 动态复习页与 Pi 构建流水线（现状、决策与路线图）
- [docs/pageref/](./docs/pageref/) —— 页面契约、内部接口、P2–P7 报告、浏览器验收、发布与回滚手册

## 架构

```
frontend/   Vite + Vue3 + TS + Tailwind（pnpm dev，http://localhost:5173）
backend/    FastAPI + LangChain 1.x（LLM 调用 + 文本分节）+ alibabacloud-oss-v2
builder/    P2 页面构建服务（Node 24 + Pi 1.5.0，内部 HTTP + HMAC，未并入主 api）
validator/  P2 页面校验服务（静态 AST + Playwright，内部 HTTP）
shared/     页面运行时与 shell（前端阅读器与 Validator 共用）
db          PostgreSQL 17（宿主端口 5433，避免与本机原生 PG 5432 冲突）
```

- 后端 `docker compose` 一键起（api + db 两个容器）；前端本地 `pnpm dev`。
- 资料流水线：上传/登记 → 后台任务下载 → 解析（pdfplumber / python-docx / python-pptx）→
  按标题/页/幻灯片分节（1200 字符、100 字符重叠，表 `material_sections`）。不再使用 Embedding 与向量库。
- 生成流水线：按工作区取分节分组 → 每份资料一个摘要子代理（Semaphore(4) 并行）→
  复习代理 + 出卷代理并行产出 → Markdown 写存储、artifacts 落库。
- 统一鉴权：除 `/api/auth/*` 与 `/api/health` 外全部 `Authorization: Bearer <JWT>`；
  所有资源校验归属，他人资源一律 404。

## 快速启动

```powershell
# 1. 准备环境变量
Copy-Item .env.example .env                 # compose 用（POSTGRES_PASSWORD 等）
Copy-Item backend\.env.example backend\.env # 后端用（JWT_SECRET、LLM、OSS…）
#    ⚠️ backend/.env 必须存在（compose 的 env_file 引用它）；至少修改 JWT_SECRET

# 2. 启动数据库 + 后端（首次构建约几分钟）
docker compose up -d --build
# 自检：浏览器打开 http://127.0.0.1:8000/api/health 应返回 {"status":"ok","database":"ok"}
# API 文档：http://127.0.0.1:8000/docs

# 3. 启动前端
cd frontend
pnpm install
pnpm dev   # http://localhost:5173
```

> 数据库对外映射为 `localhost:5433`（容器内仍是 5432）；如需外部工具连接：
> `postgresql://mockfinal:mockfinal@localhost:5433/mockfinal`。

## 环境变量说明（backend/.env）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 否 | `postgresql+psycopg://mockfinal:mockfinal@db:5432/mockfinal` | compose 内保持默认；`db` 为服务名 |
| `JWT_SECRET` | **是** | 占位值 | 随机长字符串，泄露即可伪造登录态 |
| `LLM_BASE_URL` | 否 | 空 | OpenAI 兼容网关，如 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_API_KEY` | 生成/助手必填 | 空 | 缺失时 `/generate` 返回 400、页面助手 POST 返回 503「未配置 LLM 服务」 |
| `LLM_MODEL` | 否 | `qwen-plus` | 任意兼容网关的对话模型名 |
| `PAGE_CHAT_MAX_TOKENS` | 否 | `900` | 页面助手单次回答 token 上限（成本控制） |
| `DECK_MIN_PAGES` / `DECK_MAX_PAGES` | 否 | `6` / `16` | Deck 页面总数上下限（P3 规划） |
| `DECK_MAX_MATERIAL_CHARS` | 否 | `200000` | 大纲规划 prompt 的资料字符预算 |
| `DECK_MAX_BUNDLE_BYTES` | 否 | `2097152` | 单页 bundle 字节上限（P4 保存/交付校验） |
| `PAGE_BUILDER_URL` / `PAGE_BUILDER_TOKEN` | 构建必填 | 空 | P4 新增：Pi Builder 内部地址与 HMAC 共享密钥；缺失时 build/rebuild 返回 503 |
| `PAGE_BUILDER_TIMEOUT_SECONDS` | 否 | `480` | P4 新增：单次 Builder 请求超时（秒） |
| `PAGE_BUILDER_CONCURRENCY` | 否 | `2` | P4 新增：页面并发构建数 |
| `PAGE_VALIDATOR_URL` / `PAGE_VALIDATOR_TOKEN` | 构建必填 | 空 | P4 新增：Page Validator 内部地址与 Bearer token；不可用时 fail-closed |
| `PAGE_VALIDATOR_TIMEOUT_SECONDS` | 否 | `120` | P4 新增：单次最终校验超时（秒） |
| `DECK_PAGE_MAX_ATTEMPTS` | 否 | `2` | P4 新增：单页最多尝试次数（含首次，最终校验失败重试） |
| `DECK_JOB_TIMEOUT_SECONDS` | 否 | `1800` | P4 新增：构建任务总超时（秒），超时取消 Builder |

> P4 新增的 `PAGE_BUILDER_*` / `PAGE_VALIDATOR_*` / `DECK_PAGE_MAX_ATTEMPTS` / `DECK_JOB_TIMEOUT_SECONDS` 用于内部页面构建与校验服务。Builder/Validator 不暴露公网，主 API 通过私有网络 + HMAC/Bearer 调用；未配置或不可用时 Deck 构建返回 503 或页面失败（fail-closed，不会跳过校验）。

| `OSS_REGION` | OSS 必填 | 空 | 不带 `oss-` 前缀，如 `cn-hangzhou`；SDK 自动派生 endpoint |
| `OSS_ENDPOINT` | 否 | 空 | 自定义域名/内网 endpoint 时才填 |
| `OSS_BUCKET` | OSS 必填 | 空 | 私有读写 Bucket 名 |
| `ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET` | OSS 必填 | 空 | RAM 用户长期 AK，仅后端使用，绝不下发前端 |
| `STS_REGION` | 否 | 空 | 留空则复用 `OSS_REGION` |
| `STS_ROLE_ARN` | 直传必填 | 空 | RAM 角色 ARN；缺失时上传凭证降级 `{"mode":"local"}` |
| `STS_DURATION_SECONDS` | 否 | `3600` | 临时凭证有效期（秒） |

根目录 `.env`（compose 用）：`POSTGRES_PASSWORD`（默认 `mockfinal`）、`DATABASE_URL`。

## 阿里云控制台前置配置清单（使用 OSS 直传时）

1. **创建 Bucket**
   - 读写权限：**私有**；建议开启服务端加密；记录 Bucket 名与 Region。
2. **配置 CORS**（Bucket → 数据安全 → 跨域设置，新增规则）
   - 来源 AllowedOrigin：`http://localhost:5173`（生产域名另行追加）
   - 允许 Methods：`GET, PUT, POST, HEAD, DELETE`
   - 允许 Headers：`*`
   - **暴露 Headers：必须包含 `ETag`**（分片上传/校验依赖）
   - 缓存时间 MaxAge：`600`
3. **创建 RAM 用户**（后端持有其长期 AK）
   - 授权系统策略 `AliyunSTSAssumeRoleAccess`（允许调用 STS AssumeRole）；
   - 追加自定义策略，授予该 Bucket `mockfinal/*` 前缀的读写删（后端登记校验 head_object、
     下载与级联删除需要）：
     ```json
     {
       "Version": "1",
       "Statement": [
         {
           "Effect": "Allow",
           "Action": ["oss:GetObject", "oss:PutObject", "oss:DeleteObject", "oss:HeadObject"],
           "Resource": ["acs:oss:*:*:<你的Bucket>/mockfinal/*"]
         }
       ]
     }
     ```
4. **创建 RAM 角色**（供 STS 扮演，前端直传最小权限）
   - 可信实体：当前云账号；
   - 授予上传类 Action（`oss:PutObject`、`oss:AbortMultipartUpload`、`oss:ListParts`，
     Resource 限定 `acs:oss:*:*:<Bucket>/mockfinal/*`）；
   - 记录角色 ARN 填入 `STS_ROLE_ARN`。后端还会在 AssumeRole 时附加会话 Policy，
     进一步把权限收窄到 `mockfinal/{user_id}/{workspace_id}/*`（Version 为 `"1"`，≤2048 字符）。

> **OSS 2025 新政提示**：2024-01-01 之后创建的内地 Bucket，**默认域名禁止用于数据类 API
> 的浏览器访问**，需绑定已备案的自定义域名，或改用海外 Region（如 `ap-southeast-1`），
> 否则前端直传/预览会被拦截。

## 无密钥本地回退说明

- 未配置 OSS（缺 region / bucket / AK 任一项）时，文件保存在 `backend/data/`
  （容器内 `/app/data`，已由 compose 挂载持久化），上传凭证接口返回 `{"mode":"local"}`，
  前端改用 multipart 直传后端；服务日志会打印一次回退警告。
- 资料解析与分节完全在本地完成，不依赖任何外部密钥；未配置 `LLM_API_KEY` 时，
  `POST /api/workspaces/{id}/generate` 返回 400、页面助手 POST 返回 503 中文提示。
- PageRef 安全/迁移/回滚与已知残留风险见 [docs/pageref/P7_RELEASE.md](./docs/pageref/P7_RELEASE.md)。

## 已知限制

- 扫描版 PDF（无文字层）不支持，解析时返回「疑似扫描件，暂不支持」。
- 单文件 ≤ 50MB；扩展名限 `pdf/docx/pptx/md/txt`。
- 旧版本（含向量库时期）上传的资料无需重新上传：首次生成时会自动懒回填分节；
  旧库中的 `material_chunks` 与 vector 扩展保留但不再读写，确认无需回滚后可手动清理。
- 生成/构建任务为进程内 asyncio 任务：api 容器重启会中断进行中的任务；启动自愈会把遗留任务标记 failed（Deck 已有旧 bundle 的页面保持可读），可重新发起。

## 测试

```bash
# 后端（需先安装 backend/requirements-dev.txt）
cd backend && pytest

# 前端
cd frontend && pnpm test && pnpm typecheck

# Validator / Builder / Shell（PageRef）
cd validator && npm test
cd ../builder && npm test
node --test shared/page-shell/shell.test.mjs
```

Deck 隔离库集成测试默认跳过；需要独立测试库（测试会 drop 业务表）与假 Builder/Validator 地址：

```bash
cd backend
P4_INTEGRATION=1 \
DATABASE_URL=postgresql+psycopg://.../mockfinal_p4_test \
PAGE_BUILDER_URL=http://builder.test PAGE_BUILDER_TOKEN=test \
PAGE_VALIDATOR_URL=http://validator.test PAGE_VALIDATOR_TOKEN=test \
pytest tests/test_decks_api.py
```

完整发布门禁（含 Validator/红队/P5/P6 浏览器验收与真实 Pi 门禁）见 [docs/pageref/P7_RELEASE.md](./docs/pageref/P7_RELEASE.md)。
