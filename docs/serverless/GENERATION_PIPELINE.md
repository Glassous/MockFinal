# 生成与 Deck 构建流水线

本文件描述 `functions/routes/generation.ts` 与 `functions/routes/decks.ts` 的状态机、预算、Storage 布局、
幂等策略与失败语义。**代码是唯一事实来源**；改动阶段或游标字段时必须同步本文件。

## 1. 为什么由客户端推进

Qoder Sites 没有 cron / queue / worker，函数调用即请求生命周期。为了让长任务不依赖单次 HTTP 连接：

- 任务状态与游标持久化在 `generation_jobs.cursor` / `deck_build_jobs.cursor`，租约在 `lease_key` / `lease_until`。
- 前端每 400ms 调用一次 `POST .../advance`；每次只执行**一个工作单元**（通常一次 LLM 调用）。
- 关闭页面、刷新、断网只是停止调用 advance；任务不会失败或回滚，重新进入后继续推进。
- 两个并发 advance 由租约互斥：租约未过期时后到者直接返回当前任务快照。

失败分类：

| 情况 | 处理 |
| --- | --- |
| 429 / 502（限流、网关抖动） | 释放租约并抛给前端，任务保持 `running`；前端退避 1.2s / 3s |
| 其他异常 | 任务置 `failed`，写入中文 `error`；已完成的页面/工件保留 |
| 租约冲突 | 不执行任何工作，返回当前快照 |

## 2. 资料生成（两份 Markdown）

### 2.1 阶段

`POST /workspaces/:id/generate` 创建 `generation_jobs(status='pending')`；随后由
`POST /jobs/:id/advance` 推进：

```text
map → reduce（0..N 层）→ outline → review（逐章）→ exam（5 片）→ assemble → done
```

| 阶段 | 每次 advance 的工作 | 输入 | 输出 |
| --- | --- | --- | --- |
| `map` | 处理一个 20,000 字块 | 资料分块 + 400 字重叠 | digest ≤1200 字，写 `digest/L0-{i}.md` |
| `reduce` | 合并一组（≤4 份） | 上一层 digest | 合并 digest ≤1500 字，写 `digest/L{level+1}-{i}.md` |
| `outline` | 生成章节目录 | 最终 digest | 4–10 章 JSON，章节列表写入 cursor |
| `review` | 生成一章正文 | 最终 digest + 本章要点 | 1200–2200 字 Markdown，写 `review/{i}.md` |
| `exam` | 生成一个题型分片 | 最终 digest + 题型要求 | Markdown，写 `exam/{i}.md`，受 `maxTokens` 约束 |
| `assemble` | 组装并落库 | 全部 review/exam 分片 | 两份工件 + `job=done` |

- 分块由 `functions/lib/corpus.ts` 确定性生成：按资料顺序与字符区间切分，块间重叠 400 字，
  **不丢字符、不截断全文**；同一 job 内边界稳定。
- reduce 在份数 ≤4 时停止，进入 `outline`。
- 试卷固定 5 片：选择 8 题 / 填空 5 题 / 简答 4 题 / 综合 2 题 / 参考答案与解析。
- 每次 advance 只做一次主要 LLM 调用；`LLM_TIMEOUT_SECONDS` 默认 60，`maxTokens` 默认 4096。

### 2.2 游标

```ts
{
  v: 2,
  phase: 'map' | 'reduce' | 'outline' | 'review' | 'exam' | 'assemble' | 'done',
  materialIds: number[],
  chunkTotal: number,
  mapDone: number,
  reduceLevel: number,
  reduceDone: number,
  reduceTotal: number,
  chapters: Array<{ title: string; points: string[]; summary: string }>,
  chapterDone: number,
  examDone: number
}
```

游标只存计数、章节标题与阶段，**不存正文**；正文都在 Storage。

### 2.3 Storage 布局

```text
jobs/{userId}/{jobId}/digest/L{level}-{index}.md   分块/合并 digest
jobs/{userId}/{jobId}/review/{index}.md            逐章复习稿
jobs/{userId}/{jobId}/exam/{index}.md              试卷分片
artifacts/{userId}/{workspaceId}/{jobId}-review.md 最终工件
artifacts/{userId}/{workspaceId}/{jobId}-exam.md   最终工件
```

`assemble` 先写 Storage，再以 `(job_id, kind)` 为唯一键写 `artifacts` 表；重放同一 job 不会产生重复工件。

## 3. Deck 逐页构建

### 3.1 阶段

`POST /decks/:id/build` 创建 `deck_build_jobs`；`POST /deck-jobs/:id/advance` 推进：

```text
index → reduce → plan → detail（逐章）→ page（逐页）→ render（逐页）→ done
```

| 阶段 | 每次 advance 的工作 | 输出 |
| --- | --- | --- |
| `index` | 一个资料分块的 digest | `decks/{deckId}/jobs/{jobId}/digest/L0-{i}.md` |
| `reduce` | 合并一组（≤4 份） | 上一层 digest |
| `plan` | LLM 输出章节与知识点 JSON | `knowledge_points`、`deck_pages(planned)`、`outline.json` |
| `detail` | 补全一章 KP 的 objectives / formulas / source_refs | 更新 `knowledge_points` |
| `page` | 为当前页生成 PageContent 2.0 JSON | `.../pages/{pageId}.json`，页面 `building` |
| `render` | page-kit 校验 + 渲染 + 条件落库 | bundle、页面 `ready` 或 `failed` |
| `done` | 统计页数、写 `source_signature` | `job=done`，Deck `ready/partial/failed` |

- `plan` 会先清理旧 KP / 页面与对应对象；`source_refs` 只接受属于当前工作区的 `section_id`，
  无法命中时标「资料未覆盖」，不伪造来源。
- 页面数量由 `functions/lib/planner.ts` 按密度决定：`concise 6–9`、`standard 10–14`、`deep 14–16`；
  章节末生成 summary 页，知识点按 `ROLE_SEQUENCES` 追加练习/例题页。
- `page` 的单页 brief 预算 12,000 字：KP 字段 + 引用分节原文（单节截断 3,000 字），
  这是**单页展示预算**，不是全文截断。
- `render` 先用 `validateContent` 结构校验；有 error 且 `attempts < 2` 时把 `describeIssues` 回传做一次
  repair；仍失败则页面 `failed`，其余页面继续。

### 3.2 游标

```ts
{
  v: 2,
  phase: 'index' | 'reduce' | 'plan' | 'detail' | 'page' | 'render' | 'done',
  chunkTotal: number,
  mapDone: number,
  reduceLevel: number,
  reduceDone: number,
  reduceTotal: number,
  chapters: Array<{ title: string; kpIds: number[] }>,
  chapterDone: number,
  totalPages: number,
  pageOrdinal: number,
  currentPageId: number | null,
  attempts: number,
  singlePage?: boolean
}
```

### 3.3 Storage 与 bundle

```text
decks/{deckId}/jobs/{jobId}/digest/L{level}-{index}.md
decks/{deckId}/jobs/{jobId}/outline.json
decks/{deckId}/jobs/{jobId}/pages/{pageId}.json
decks/{deckId}/pages/{pageId}/v{version}.json     # bundle
```

bundle 形状（前端阅读器契约）：

```json
{
  "schema_version": "1.1",
  "runtime_version": "1.1.0",
  "manifest": { "...": "page-kit manifest" },
  "html": "<...>",
  "css": "",
  "js": ""
}
```

- 渲染后字节校验 ≤2 MiB，超限按失败处理。
- 公式由 page-kit 输出 `<span class="mf-tex" data-tex="..." data-display="0|1">` 占位；
  前端 `lib/pageShell.ts` 读取 bundle 后用 KaTeX（MathML）替换。函数内不打包 KaTeX。
- 页面版本 `current_version` 只在渲染成功时 +1；新 bundle key 与版本同一原子步骤写入。

### 3.4 取消、重做与旧版本

- `POST /decks/:id/cancel` 只设置一次：`cancel_requested=true`，job 立即 `canceled`；
  `building` 页面若有旧 bundle 回到 `ready`，否则回到 `planned`。已 ready 页面与 bundle 全部保留。
- 单页重做 `POST /decks/:id/pages/:page/rebuild`：创建 `target_page_id` + `feedback` 的 job，
  cursor 直接进入 `singlePage` 模式；成功前旧 `current_version` / `bundle_key` 不变，旧页面仍可读。
- 整册重做 `rebuild_all=true` 复用现有页面计划逐页重建；失败页保留旧 ready 版本。
- 取消是显式用户操作；页面关闭、断网不发送取消信号。

### 3.5 源资料变更

`done` 阶段写入 `review_decks.source_signature`（工作区分节 id+content 的 sha256）。
`GET /decks/:id` 返回 `source_changed`，前端提示资料已变化、可重新规划。

## 4. 幂等与并发

- Storage key 由 `jobId` / `pageId` / 固定序号决定，`saveBytes` 覆盖写；重放同一阶段得到同一 key。
- `page_ready` / `job_done` 等事件按 job 记录；页面计数器在 `render` 后从 `deck_pages` 重算，
  不做跨行自增，避免重放漂移。
- 租约 120s：`lease_until` 过期后下一次 advance 接管。并发调用只有一个能执行工作单元。
- 数据库无事务：多表写入按「子表 → 父表」或「先对象后行」顺序执行；任何一步失败即停并落失败态。

## 5. 前端推进循环

生成页与构建页共用同一模式：

1. 活动任务时先 `POST advance`，再 `GET job` 与 `GET events?after_id=`。
2. 429 → 1.2s 退避；502 → 3s 退避；其他错误 2s 兜底轮询，连续 3 次才提示。
3. 任务终态后刷新 Deck / 工件，停止 advance。
4. 页面隐藏时降低频率，但**不取消任务**。

## 6. 成本与预期

- 调用次数约为 `ceil(总字数 / 20000) × (1 + reduce 开销) + 章节数 + 5 + 页面数`。
- 8 MiB 文本会产生数百个分块，耗时与费用显著；前端展示当前块数与页数进度，**不静默截断**，
  由用户决定是否发起。
- 页面问答单次 `maxTokens=900`，问题 ≤2000 字，不做分钟级限流（无可靠共享计数器）。

## 7. 相关文件

- `functions/lib/corpus.ts`：全文加载与确定性分块
- `functions/lib/planner.ts`：密度、角色序列与页面计划
- `functions/lib/json.ts` / `json-chat.ts`：宽松 JSON 提取与修复调用
- `functions/lib/page-kit/`：PageContent 2.0 校验与纯 TS 渲染
- `functions/routes/generation.ts` / `functions/routes/decks.ts`：两个状态机
- `frontend/src/views/WorkspaceView.vue` / `frontend/src/views/DeckBuildView.vue`：advance 循环
