# INTERNAL_API.md · PageRef 内部接口契约 v0.1

> 状态：P2 实施基线（2026-11-07）。适用于 FastAPI 主后端、Pi Builder 容器与 Page Validator 容器之间的内部通信。三者均不暴露公网，只通过 compose 内部网络访问。
> 页面产物本身的契约见 [PAGE_CONTRACT.md](./PAGE_CONTRACT.md)；本文件只定义服务之间的 HTTP 接口、鉴权与错误语义。

## 1. 通用约定

| 项目 | 约定 |
| --- | --- |
| 编码 | UTF-8 JSON；请求体上限 6 MiB |
| 鉴权（Builder） | HMAC-SHA256，见第 2 节 |
| 鉴权（Validator） | `Authorization: Bearer <VALIDATOR_TOKEN>` |
| 时间 | ISO 8601 UTC；时间戳头为 Unix 秒 |
| 错误体 | `{"detail": "<中文可读文案>", "code": "<UPPER_SNAKE>"}` |
| 健康检查 | `GET /healthz` → `{"status":"ok","version":"..."}`，无需鉴权 |
| 超时 | 主 API 调 Builder 默认 480s；Builder 调 Validator 默认 120s；均 fail-closed |

- 所有接口只接受 `application/json`，拒绝其他 Content-Type。
- 任何密钥、token、页面完整来源资料不得出现在日志中。
- 服务不可用时返回 503；上游超时返回 504；不要降级为「跳过校验」。

## 2. Builder 鉴权

请求头：

```text
X-MF-Timestamp: 1794030000
X-MF-Signature: <hex(hmac_sha256(token, "{timestamp}.{method}.{path}.{raw_body}"))>
```

其中 `method` 统一大写，`path` 为请求目标且包含查询串（如 `/v1/builds/bld_1/events?after_seq=0`）。

校验规则：

1. `abs(now - timestamp) <= 300` 秒，否则 401 `STALE_TIMESTAMP`。
2. 使用 `BUILDER_TOKEN` 计算 HMAC，常量时间比较；method/path/body 任一不一致 401 `BAD_SIGNATURE`。
3. `build_id` 由主 API 生成并放在 body；重复创建同 `build_id` 返回既有任务（幂等），但 body 指纹不同则 409 `BUILD_ID_CONFLICT`。
4. 签名基于原始请求体字节；Builder 不得在验签前反序列化并重新序列化。
5. 旧版仅覆盖 `{timestamp}.{raw_body}` 的签名不再接受；主 API 与 Builder 必须同版本部署。

## 3. Builder 接口

### 3.1 创建构建

`POST /v1/builds`

```json
{
  "build_id": "bld_01J9Z3K4",
  "page_brief": {
    "page_id": "page_bisect_001",
    "deck_title": "数据结构 · 复习页",
    "role": "mechanism",
    "knowledge_point": { "title": "二分查找", "summary": "…", "objectives": [], "key_points": [], "formulas": [], "misconceptions": [] },
    "merged_knowledge_points": [],
    "teaching_contract": {
      "objectives": ["能说出循环不变量"],
      "prerequisites": ["数组有序"],
      "hook": "10 亿个数要试多久？",
      "check_idea": "为什么 mid 要向下取整？",
      "worked_example_idea": "在 [1,3,5,7] 中查 7",
      "required": ["hook", "chain", "worked_example", "check", "misconception"],
      "density": { "visible_layer_chars": 450, "total_page_chars": 700, "visible_blocks": 6, "total_blocks": 8, "primary_interactions": 1, "checks": 1 }
    },
    "source_excerpts": [
      { "section_id": 102, "heading": "1.1 二分查找", "text": "…" }
    ],
    "style": { "preset": "blueprint", "content": ["concept", "formula"], "custom_prompt": "", "density": "standard" },
    "interaction_idea": "用区间收缩动画演示二分",
    "deck_context": { "previous_learning": "上一页…", "next_hook": "下一页…", "chapter_index": 1, "chapter_total": 4 },
    "constraints": {
      "viewport": ["1280x720", "1440x900", "1920x1080"],
      "no_scroll": true,
      "no_network": true,
      "max_bundle_bytes": 2097152,
      "runtime_version": "1.1.0",
      "schema_version": "1.1",
      "language": "zh-CN"
    },
    "previous_page": null,
    "next_page": null
  },
  "session": {
    "key": "deck_9_lane_0",
    "lane": 0,
    "page_index": 2,
    "page_total": 7,
    "first": false
  },
  "feedback": null
}
```

响应：

```json
{ "build_id": "bld_01J9Z3K4", "status": "queued" }
```

- `feedback` 仅用于单页重做，长度 ≤ 2000 字；不得覆盖 constraints。
- `teaching_contract` 仅在 `DECK_TEACHING_ENABLED=true` 时出现；出现时 Builder 必须要求 `manifest.schema_version="1.1"`、`design_system="1.0"` 与完整 `teaching`。
- `merged_knowledge_points` 是同一页合并展示的其他知识点；Builder 不得只写 primary。
- `deck_context` 提供上一页/下一页承接与章节位置，不包含原始页面代码。
- `session`（P11，可选）仅在 Builder `BUILDER_SESSION_MODE=deck` 时生效：`key` 匹配 `^[A-Za-z0-9_-]{1,120}$`，同 key 的页面串行复用 Pi 会话；`lane` 为 lane 序号，`page_index` / `page_total` 用于轮换与任务卡，需满足 `0 <= page_index < page_total`；`first=true` 首次创建会话并写入 deck context/materials。无 `session` 时保持逐页独立会话。
- 创建成功后 Builder 在后台执行；HTTP 连接断开不影响任务。

### 3.2 查询构建

`GET /v1/builds/{build_id}`

```json
{
  "build_id": "bld_01J9Z3K4",
  "status": "queued|running|validating|succeeded|failed|canceled",
  "stage": "正在规划页面结构",
  "attempts": 1,
  "error": null,
  "events_cursor": 12,
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "cost": 0,
    "duration_ms": 0
  },
  "validation": null
}
```

- `validation` 为最后一次 Validator 报告摘要；`failed` 时必须给出中文 `error`。
- `usage.cost` 按 Builder 的 `PAGE_BUILDER_COST_INPUT/OUTPUT/CACHE_READ/CACHE_WRITE`（每 1M token 单价）估算；未配置单价时为 0，但 token 与 cache 字段仍会记录。主 API 会把每次尝试的 usage 写入 `deck_build_jobs.usage`（按 `build_id` 合并），不向前端展示金额。

### 3.3 增量事件

`GET /v1/builds/{build_id}/events?after_seq=0`

```json
{
  "events": [
    { "seq": 1, "type": "stage", "payload": { "text": "开始构建第 3 页" }, "at": "2026-11-07T05:00:00Z" },
    { "seq": 2, "type": "text", "payload": { "text": "正在搭建区间收缩动画…" }, "at": "2026-11-07T05:00:02Z" }
  ],
  "next_seq": 2,
  "finished": false
}
```

允许的事件类型：`stage`、`text`、`tool`、`check`、`page_done`、`error`、`retry`。
- 单事件文本 ≤ 4 KB；每构建事件总数 ≤ 200，超出折叠为一条 `stage` 摘要。
- 不暴露隐藏推理、原始 bash 输出（无 bash）、prompt、密钥。

### 3.4 获取 bundle

`GET /v1/builds/{build_id}/bundle`

```json
{
  "build_id": "bld_01J9Z3K4",
  "bundle": { "schema_version": "1.0", "runtime_version": "1.0.0", "manifest": {}, "html": "", "css": "", "js": "" },
  "validation": { "status": "passed", "issues": [] }
}
```

- 仅 `succeeded` 可获取；其他状态返回 409 `BUILD_NOT_READY`。
- bundle 必须已通过 Builder 侧最终校验，但主 API 仍须独立调用 Validator 作为最终门禁。

### 3.5 取消

`POST /v1/builds/{build_id}/cancel`

- 幂等；已结束返回当前状态。
- 取消后状态 `canceled`，临时目录清理，已生成的中间文件不交付。

### 3.6 关闭会话（P11）

`DELETE /v1/sessions/{key}`

```json
{ "key": "deck_9_lane_0", "status": "closed" }
```

- 仅 `BUILDER_SESSION_MODE=deck` 时有意义；关闭对应 lane 的 Pi 会话，删除会话目录（保留产物由主 API 已收取的 bundle 决定）。
- 幂等：key 不存在时同样返回 202 + `"status": "not_found"`，用于 Deck 结束/取消后的尽力清理；空闲 TTL 兜底。
- key 不匹配 `^[A-Za-z0-9_-]{1,120}$` → 400 `INVALID_SESSION_KEY`；非 DELETE → 405。

## 4. Validator 接口

### 4.1 校验 bundle

`POST /v1/validate`

```json
{
  "bundle": { "schema_version": "1.0", "runtime_version": "1.0.0", "manifest": {}, "html": "", "css": "", "js": "" },
  "viewports": [
    { "width": 1280, "height": 720 },
    { "width": 1440, "height": 900 },
    { "width": 1920, "height": 1080 }
  ],
  "screenshot": true
}
```

响应：

```json
{
  "status": "passed|warning|failed",
  "issues": [
    { "severity": "error", "code": "ZERO_SCROLL_OVERFLOW", "message": "…", "selector": ".mp-page", "viewport": "1280x720" }
  ],
  "screenshots": [
    { "viewport": "1280x720", "data_uri": "data:image/png;base64,…" }
  ],
  "duration_ms": 12345
}
```

- `status=failed` 当且仅当存在 `severity=error`。
- `screenshots` 在 `screenshot=false` 时为空数组；单张缩略图 ≤ 512 KB，超出则压缩或省略并给出 warning。
- 校验器不持有业务数据，不持久化 bundle 或截图。

### 4.2 错误码（至少覆盖）

| code | 含义 |
| --- | --- |
| `INVALID_BUNDLE` | bundle 结构/schema/大小不合法 |
| `FORBIDDEN_HTML_TAG` | HTML 含禁止标签 |
| `FORBIDDEN_HTML_ATTR` | 含内联事件或禁止属性 |
| `FORBIDDEN_URL` | 外链/相对路径/javascript: |
| `FORBIDDEN_JS_API` | 网络、存储、eval、父窗口等 |
| `FORBIDDEN_CSS` | @import/外部 url/overflow |
| `SHELL_ESCAPE_SEQUENCE` | 含 `</script` / `</style` 等 |
| `PAGE_NOT_READY` | 超时未调用 `MockFinal.ready` |
| `ZERO_SCROLL_OVERFLOW` | 视口出现纵向或横向溢出 |
| `INTERNAL_SCROLL` | 存在可滚动容器 |
| `CONSOLE_ERROR` | 控制台 error 或未捕获异常 |
| `NETWORK_REQUEST` | 出现非 data:/blob: 请求 |
| `SMOKE_FAILED` | 交互冒烟未通过 |
| `A11Y_WARNING` | 可访问性 warning |

## 5. 主 API 调用时序

```text
POST /v1/builds (HMAC)
  → 轮询 GET /v1/builds/{id} + GET /events?after_seq=
  → 成功后 GET /bundle
  → POST /v1/validate（主 API 独立门禁）
  → pass: 落库页面 ready；fail: 页面 failed（不信任 Builder 报告）
```

- 主 API 侧 `build_id` 存入 `deck_pages.builder_build_id`，用于恢复与幂等。
- 客户端断开不取消 Builder 任务；只有显式 cancel 接口或超时才终止。

## 6. 版本

| 服务 | 版本来源 | 兼容策略 |
| --- | --- | --- |
| Builder 内部接口 | `BUILDER_API_VERSION`（本文件 v0.1） | 主 API 与 Builder 同步升级 |
| Validator 内部接口 | `VALIDATOR_API_VERSION`（本文件 v0.1） | 同上 |
| 页面 bundle | `schema_version` / `runtime_version` | 见 PAGE_CONTRACT.md |
