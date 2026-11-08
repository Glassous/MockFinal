# Qoder Sites 平台能力与实测边界

本文件是 Serverless 迁移的常量来源。**任何写入代码的保守默认值，都以这里记录的探测结论为准**；
未探测项保持在「待实测」，代码使用保守默认值。

探测方式见 `scripts/probe-sites.mjs` 与临时路由 `GET /api/health/probe`（仅当配置
`PROBE_TOKEN` Secret 时可用，探测结束后删除路由与 `0000_probe.sql` 建的表）。

## 已由官方文档确认（非推测）

| 能力 | 事实 | 代码中的体现 |
| --- | --- | --- |
| 函数数量 | 每个站点只有一个逻辑函数 `app`，入口 `index.ts` | `functions/index.ts` 单入口，`router.ts` 内部路由 |
| 函数调用路径 | `/functions/v1/app/...`；物理名 `app-d<hex32>` | `lib/path.ts` 同时接受逻辑名与物理名 |
| 数据库 | 托管 PostgreSQL 子集，经平台注入 SDK 访问；无连接串 | `lib/db.ts` 只依赖 `_qoder/backend.mjs` |
| 事务 | 不支持 | 所有多表操作顺序执行 + 幂等；级联删除手工实现 |
| DDL | 仅 `app.*`；可空列 / 无默认值 / 普通索引；无数组、无 CHECK、无 partial/表达式索引、无 serial | `0001_tables.sql`、`0002_indexes.sql` |
| 存储 | 每站一个私有 bucket，签名上传/下载 TTL 1–7200s | `lib/storage.ts`：上传 900s、下载 300s |

## 本环境已验证（2026-11-08，未发布）

站点已创建并完成以下步骤，发布因缺少 Secrets 被用户暂缓：

| 项 | 观察结果 |
| --- | --- |
| 后端分配 | `database` + `functions` + `storage`，`function_backend` 模式，状态 ready |
| 数据库 | 13 张表与全部查询索引已应用；`get_database_schema` 为 ready，无 stale |
| 存储单对象上限 | `file_size_limit = 10485760`（10 MiB），大于应用 8 MiB 限制 |
| 函数打包 | `artifactReady: true`（含 `_qoder/*` 注入前类型检查通过） |
| 发布依赖 | 缺少 `JWT_SECRET`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`PROBE_TOKEN` 的 Secret 值；`canPublish: false` |
| Phase 0 探测 | **未执行**（需先发布含 probe 路由的版本）；代码使用保守默认值 |

恢复发布：在站点 Settings 的 Secret 编辑器中填写上述 5 个名称的值（`JWT_SECRET` 用随机长串；
LLM 三项可复用根目录 `.env`；`PROBE_TOKEN` 任意随机串），等待同步后对原草稿执行
`get_publish_status` → `publish_site`，再运行 `scripts/probe-sites.mjs` 与 `scripts/smoke-sites.mjs`。
| 后台任务 | 无 cron / queue / worker | 生成流水线改为前端驱动 `POST /jobs/:id/advance` |
| 保留路径 | `/api`、`/internal`、`/functions`、`/storage`、`/rest/v1` 被平台占用 | 前端 `API_BASE = /functions/v1/app/api` |

## Phase 0 实测结果

> 站点：_待填写（首次发布后回填）_
> 函数构建：_待填写_ ｜ 数据库：_待填写_ ｜ 探测日期：_待填写_

| 探测项 | 方法 | 结论 | 回填位置 |
| --- | --- | --- | --- |
| 函数墙钟超时 | `GET /api/health/probe?ms=5000/15000/30000/60000/90000` | 待实测 | `config.llmTimeoutMs`、生成阶段粒度 |
| 请求体上限 | `POST /api/health/probe/echo` 逐级 100KB→20MB | 待实测 | `config.requestJsonLimit` |
| 响应体上限 | `GET /api/health/probe/bytes?n=...` 1MB/5MB | 待实测 | `config.artifactMaxBytes`、`/artifacts/:id` 回传方式 |
| 存储签名 URL | 上传/下载 URL 的实际可用 TTL | 待实测（文档上限 7200s） | `config.maxUploadUrlTtl`、`downloadUrlTtl` |
| 存储单对象上限 | 上传 1MB / 8MB / 20MB 文本 | 待实测 | `config.materialMaxBytes` |
| 存储 SDK 形状 | 打印 `createStorageClient()` 导出键名 | 待实测 | `lib/storage.ts` |
| DB 错误形状 | 唯一冲突 / 非法列 / 超长 text | 待实测 | `lib/db.ts` 错误映射（409） |
| FK 行为 | `REFERENCES app.x(id)` 是否支持 | 默认按不支持实现 | 手工级联 |
| JSONB 写入 | 传对象 vs 字符串 | 待实测 | `lib/db.ts` 序列化 |
| 路径归一化 | 访问逻辑路径时函数收到的 `pathname` | 待实测 | `lib/path.ts` 正则 |
| 运行身份 | 无/有鉴权头时平台注入的用户上下文 | 待实测 | 保持自建 JWT（`lib/current-user.ts`） |

## 保守默认值（探测失败时使用）

| 常量 | 默认 | 说明 |
| --- | --- | --- |
| `MATERIAL_MAX_BYTES` | 8 MiB | md/txt 场景充足；浏览器直传，不经函数体 |
| `requestJsonLimit` | 256 KiB | 仅用于 JSON 登记/生成请求 |
| `artifactMaxBytes` | 4 MiB | 生成结果 md 全文回传上限 |
| `LLM_TIMEOUT_SECONDS` | 90 | 单次 advance 只做一次 LLM 调用 |
| `LLM_MAX_OUTPUT_TOKENS` | 4096 | 可用 Secret 覆盖 |
| 上传签名 TTL | 900s | 文档上限 7200s |
| 下载签名 TTL | 300s | `/materials/:id/download` 302 |
| 生成租约 | 90s | `lease_until`，过期后下一次 advance 接管 |
| 前端 advance 间隔 | 400ms | 失败退避 1.2s / 1.2s / 3s |

## 探测失败后的降级策略

- 函数超时 < 60s：把 `review` / `exam` 阶段拆成「大纲 → 逐章正文」多个 advance 单元，接口形状不变。
- 请求体上限 < 1MB：资料上传本来就走签名直传，只有登记 JSON 走函数，不受影响。
- 响应体上限 < 4MB：`GET /artifacts/:id` 改为 302 到存储签名地址；前端改为下载 blob。
- 存储对象上限 < 8MB：下调 `MATERIAL_MAX_BYTES` 与前端 `MAX_FILE_SIZE`，文案同步。
- 数据库无唯一索引冲突错误：注册/资料登记改为「先查后写」并在应用层兜底。
