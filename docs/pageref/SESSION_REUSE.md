# Builder 会话复用规范（P11）

> 目标：同一 Deck 的连续页面复用 Pi 会话，利用稳定前缀与上下文缓存降低输入 token；页级任务、事件、校验、失败隔离与主 API 状态机保持不变。
> 设计依据：`../../Plan.md` §4.5、§4.6；契约字段以 `PAGE_CONTRACT.md` 与 `INTERNAL_API.md` 为准。

## 1. 模式与开关

| 配置 | 默认 | 作用 |
| --- | --- | --- |
| `BUILDER_SESSION_MODE` | `page` | `page`：每页独立会话（回退模式）；`deck`：Deck lane 会话 |
| `BUILDER_SESSION_PAGES_PER_LANE` | `3` | 单会话最多构建页数，达到后轮换 |
| `BUILDER_SESSION_CONTEXT_RATIO` | `0.6` | 上下文使用率超过窗口比例时轮换 |
| `BUILDER_SESSION_TTL_SECONDS` | `1800` | 空闲会话清理时间 |
| `PAGE_BUILDER_THINKING` | `medium` | 思考档位；非法值回退 `medium` |
| `DECK_SESSION_REUSE_ENABLED` | `false` | 主 API 开关：为 Deck 页面携带 `session` 元数据（需与 Builder 同开） |
| `DECK_LANE_COUNT` | `2` | 主 API lane 数上限；实际受 `PAGE_BUILDER_CONCURRENCY` 约束 |

- 无 `session` 字段的请求始终走逐页模式；开关回退不改变现有 API。
- 一个会话只属于一个 Deck、一个 lane；禁止跨 Deck 复用。

## 2. 请求协议

`POST /v1/builds` 增加可选字段：

```json
{
  "build_id": "bld_page_12_v1_xxx",
  "page_brief": { "page_id": "page_12", "deck_context": { "chapter_index": 2 } },
  "session": {
    "key": "deck_9_lane_0",
    "lane": 0,
    "page_index": 2,
    "page_total": 7,
    "first": false
  },
  "feedback": null,
  "deadline_seconds": 480
}
```

- `session.key`：`^[A-Za-z0-9_-]{1,120}$`；Builder 以 key 串行化同 lane 的页面任务。
- `first=true`：创建会话并写入 deck context / materials；后续页面复用同一会话。
- `page_index` / `page_total`：用于任务卡与轮换判断，必须满足 `0 <= page_index < page_total`。
- `feedback` 非空时视为单页修复：使用独立 repair 会话（`deck_{id}_repair_{uuid}`）或空闲 lane，不打断进行中的 lane。

`DELETE /v1/sessions/{key}`：

- 202：已关闭（或不存在，幂等）；
- 用于 Deck 结束/取消后的尽力清理；TTL 兜底。

## 3. 工作目录

```text
/tmp/mockfinal-sessions/{deck_id}/
├── deck/context.json
├── deck/handoff-lane-{n}.md
├── materials/index.md + {section_id}-{slug}.md
├── pages/{page_id}/{brief.json,manifest.json,page.html,page.css,page.js}
└── scaffold/{role}/...
```

- Pi 会话 `cwd` 为 deck 根；页面只能写 `pages/{active_page_id}/` 下的 4 个产物。
- `materials/` 与 `deck/context.json` 只读；`scaffold/` 为角色模板副本。
- 逐页模式下保持现有 `buildDir` 工作目录与 Guard 行为不变。

## 4. Guard 与安全边界

- Guard binding 以 deck 根为 key，绑定 `active_page_id`。
- `write/edit` 仅允许 `pages/{active_page_id}/{manifest.json,page.html,page.css,page.js}`；禁止写其他页面、materials、deck context。
- `read` 允许 deck 根、materials、harness 与已完成页面目录；仍拒绝越界与符号链接。
- `check_page` 可带 `page_id`，必须等于 active page；只收集该页 bundle。
- 页面代码仍只由 Validator 执行；Builder 不持有 DB/OSS/JWT 密钥。

## 5. 生命周期

```text
创建 lane 会话（first=true）
  → 设置 active page → 页任务 → 页校验/修复
  → 记录页摘要与 usage 差值
  → 下一页（同一会话）或轮换
  → DELETE /v1/sessions/{key} 或 TTL 清理
```

轮换条件（任一）：

- 本会话已构建 `BUILDER_SESSION_PAGES_PER_LANE` 页；
- 进入新章节；
- 上下文使用率超过 `BUILDER_SESSION_CONTEXT_RATIO`；
- 页面失败/取消/模型异常后。

轮换时写 `handoff-lane-{n}.md`：deck 目标与风格、已完成页标题/角色/关键概念/交互模式、已发现易错与布局问题、下一页承接点；不写原始页面代码与完整资料。新会话首条 prompt 只带 handoff + 当前页任务，需要代码时由模型 `read`。

## 6. 成本与事件

- `getSessionStats()` 为累计值：每页记录 before/after 差值，写入 `BuildUsage` 的 `input/output/cache_read/cache_write/cost`。
- 成功日志字段：`deck_id/job_id/page_id/session_key/lane/page_index/input/output/cache_read/cache_write/cost/teaching_score/rotation_reason/thinking_level`。
- 页面事件仍是页级；切换页面前清空文本缓冲，避免串页。
- `PAGE_BUILDER_COST_*` 配置后 `usage.cost` 才有估算值；真实支出以网关余额差值为准。
- Prompt：新会话用完整任务模板（`PAGE_BUILDER_PROMPT_PROFILE=zh|compact`）；同 lane 后续页面改用短任务卡（brief/目标/密度/承接 + 验收），不重复 SKILL/契约与长规则。
- 新会话首条消息注入一次性 `Deck 会话上下文`（Deck 标题/风格/lane/页码），并写入 `deck/context.json`；后续消息只追加，不修改前缀。
- 自动压缩作为兜底：`compaction.enabled=true`，`reserveTokens=24000`，`keepRecentTokens=20000`；优先靠轮换控制上下文。

## 7. 失败隔离

- 单页最终失败不销毁 lane；失败页由主 API 决定重试或标记 failed。
- 会话级异常（模型/工具/上下文）关闭会话，下一页新建并从 handoff 恢复。
- 取消页面：abort 当前 prompt，会话标记 dead；Deck 取消：主 API 取消所有在途页面，Builder 清理会话与目录。
- Builder 重启：会话全部丢失，主 API 重新以 `first=true` 建 lane；已完成页面保持 current。

## 8. 验收与指标

- 教学结构完整率 100%；首轮通过率 ≥75%（修复后 ≥95%）。
- 桌面零滚动/安全 100%；移动端无横向溢出且可纵向滚动。
- 14 页成本 ≤¥1.2；Deck 时长 ≤20 分钟；无跨页内容/事实污染。
- A/B：逐页 vs lane、zh vs compact、thinking off/minimal/low；黄金集 8–10 页，记录成本、延迟、首轮通过率、教学评分。

## 9. 当前状态

- 已实现（2026-11-08）：Builder lane 池（`session.key` 串行、deck 根 cwd、active page Guard、页级 usage 差值、handoff、TTL/DELETE 清理）、`session` 请求字段、`DELETE /v1/sessions/{key}`、主 API 按章节分配 lane 与 `DECK_SESSION_REUSE_ENABLED` / `DECK_LANE_COUNT`；新会话完整模板 + Deck 上下文，后续页面短任务卡；compact profile；自动压缩兜底；Mock/真实 Pi 均验证。
- A/B 实测（2 页黄金样本，全部 passed、教学分 80）：逐页/zh/medium 合计输入 69,633；lane/zh/medium 36,490（−47.6%）；lane/compact/low 20,564（−70.5%），输出 −39.9%，耗时 −43.5%。明细与限制见 `P11_COST.md`。
- 失败注入：页面取消、Validator 宕机 fail-closed、Builder 重启均可恢复；同 key 下一页自动新建/复用会话，无跨页污染，DELETE 202 幂等。
- 14 页门禁（P13，2026-11-08）：job 12 整册重建 **14/14 ready、0 failed、940.8s、首轮 14/14**，教学分均 80；实际支出 **¥1.53**（余额 114.06 → 112.53），满足 P13 ≤¥2，高于单 Deck ¥1.2 的目标值（原因见 `P11_COST.md` §7.1）。逐页 usage 见 `P13_RESULTS.json`。
- 待完成：thinking 档位 A/B 需支持 reasoning 的网关（当前 `PAGE_BUILDER_REASONING=false`，未测出档位差异）。
- 回退：`BUILDER_SESSION_MODE=page` 与 `DECK_SESSION_REUSE_ENABLED=false` 恢复逐页模式；`PAGE_BUILDER_PROMPT_PROFILE=zh` 恢复完整中文提示词；教学开关与模板回退见 `TEACHING_PAGE_SPEC.md`。
