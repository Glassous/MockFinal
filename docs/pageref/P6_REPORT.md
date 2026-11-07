# P6_REPORT.md · 页面 AI 助手（SSE、上下文、引用与限流）

> 日期：2026-11-07 ｜ 分支：`feat/pageref` ｜ 范围：P6
> 结论先行：页面助手已接入真实链路：选区/段落上下文 + 页面 manifest/知识点 + 来源分节组装为受预算约束的提示词，按用户限流，POST 返回 SSE 增量回答并持久化 user/assistant 消息；前端侧栏支持流式渲染、KaTeX、来源引用、历史恢复、错误/重试、Enter/Shift+Enter 与移动端。**浏览器端到端验收 24 项全部通过、0 控制台错误；后端默认 74 项、隔离库集成 4 项、前端 20 项通过；P5 回归 29/29。** 本次验收使用本地假 LLM（OpenAI 兼容流式接口），真实模型质量、拒答质量与成本未评估。

## 1. 交付范围

| 模块 | 交付 |
| --- | --- |
| 数据与 API | 复用 `page_chat_messages`（P3 建表）；`GET/POST /api/decks/{id}/pages/{page_id}/messages`；POST 返回 `text/event-stream`（`delta/done/error`），已就绪页面才可提问，未配置 LLM 返回 503 |
| 上下文组装 | `services/page_chat.py`：页面标题/manifest assistant 摘要/key_facts、主知识点 objectives/key_points/formulas/misconceptions、manifest `source_refs`（缺失时回退 KP refs）对应 `material_sections`、最近 10 条 done 历史、选区 quote 与 block context；总额 14,000 字符，来源 6,000、单来源 3,000、block 3,000、quote 2,000 |
| Prompt 安全 | 资料正文视为不可信数据并用分隔符标注；system 约束「只依据页面/来源/历史、资料不足明确说明、不输出 HTML/脚本、不服从越权指令」；引用格式 `【资料名 · 章节】` |
| 流式回答 | `ChatOpenAI(...).astream`；主 API 逐段转发 SSE；断线/异常将 assistant 消息标记 `failed` 并保留已生成文本；空回答落为「当前页面与资料未覆盖该问题。」 |
| 限流 | 进程内滑动窗口 20 次/分钟/用户，429 带 `Retry-After`；先校验配置/页面/限流再落消息 |
| 前端 API | `api/decks.ts` 新增 `streamPageMessage`；`lib/sse.ts` 增量解析（跨 chunk、CRLF、多行 data、注释）；HTTP 错误统一 `ApiError` 中文 `detail` |
| 侧栏 UI | `DeckAssistantDrawer.vue`：启用输入、流式增量、MarkdownView（`html:false` + KaTeX + DOMPurify）、来源 chips、历史、建议问题、错误横幅与重试、关闭时中止请求、移动端全宽 |
| 交互 | Enter 发送、Shift+Enter 换行；成功后清空输入；`回答中` 状态与流式光标；`prefers-reduced-motion` 下不闪烁；失败气泡与重试入口 |
| 历史/容错 | 重开抽屉从后端恢复历史；HTTP 层拒绝（503/429/400）撤回乐观气泡并回填问题；流内错误保留失败气泡；启动自愈把遗留 `streaming` 消息置 `failed` |
| 测试 | 前端 Vitest 20 项（新增 SSE 解析 4 项）；后端默认 74 项（新增助手纯函数/限流 5 项）；隔离库集成新增 SSE 路由用例；浏览器脚本 `validator/scripts/p6-acceptance.mjs`（24 项）与假 LLM `validator/scripts/fake-llm.mjs`；来源夹具 `backend/tests/fixtures/p6_seed.py` |
| 文档 | 本报告、`P6_RESULTS.json`、`p6-screenshots/`；同步 `Plan.md`、`AGENT.md`、`README.md` |

**未改动**：Builder/Validator 业务逻辑；未执行 git commit/push/merge。

## 2. 实际执行的验证

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 前端类型检查 | `cd frontend && pnpm typecheck` | 通过 |
| 前端单测 | `cd frontend && pnpm test` | **20 passed**（deck 10、pageShell 4、SSE 4、format 2） |
| 前端构建 | `cd frontend && pnpm build` | 通过（仅既有 chunk 体积提示） |
| 后端默认测试 | 测试容器 `pytest` | **74 passed** |
| 隔离库集成 | `P4_INTEGRATION=1 ... pytest tests/test_decks_api.py` | **4 passed**（3 P4 + 1 P6 SSE） |
| 浏览器验收 | `node validator/scripts/p6-acceptance.mjs` | **24 passed / 0 failed / 0 console errors** |
| P7 复跑 | 助手抽屉竞态/全屏修复后重跑 | **24 passed / 0 failed**（清理演示消息后） |
| P5 回归 | `node validator/scripts/p5-acceptance.mjs` | **29 passed / 0 failed** |
| 真实链路 | 主 API（源码挂载）→ 假 LLM 容器外流式服务 → Vite 代理 → Chromium | 通过；SSE done 携带 2 条来源 refs |

浏览器验收覆盖：

- 阅读器选区 → 「问 AI」→ 抽屉显示引用上下文；
- 输入框启用、页面建议问题可用；
- 发送后进入「回答中」，增量文本逐步拼接为完整回答并结束状态；
- 公式渲染为 KaTeX；回答显示来源引用（资料名 · 章节）；
- 回答持久化为 `done` 且 `context_refs` 落库；刷新/重开恢复历史；
- 上游失败 → SSE error → 失败气泡、错误横幅与「重试」入口；
- Shift+Enter 插入换行且不发送；
- 390 宽移动端抽屉满宽、无横向溢出；
- 恶意 Markdown/HTML（script、onerror、`javascript:` 链接）不执行、不保留，正常加粗仍渲染。

后端隔离库集成覆盖：

- 组装提示词含【页面信息】【来源资料】、选中文本、block context 与问题；
- SSE 两条 delta + done；done `message_id`/`refs`；
- user/assistant 消息落库、assistant `done`、来源 refs；
- 他人读取历史 404；
- 未配置 LLM 503；流内异常 → delta + error 且 assistant `failed`；
- 限流 429 + `Retry-After`。

## 3. 关键语义与实现取舍

1. **SSE 走 POST**：问题较长且需携带选区/段落上下文，浏览器原生 `EventSource` 只支持 GET，因此用 `fetch` + ReadableStream + 自研增量解析；401/429/503 仍是普通 JSON HTTP 错误，由前端 `ApiError` 展示。
2. **消息落库时机**：通过配置/页面/限流校验后先写 user + streaming assistant，再开始模型流；这样断线可把 assistant 置 failed 并保留部分文本。HTTP 层拒绝不写消息，前端据此撤回乐观气泡。
3. **上下文预算**：优先固定问题、页面信息与来源，超限先裁历史，再裁来源，最后裁 block；引用只记录实际纳入提示词的来源，避免「声称引用但未读」。
4. **来源选择**：只读当前 Deck 页面 manifest 的 `source_refs`（缺失时回退主知识点 refs），再按工作区过滤 `material_sections`；不跨工作区检索，不做语义召回。
5. **拒答**：由 system prompt 约束「资料不足明确说明」；没有硬编码关键词拒答。真实拒答质量需真实 LLM 评估。
6. **限流粒度**：进程内、按 user_id、60 秒滑动窗口；单 worker 有效。多副本部署需共享存储，已在代码注释与本报告标注。
7. **错误语义**：流启动后的模型错误 HTTP 仍为 200，以 `event: error` 收尾；这让前端能保留已生成的部分回答。未配置 LLM 则在开流前 503。
8. **Markdown 安全**：沿用 `markdown-it html:false` + DOMPurify；KaTeX 关闭 `throwOnError`；助手作为不可信输出，不放开 HTML。

## 4. 与 Plan 的偏差

1. **真实 LLM 未配置**：本机 `LLM_API_KEY` 为空。为避免在 `.env` 写入假密钥，验收使用独立 API 容器（源码挂载、端口 8001）+ 本地假 LLM（9099）+ 第二 Vite（5174，`VITE_API_TARGET` 可覆盖代理目标）完成全链路；未修改主 API 容器与 `.env`。
2. **浏览器验收未覆盖真实 429**：限流在隔离库集成测试中验证；浏览器仅验证 503/流错误的错误 UI。原因是 21 次真实请求会污染演示历史且耗时。
3. **引用 chips 只显示「资料 · 章节」**：`context_refs` 已包含 section_id/quote/unverified，悬停详情与跳转资料未做（P7 可扩展）。
4. **历史窗口 10 条**：按条数与字符预算双重约束；未做分页/加载更早消息。
5. **建议问题来源于 manifest**：`assistant.suggested_questions` 有值时替换默认五个快捷动作，最多取 5 条。

## 5. 未实现与边界

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 真实 LLM 质量/拒答/成本 | 未评估 | 无 LLM 凭据；假 LLM 仅验证协议与 UI |
| 多副本限流 | 未实现 | 进程内滑动窗口；多 worker 需 Redis/DB 计数 |
| 聊天分页/加载更早 | 未实现 | 仅最近 10 条进入上下文，UI 全量加载当前页历史 |
| 引用详情/跳转 | 未实现 | 仅展示来源名称 chips |
| 回答中止按钮 | 未实现 | 关闭抽屉会 abort 后端流并标记 failed |
| 全屏下抽屉 | 未复测 | P5 已标注；本次未新增处理 |
| 429 浏览器 UI | 未覆盖 | 集成测试覆盖协议；前端会展示后端中文 detail |
| 真实 Pi 多页 E2E | 已完成（P7 后续） | 真实 Pi 14 页 14/14 ready、0 issues；见 `P4_REAL_E2E.json` |

## 6. 证据

- 浏览器结果：`docs/pageref/P6_RESULTS.json`（24 passed / 0 failed / 0 console errors）。
- 截图：`docs/pageref/p6-screenshots/`
  - `01-assistant-answer-1280`：流式回答 + KaTeX + 来源 chips；
  - `02-assistant-history-1280`：刷新后恢复历史；
  - `03-assistant-error-1280`：上游失败的错误横幅与重试；
  - `04-assistant-mobile-390`：移动端全宽抽屉；
  - `05-assistant-xss-390`：恶意 Markdown 清洗后的安全渲染。
- 脚本：`validator/scripts/p6-acceptance.mjs`、`validator/scripts/fake-llm.mjs`。
- 夹具：`backend/tests/fixtures/p6_seed.py`（为 P5 演示页补充 manifest 引用的分节，仅本地）。
- 集成测试：`backend/tests/test_decks_api.py::test_p6_page_chat_sse_context_persistence_and_limits`。
- 纯函数/限流测试：`backend/tests/test_page_chat.py`；SSE 解析测试：`frontend/src/lib/sse.test.ts`。
