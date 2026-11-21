# Qoder Sites 平台能力与保守边界

本文件是 Serverless 实现的常量来源与平台约束说明。**代码中的保守默认值以这里记录的结论为准**；
未经线上验证的项明确标注「待实测」，不得当作已确认事实引用。

## 已确认的平台事实

| 能力 | 事实 | 代码中的体现 |
| --- | --- | --- |
| 函数数量 | 每个站点只有一个逻辑函数 `app`，入口 `index.ts` | `functions/index.ts` 单入口，`router.ts` 内部路由 |
| 函数调用路径 | `/functions/v1/app/...`；物理名 `app-d<hex32>` | `lib/path.ts` 同时接受逻辑名与物理名 |
| 后台任务 | 无 cron / queue / worker | 生成与 Deck 构建改为前端驱动 `POST /jobs/:id/advance`、`POST /deck-jobs/:id/advance` |
| 数据库 | 托管 PostgreSQL 子集，经平台注入 SDK 访问；无连接串 | `lib/db.ts` 只依赖 `_qoder/backend.mjs` |
| 事务 | 不支持 | 多表操作顺序执行 + 幂等写；级联删除手工实现 |
| DDL | 仅 `app.*`；新增列可空 / 无默认值；普通索引；无数组、无 CHECK、无 partial/表达式索引、无 serial | `0001`–`0003` 迁移；主键由 `lib/ids.ts` 生成 |
| 存储 | 每站一个私有 bucket；签名上传/下载 TTL 1–7200s；单对象上限 10 MiB | `lib/storage.ts`：上传 900s、下载 300s |
| 保留路径 | `/api`、`/internal`、`/functions`、`/storage`、`/rest/v1` 被平台占用 | 前端 `API_BASE = /functions/v1/app` |

## 本环境已验证（2026-11-08，站点未发布）

| 项 | 观察结果 |
| --- | --- |
| 后端分配 | `database` + `functions` + `storage`，`function_backend` 模式，状态 ready |
| 数据库 | 13 张表与全部查询索引已应用；`get_database_schema` 为 ready，无 stale |
| 存储单对象上限 | `file_size_limit = 10485760`（10 MiB），大于应用 8 MiB 限制 |
| 函数打包 | `artifactReady: true`（含 `_qoder/*` 注入前类型检查通过） |
| 发布依赖 | 缺少 `JWT_SECRET`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 的 Secret 值；`canPublish: false` |

## 线上已验证（2026-11-09，发布后冒烟）

| 项 | 观察结果 |
| --- | --- |
| 站点准入 | 私有站点未登录访问返回 401 `sites_gateway_login_required`；冒烟期间临时切为 public |
| 写请求 Origin | 签名上传 PUT 与函数 POST/PUT 必须带合法 `Origin`，否则被网关拒绝 |
| 网关超时 | 单次函数调用过久（LLM 输出预算 8192 且超时 60s）会返回 504 `upstream request timeout`；前端与冒烟均按可重试处理 |
| LLM 思考预算 | 当前模型为推理模型：未关闭思考时会用尽 `max_tokens`，`finish_reason` 为 `length` 且 `content` 为空；请求固定携带 `enable_thinking=false` 与 `thinking.type=disabled`，并对空正文按长度截断退避 |
| 输出截断 | 长 JSON 偶发未闭合；`lib/json.ts` 采用平衡扫描与保守补全，`chatJson` 在截断时提高预算重试，页面级失败相互隔离 |
| 数据库筛选 | `query_database_rows` 以 bigint 列做等值过滤会失败；运维查询改用 `order: id desc` + `limit` |

## 线上待实测（发布后回填）

| 探测项 | 获取方式 | 影响常量 |
| --- | --- | --- |
| 函数墙钟超时 | 观察单次 advance 内一次 LLM 调用的最坏耗时 | `LLM_TIMEOUT_SECONDS`、阶段粒度 |
| 请求体上限 | 资料登记 JSON 与大页面 JSON 请求 | `config.requestJsonLimit` |
| 响应体上限 | `/artifacts/:id` 回传全文、页面 bundle 回传 | `config.artifactMaxBytes`、bundle 上限 |
| 存储签名 URL 实际 TTL | 上传/下载 302 跳转是否在标称时间内可用 | `maxUploadUrlTtl`、`downloadUrlTtl` |
| JSONB 写入 | 对象直传与字符串序列化 | `lib/db.ts` 序列化 |
| DB 错误形状 | 唯一冲突、非法列、超长 text | `lib/db.ts` 错误映射（409） |
| 路径归一化 | 访问逻辑路径时函数收到的 `pathname` | `lib/path.ts` 正则 |
| 运行身份 | 有/无鉴权头时平台注入的用户上下文 | 保持自建 JWT（`lib/current-user.ts`） |

线上冒烟（`scripts/smoke-sites.mjs`）会实际走通上传、生成、Deck 构建、bundle、问答与重做，
其结果可作为上述多数项的运行证据。

## 保守默认值

| 常量 | 默认 | 说明 |
| --- | --- | --- |
| `MATERIAL_MAX_BYTES` | 8 MiB | md/txt 场景充足；浏览器直传，不经函数体 |
| `requestJsonLimit` | 256 KiB | 仅用于 JSON 登记 / 生成请求 |
| `artifactMaxBytes` | 4 MiB | 生成结果 md 全文回传上限 |
| `LLM_TIMEOUT_SECONDS` | 45 | 单次 advance 只做一次主要 LLM 调用；避开网关 504 |
| `LLM_MAX_OUTPUT_TOKENS` | 4096 | 可用 Secret 覆盖 |
| 生成/Deck 租约 | 120s | `lease_until`；过期后下一次 advance 接管 |
| 上传签名 TTL | 900s | 文档上限 7200s |
| 下载签名 TTL | 300s | `/materials/:id/download` 302 |
| 页面 bundle 上限 | 2 MiB | 渲染后字节校验，超限标失败 |
| 生成分块 | 20,000 字 / 400 字重叠 | `corpus.ts`；全文处理，不截断 |
| reduce 扇入 | 4 | 每 4 份 digest / 索引合并为 1 份 |
| 单页资料预算 | 12,000 字 | 单页展示预算，不是全文截断 |
| 页面 JSON 修复 | 最多 2 次 | 校验失败后带问题摘要重试 |
| 前端 advance 间隔 | 400ms | 429 退避 1.2s、502 退避 3s、通用失败 2s |

## 降级与失败策略

- 函数超时偏紧：把阶段继续拆细（一次 advance 一个 LLM 调用），接口形状不变。
- 请求体上限偏小：资料上传走签名直传，只有登记 JSON 与页面 JSON 走函数。
- 响应体上限偏小：`/artifacts/:id` 改为 302 到存储签名地址；前端改为下载 blob。
- 存储对象上限偏小：下调 `MATERIAL_MAX_BYTES` 与前端 `MAX_FILE_SIZE`，文案同步。
- 无唯一索引冲突错误：注册 / 资料登记改为「先查后写」并在应用层兜底。
- LLM 429 / 502：释放租约并抛给前端退避，不判定任务失败；cursor 保证续跑。
- LLM 输出非法 JSON：宽松提取 + 最多 2 次 repair；仍失败则任务 / 页面标失败并保留中文原因。
