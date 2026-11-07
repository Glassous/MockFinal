# Builder · PageRef 页面构建服务

> 状态：**P2 已实现**。Node 24 + TypeScript ESM；内部 HTTP（HMAC）+ 任务队列 + Pi SDK 会话 + Guard 扩展 + bundle 打包 + Validator 自检；`PAGE_BUILDER_MOCK=1` 为离线联调模式。
> 方案来源：`../Plan.md` §6、§7、§11.2；契约见 `../docs/pageref/PAGE_CONTRACT.md` 与 `../docs/pageref/INTERNAL_API.md`。

## 1. 职责

- 接收主 API 的构建请求，为**单个页面**启动一个 Pi SDK Session（`cwd = {tmpdir}/mockfinal-builds/{build_id}`，`SessionManager.inMemory()`）。
- 只加载只读 Harness（`pi-harness/`）：Skill、Prompt Template、Extension、页面模板；不读取宿主 `~/.pi/agent` 个人配置。
- 工具白名单：`read` / `write` / `edit` / `check_page` / `report_progress`；**没有 bash**（allowlist + `excludeTools` + Guard 扩展 `tool_call` 三层拦截）。
- 通过 `check_page` 调用 Validator 做静态与浏览器自检；Builder 侧再做最终校验与最多 2 轮修复。
- 将 Pi 事件映射为构建事件（`stage`/`text`/`tool`/`check`/`page_done`/`error`/`retry`），seq 递增、单条 ≤4 KB、总量 ≤200 条后折叠。
- 只写文件、收集 bundle（manifest/html/css/js）并做路径/大小/扩展名/禁止序列检查；**不执行页面代码**。

```text
builder/
├── src/
│  ├── server.ts            # 内部 HTTP 9100、HMAC、队列（并发 2）、幂等、取消
│  ├── session.ts           # Pi SDK 会话、资源加载、事件映射、修复闭环、MOCK 模式
│  ├── task-store.ts        # 进程内任务表（接口可换持久化）
│  ├── validator-client.ts  # POST /v1/validate（Bearer，fail-closed）
│  ├── bundle.ts            # 4 文件收集、路径/大小/序列/Manifest 检查、打包
│  ├── events.ts            # 事件 seq、4KB 截断、200 条折叠
│  ├── paths.ts             # 路径守卫（越界/符号链接/扩展名/大小）
│  ├── hmac.ts              # HMAC-SHA256 + ±300s 时间戳 + body 指纹
│  ├── config.ts            # 环境变量与默认值
│  └── types.ts             # 共享类型与 Guard 进程内契约
├── pi-harness/
│  ├── agent/settings.json  # Harness 资源清单（Builder 以内存 Settings 显式加载，不依赖该文件）
│  ├── prompts/build-page.md
│  ├── skills/mockfinal-page-builder/
│  ├── templates/page-base/
│  └── extensions/mockfinal-guard/   # 工具白名单、路径守卫、check_page、report_progress
├── tests/                  # node:test（HMAC / 路径守卫 / bundle / 事件 / HTTP 全链路）
└── fixtures/golden/        # 黄金用例 brief、资料与预置 bundle（MOCK 模式默认来源）
```

## 2. 内部 HTTP 接口（INTERNAL_API 第 3 节）

- 监听 `0.0.0.0:9100`（`PORT` 可覆盖）；compose 不映射宿主端口；`GET /healthz` 无需鉴权。
- 所有 `/v1/*` 请求校验 `X-MF-Timestamp`（±300s）与 `X-MF-Signature = hex(HMAC-SHA256(BUILDER_TOKEN, "{timestamp}.{method}.{path}.{raw_body}"))`；method 大写、path 含查询串、基于原始请求体字节、常量时间比较。
- 错误体统一 `{"detail": "<中文>", "code": "<UPPER_SNAKE>"}`；不返回堆栈、prompt 或密钥。

| 方法 | 路径 | 成功 | 说明 |
| --- | --- | --- | --- |
| GET | `/healthz` | 200 | `{status, version, mode, pi_version, harness_version, model_configured, validator_configured, queue}` |
| POST | `/v1/builds` | 202 新建 / 200 幂等 | `{build_id, status}`；body 指纹冲突 409 `BUILD_ID_CONFLICT`；未配置模型/校验器 503 |
| GET | `/v1/builds/{id}` | 200 | 状态、stage、attempts、error、events_cursor、usage、validation |
| GET | `/v1/builds/{id}/events?after_seq=` | 200 | `{events, next_seq, finished}` |
| GET | `/v1/builds/{id}/bundle` | 200 | 仅 `succeeded`；其他状态 409 `BUILD_NOT_READY` |
| POST | `/v1/builds/{id}/cancel` | 202 | 幂等；取消后清理临时目录 |

状态：`queued → running → validating → succeeded|failed|canceled`；并发上限 `PAGE_BUILDER_CONCURRENCY`（默认 2），单页超时取 `deadline_seconds`（默认 480s，上限 900s）。

## 3. 安全边界

- **无 bash**：会话 allowlist 与 `excludeTools` 双保险；Guard 扩展在 `tool_call` 拦截任何非白名单工具。
- **路径守卫**：`write`/`edit` 只允许 build cwd 根下 4 个产物文件；`read` 只允许 build cwd 与只读 Harness；拒绝越界、符号链接、超大文件与非允许扩展名。
- **无业务密钥**：不持 DB/OSS/JWT；只有 LLM key 与 Validator token，全部来自环境变量，不写日志。
- **不执行页面代码**：页面代码只交给 Validator 的 Chromium；Builder 只做静态检查。
- **fail-closed**：Validator 不可用/超时 → 构建失败（中文原因），不降级为跳过校验。
- **资源限制**：单文件与 bundle ≤2 MiB；每页自检最多 3 次；修复最多 2 轮。

## 4. 环境变量

| 变量 | 用途 |
| --- | --- |
| `BUILDER_TOKEN` | 主 API 调用 Builder 的共享密钥；缺失时拒绝启动 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `PAGE_BUILDER_MODEL` | OpenAI 兼容网关与模型；缺失时服务仍启动，构建请求返回 503 |
| `PAGE_VALIDATOR_URL` / `PAGE_VALIDATOR_TOKEN` | Validator 地址与 token；缺失时构建 503（fail-closed） |
| `PI_CODING_AGENT_DIR` | 只读 Harness agent 目录，默认 `./pi-harness/agent` |
| `PI_HARNESS_DIR` | Harness 根目录，默认 agent 目录的上级 |
| `PAGE_BUILDER_TIMEOUT_SECONDS` / `BUILDER_MAX_DEADLINE_SECONDS` | 默认 / 最大单页超时 |
| `PAGE_BUILDER_CONCURRENCY` | 并发上限，默认 2 |
| `BUILDER_BUILD_ROOT` | 构建工作目录根，默认 `{os.tmpdir()}/mockfinal-builds` |
| `DECK_MAX_BUNDLE_BYTES` | bundle 上限，默认 2097152 |
| `PAGE_BUILDER_MOCK` / `PAGE_BUILDER_MOCK_BUNDLE` | MOCK 模式开关与 bundle 绝对路径 |
| `BUILDER_TASK_TTL_SECONDS` | 已完成任务保留时间，默认 3600 |

## 5. 启动与验证

```bash
cd builder
npm install            # 或 npm ci（package-lock.json 已提交）
npm run build          # tsc → dist/
npm test               # node:test：HMAC / 路径守卫 / bundle / 事件 / HTTP 全链路
node dist/server.js    # 需要 BUILDER_TOKEN
```

容器：

```bash
docker compose -f docker-compose.yml -f docker-compose.pageref.yml up -d
```

镜像为 `node:24-slim` 多阶段、非 root、`npm ci` 构建，`EXPOSE 9100`，`CMD node dist/server.js`；只读根、tmpfs、cap drop 由 compose overlay 提供，不在镜像内写密钥。

### 5.1 MOCK 模式（仅开发联调）

```bash
PAGE_BUILDER_MOCK=1 \
PAGE_BUILDER_MOCK_BUNDLE="$PWD/fixtures/golden/bisect/bundle.json" \
BUILDER_TOKEN=dev-token PAGE_VALIDATOR_URL=http://127.0.0.1:9200 PAGE_VALIDATOR_TOKEN=dev-validator \
node dist/server.js
```

- 跳过 Pi，直接读取预置 bundle，走同样的事件 / Validator / 交付流程；启动日志明确输出「MOCK 模式，非真实 Pi 构建」。
- 默认从 `fixtures/golden/{page_id}/bundle.json` 读取。
- **MOCK 通过不等于真实 Pi 构建通过**，不能作为 P2 门禁证据。

## 6. 与主代理的边界

- 本目录不修改 `backend/`、`frontend/`、根 `docker-compose.yml`。
- 页面契约变更必须走 `../docs/pageref/PAGE_CONTRACT.md` 的版本流程。
- 已知 SDK 差异与适配见 `src/README.md`。
