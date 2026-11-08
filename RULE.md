# RULE.md · MockFinal 仓库规范

> 本文件规定**代码规范、接口契约、文档义务与 Git 协作纪律**。工作区中的 Agent 与人类开发者都必须遵守；提交前逐条对照第 9 节检查表。
> 前端视觉与美学规则不在此文件，见 `DESIGN.md`；项目结构与流程见 `AGENT.md`。

## 1. 基本原则

1. **小步、原子、可回滚**：一次只解决一个问题；每个 commit 都能独立解释、独立回退。
2. **契约优先**：后端 `schemas.py`、前端 `types/index.ts`、`api/*.ts` 的字段名逐字一致；破坏契约的改动必须在同一个原子任务里同步三处。
3. **默认安全**：不泄露密钥、不信任用户输入与 LLM 输出、所有资源校验归属。
4. **优雅降级**：OSS、LLM 未配置时，系统仍能在受限模式下运行并给出中文提示；不得让可选依赖阻断核心链路。资料解析分节不依赖外部服务。
5. **不引入无必要的复杂度**：能用一个函数解决的不建抽象；不为假想需求预留架构。新增框架、迁移工具、消息队列等必须先与人类维护者确认。
6. **中文面向用户，英文面向代码**：UI 文案、错误信息、日志、注释、README/文档使用中文；变量、函数、类型、表名、API 字段使用英文。
7. **前后端职责单一**：前端只负责展示与 API 调用；业务规则、最终校验、权限判断、状态机、任务编排、AI 与存储决策全部在后端执行。前端可保留展示所需的交互状态与轻量输入预检，但**后端是唯一事实来源**。
8. **长任务生命周期独立于客户端**：生成、索引、流式输出等长任务的存续不依赖浏览器页面或 HTTP 连接；页面关闭、刷新、断网或连接断开，不得导致任务停止、回滚、丢弃结果或被标记失败。

## 2. Git 分支与提交规范

### 2.1 分支模型

- `main` 是唯一主分支，必须始终可运行、可交付。
- **功能开发必须在功能分支中进行**，禁止直接向 `main` 提交（包括文档与紧急修复）。
- 功能分支规则为 `feat:[新功能名称]`。由于 Git ref 不允许 `:` 和 `[`（`git check-ref-format` 会拒绝），落地写法统一为 `feat/<新功能名称>`，例如 `feat/workspace-share`、`feat/ai-mindmap`、`feat/export-pdf`。语义与规则原文一致。

- 其他任务类型的合法分支名：

| 任务类型 | 分支名 | 示例 |
| --- | --- | --- |
| 新功能 | `feat/<名称>` | `feat/question-bank` |
| Bug 修复 | `fix/<名称>` | `fix/upload-progress` |
| 重构（行为不变） | `refactor/<名称>` | `refactor/indexer-pipeline` |
| 纯文档 | `docs/<名称>` | `docs/agent-guides` |
| 依赖/工具/构建 | `chore/<名称>` | `chore/bump-deps` |
| 大规模视觉改版 | `design/<名称>` | `design/editorial-v2` |

- 分支从最新的 `main` 切出；开发期间及时同步 `main`，评审前解决全部冲突。
- 一个分支只承载一个内聚目标；不要在工作分支里顺手做无关清理。
- **任何分支合并进 `main` 前必须由人类维护者审阅并明确同意。** 自动化检查通过不等于可以合并；Agent 不得自行合并、不得代替人类做合并决定。

### 2.2 原子任务与 commit 粒度

- **一个原子任务 = 一个 commit**。原子任务指：一个可独立描述、可独立验证、可独立回退的改动；完成后仓库仍可构建/运行。
- 允许在功能分支上产生临时的 WIP / fixup commit；**评审前必须整理为干净的历史**（squash / rebase fixup），保证每个最终 commit 都是一个原子任务。
- 同一原子任务内的代码、契约、必要文档、锁文件必须一起提交；不要拆成「代码一个 commit、类型另一个 commit」这种不可独立运行的状态。
- 禁止把以下内容与功能改动混在同一 commit：全仓库格式化、无关重命名、依赖大升级、纯注释清理。
- 提交前审查暂存区，**不要盲目 `git add -A`**；确认没有 `.env`、密钥、`backend/data/`、`dist/`、`node_modules/`、调试代码、临时文件。

### 2.3 Commit message（Conventional Commits）

格式：

```text
<type>(<scope>): <中文摘要>

<可选正文：为什么这样改、影响范围、取舍>
<可选脚注：BREAKING CHANGE / 关联 issue>
```

- `type` 取值：`feat`、`fix`、`refactor`、`docs`、`style`（仅格式）、`test`、`perf`、`build`、`ci`、`chore`。
- `scope` 可选，推荐使用：`backend`、`frontend`、`db`、`docs`、`infra`，或具体模块名（`auth`、`generation`、`upload`）。仓库已有示例：`feat(backend): 初始化 MockFinal 后端应用项目骨架`。
- 摘要使用中文、祈使/陈述语气，≤ 50 个字符，结尾不加句号；正文说明**为什么**，不要复述 diff。
- 破坏性变更必须在 type 后加 `!` 并在脚注写 `BREAKING CHANGE: ...`，例如 `feat(api)!: 重命名资料列表字段`。
- 一个 commit 只对应一个 type；不要用 `feat: xxx + 修复 yyy` 混合描述。

示例：

```text
feat(backend): 新增工作区资料全文检索接口
fix(frontend): 修复深色模式下弹窗遮罩层级错误
docs: 补充 Agent 文档与设计规范入口
refactor(sectioner): 拆分解析与资料分节流程
```

### 2.4 合并与保护

- 默认使用 merge commit 合并功能分支，以保留分支内的原子提交；是否 squash 由人类评审者决定。
- 禁止对 `main` 执行 force push；禁止强推已共享的功能分支；禁止改写他人已推送的历史。
- 合并前必须满足：人工批准、`pnpm typecheck` 通过（涉及前端时）、受影响的运行路径已实际验证、无未解决冲突。
- 功能分支合并后由合并者删除远端分支；本地分支按需清理。
- **Agent 不得擅自 `git push`、创建/关闭 PR、合并分支或修改远端设置**，除非用户在当前会话中明确指示。

## 3. 后端代码规范（Python / FastAPI）

### 3.1 风格与组织

- Python 3.12；4 空格缩进；双引号；模块、类、函数使用中文 docstring 说明职责与关键取舍。
- 命名：模块/函数/变量 `snake_case`；类 `PascalCase`；常量 `UPPER_SNAKE_CASE`；布尔服务标志用 `*_configured`（如 `oss_configured`）。
- 新代码必须为所有函数签名补类型标注（现有极少数配置校验器例外）；可选值用 `str | None` / `dict[int, list[dict]]`，不用 `Optional`/`List` 旧写法。
- 导入顺序：标准库 → 第三方 → 本地相对导入（`from ..config import settings`）。避免循环导入；确有需要时在函数内局部导入（现有 `services` 与 `routers` 已有先例）。
- 行宽以可读为先，通常 ≤ 100 列；不要写超长单行表达式。前端模板中的长 Tailwind 类名串不受此限制。
- 模块 docstring 若描述启动顺序、状态机或外部系统约束，修改行为时必须同步更新。

### 3.2 分层职责

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| `routers/` | HTTP 参数/状态码、鉴权依赖、调用 service、序列化响应 | 复杂业务编排、长期 IO、直接拼业务 SQL |
| `services/` | 业务编排、外部系统（LLM/OSS/STS/解析） | 依赖 FastAPI `Request`/`HTTPException` 处理纯业务（storage 的路径校验除外） |
| `schemas.py` | 请求/响应契约、字段校验 | 数据库访问 |
| `models.py` | ORM 表结构、关系、状态字段 | 业务查询与外部调用 |
| `security.py` / `deps.py` | 哈希、JWT、当前用户 | 业务规则 |

- 资源归属校验统一走 `get_owned_workspace` / `get_owned_material` / `get_owned_artifact`，**他人资源一律 404**。
- 新增路由必须在 `main.py` 中 `include_router`；同一资源路径风格保持一致（`/api/workspaces/{id}/materials`）。

### 3.3 异步与数据库

- 路由全部 `async def`；任何同步阻塞调用（bcrypt、文件 IO、OSS SDK、pdfplumber、python-docx/pptx）必须 `asyncio.to_thread`。
- 请求级数据库依赖只用 `get_db`；**后台任务必须自建 `async with SessionLocal() as db`**，不得持有请求 session。
- 长耗时操作（下载、解析分节、LLM）期间不得持有 DB session；状态更新使用独立短 session。
- 使用 SQLAlchemy 2.0 风格：`select()`、`update().where()`、`Mapped[...]` / `mapped_column`；避免 1.x Query API。
- `create_all` 只用于幂等建表；**没有迁移工具**。给已存在的表加列时，必须在 `lifespan` 中用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 幂等补齐，并同步模型与文档。
- 并发兜底：应用层检查 + 数据库约束（如 `uq_job_active` 部分唯一索引）；捕获 `IntegrityError` 时回滚并返回 409。
- 原生 SQL 仅用于内部常量表名等无法参数化的场景，必须带 `# noqa: S608` 并注明原因；用户输入一律参数绑定。

### 3.4 错误处理与日志

- 面向用户的错误：`HTTPException(status_code=..., detail="中文可读文案")`；不要返回英文堆栈或内部标识。
- 边界处捕获宽泛异常必须：`except Exception:  # noqa: BLE001` + 说明为什么不能抛出（如外部资源清理、RAG 增强失败、后台任务兜底），并记录日志。
- 后台任务入口必须有整体 try/except，把失败落到 `GenerationJob.error` / `Material.error`，绝不让异常外溢到事件循环。
- 外部资源清理（OSS 对象）是 best-effort：DB 行删除成功后，清理失败只 `logger.warning`，不得让接口 500。
- 日志使用模块级 `logger = logging.getLogger(__name__)`；禁止 `print`。日志内容中文、带关键 ID；不要记录密码、token、AK/SK、完整问答敏感内容。
- 用户输入在系统边界校验：扩展名、大小、文件名、storage_key 前缀、目录穿越、路径合法性。

### 3.5 配置与依赖

- 所有配置经 `config.py` 的 `Settings`；业务代码禁止直接 `os.getenv`。新增变量必须同时更新 `backend/.env.example` 与 README 环境变量表。
- 可选能力通过 `settings.*_configured` 判断并优雅降级；缺失时返回可操作的中文提示（例如「未配置 LLM 服务…」）。
- 依赖版本约束是契约的一部分：
  - `fastapi==0.162.0`：`UploadFile` 继承关系特殊，升级前需复核 `request.form()` 的 isinstance 逻辑；
  - 不引入 `langchain-postgres` / `pgvector`：资料以 `material_sections` 显式分节，语义检索不是当前需求。
- 依赖升级单独一个 `chore`/`build` commit，并说明验证方式；不要夹带在功能 commit 中。

### 3.6 安全

- JWT 默认密钥仅用于开发；启动时若仍为占位值必须 `logger.critical` 告警。生产必须配置强随机 `JWT_SECRET`。
- 长期云 AK 只存在于后端；响应中只允许 STS 临时三元组。会话 Policy 的 `Version` 为 `"1"`，长度 ≤2048。
- 密码 bcrypt 上限 72 字节；密保答案 `strip + lower` 后哈希；重置密码递增 `token_version` 使旧 token 失效。
- 速率限制目前为进程内实现（多副本部署时需改为共享存储），修改前先说明。
- Markdown/LLM 输出视为不可信；前端必须保持 `html:false` + DOMPurify，不得为渲染效果放宽。

### 3.7 长连接与流式输出

- **数据库中的任务记录是唯一事实来源**：生成/索引等长任务的状态与结果以 `generation_jobs.status/stage/error`、`materials.status`、`artifacts` 等持久化数据为准，不以 HTTP 请求、SSE/WebSocket 连接或前端内存为准。
- 长任务必须通过应用级后台任务注册表（`tasks.spawn()`）执行，**禁止把任务执行挂在请求生命周期上**，例如在 `StreamingResponse` 的生成器里直接执行 LLM 调用或索引流水线。
- **客户端断开不得影响业务任务**：关闭页面、刷新、路由切换、网络中断、SSE/WebSocket 断开，只允许释放该连接的订阅、队列、缓冲区等资源；不得取消任务、不得将任务置为 failed、不得删除中间产物或已生成结果。
- 流式接口只负责「事件搬运」：从任务状态或进程内/跨进程事件通道读取并推送给当前订阅者。任务执行与推送解耦，**允许 0 个订阅者时继续运行**。
- 最终结果必须先持久化（写存储 + artifacts 落库 + job 终态），再发送完成事件；客户端中途断开时，结果不得丢失。
- 重连协议以稳定的 `job_id`（或等价任务 ID）为入口：重新订阅后先返回当前状态快照/阶段，再继续增量事件；不得要求客户端重新触发生成或从头接收全部历史。
- 当 `StreamingResponse` 用于生成/任务事件流时，客户端断开导致生成器被取消属于正常路径，必须捕获并只清理连接资源；**流式连接的取消不得传递到业务任务**。业务任务自身被显式取消或服务停机时，仍按现有逻辑落库终态。
- 进程内发布/订阅仅适用于单 worker；多 worker / 多副本部署必须改用跨进程通道（如 PostgreSQL `LISTEN/NOTIFY`、Redis），不能假设连接与任务落在同一进程。
- 除正常完成外，任务提前终止只能来自独立的取消接口或用户明确操作；**页面关闭、连接断开不视为取消**。
- 现有「后台任务 + 前端 2s 轮询」是参考实现：任务在后台运行，页面只观察状态。新增流式能力不得破坏这一语义。

## 4. 前端代码规范（Vue 3 / TypeScript / Tailwind）

### 4.1 文件与命名

- SFC 顺序固定：`<script setup lang="ts">` → `<template>` → `<style scoped>`（仅必要时）。
- 组件文件 `PascalCase.vue`；页面以 `View.vue` 结尾（`HomeView.vue`）；布局以 `Layout.vue` 结尾；基础组件使用 `App` 前缀（`AppButton`、`AppInput`）。
- 组合式函数暂无约定目录；如新增 `composables/`，函数名以 `use` 开头并返回显式类型。
- 类型统一放在 `src/types/index.ts`，与后端契约逐字对齐；API 入参类型可与接口函数放在 `src/api/*.ts`。
- 导入路径使用 `@/` 别名；仅类型导入使用 `import type`。

### 4.2 TypeScript

- `strict` 已开启，且启用 `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`。
- **禁止 `any`**（包括 `as any`、`<any>`）；无法确定的第三方类型用 `unknown` + 收窄，或像 `env.d.ts` 那样补充最小声明。
- 导出的 API 函数必须写返回类型（`Promise<Material>`、`Promise<void>`）；组件的 props/emits 使用 `defineProps<...>()` / `defineEmits<...>()` 并配 `withDefaults`。
- 非空断言（`!`）只在不变式明确时使用（例如刚插入数组后取回代理对象），必要时加一句原因注释。
- 不要为通过类型检查而放宽 `tsconfig`；也不要引入 `@ts-ignore`。如确需绕过，使用 `@ts-expect-error` 并写明原因。

### 4.3 代码风格（现状约定）

- 2 空格缩进；单引号；语句不加分号；多行结构保留尾逗号；模板属性每行一个。
- 当前未配置 ESLint/Prettier。新增代码保持上述风格；若引入格式化工具，必须单独开 `chore` 分支并一次性全量格式化，不得混入功能 commit。
- 禁止 `console.log` / `debugger`；错误通过 toast、表单内联提示或全局 401 处理呈现。
- 逻辑代码保持短行；Tailwind 类名串可长行，但要按视觉分组、避免重复造类。

### 4.4 网络与状态

- 所有 HTTP 请求集中在 `src/api/`，统一走 `client.ts` 的 `request` / `requestBlob`：自动注入 Bearer token、解析 `{detail}`、401 清 token 并跳登录。
- 组件内禁止直接 `fetch`；需要上传进度的场景使用 `api/materials.ts` 的 XHR 封装；OSS 直传逻辑只放在 `lib/oss.ts`。
- 错误处理统一：`error instanceof ApiError ? error.detail : '兜底中文文案'`；401 已全局处理，页面不要重复弹错。
- Pinia 使用 setup store；跨页面/跨组件共享状态才进 store。登录、登出、切换账号必须 `workspaceStore.reset()`，防止跨账号数据泄露。
- 轮询（2s）与上传中止必须在 `onBeforeUnmount` 清理定时器与 AbortController。
- 路由守卫使用 vue-router 5 的返回值写法；不要写 `next()`。新增受保护页面放在 `AppLayout` 子路由，访客页标记 `meta.guest`。

### 4.5 样式与视觉

- **唯一样式来源**：`src/style.css` 中的语义 token 与 `@theme inline` 映射。组件里只使用 `bg-surface`、`bg-panel`、`bg-raised`、`text-ink`、`text-muted`、`text-faint`、`border-border`、`bg-invert` 等语义类。
- **禁止在组件中写裸色值/裸阴影**（`#fff`、`rgba(...)`、`shadow-[...]`）；CSS mask 中仅表示透明度遮罩的 `#000` 除外。确需新增视觉变量时，先加到 `style.css` 并同步 `DESIGN.md`。
- 深浅色由 token 自动切换；新增组件必须同时在 `html.dark` 下检查对比度与层级。不要写只适用于单主题的颜色。
- 圆角、阴影、间距、动效遵循 `DESIGN.md` 的尺度；不要自创第三套按钮/卡片风格。
- 图标统一使用 `lucide-vue-next`，尺寸与描边按现有用法；纯图标按钮必须有 `aria-label` 与 `title`。
- 可访问性底线：表单 `label` 绑定输入；焦点可见（全局 `:focus-visible`）；弹窗 `role="dialog"` + `aria-modal`；toast 容器 `aria-live="polite"`；状态不能只靠颜色区分。

### 4.6 前端职责边界

- 前端只负责展示、交互反馈与 API 调用；**业务规则、权限判断、资料状态机、生成编排、AI/存储决策一律由后端执行**。
- 允许留在前端的逻辑仅限展示层：输入预检（后端必须再次校验）、弹窗开关、轮询定时器、主题、时间/大小格式化、上传进度展示。它们不得成为业务事实来源。
- 前端不得自行推断资源权限或任务终态；以接口返回为准。他人资源由后端返回 404，隐藏按钮不能替代后端鉴权。
- 业务状态不得长期只存在于 Pinia / localStorage；刷新或换设备后必须能从后端恢复。缓存只用于展示加速，登录/登出必须清理。
- OSS 直传仅是文件传输通道：临时凭证由后端签发，key 前缀、大小、归属等校验与登记必须由后端完成；前端不得持有长期云 AK。
- 长任务状态以 `job` / `material` 接口为准；页面刷新或重新进入时，必须重新查询后端状态，不能假设任务已结束或已取消。
- 流式消费：关闭页面、路由切换、断网时只关闭连接，不发送取消信号；重新进入后按任务 ID 重新订阅，或回退到轮询，并以后端持久化状态为准。

## 5. API 契约规范

- 字段命名以现有契约为准：绝大多数为 `snake_case`（`created_at`、`storage_key`、`job_id`）；OSS 上传凭证为既有 camelCase 例外（`accessKeyId` 等）。**不得单方面改名**。
- 创建类接口返回 **200**；删除返回 **204**；未认证 401；无权/不存在 404；冲突 409；自定义参数错误 400；FastAPI 校验错误 422。
- 业务错误体固定 `{"detail": "<中文文案>"}`，前端直接展示；FastAPI 自动校验错误 422 的 `detail` 为数组，由 `client.ts` 提取首条 `msg`。
- 列表接口直接返回 JSON 数组，不额外包 `{items: ...}`。
- 时间字段为 ISO 8601 字符串（后端 UTC 带时区），前端用 `lib/format.ts` 格式化。
- 新增/修改接口必须同步：`schemas.py` → 路由 → `types/index.ts` → `api/*.ts` → 受影响组件；必要时更新 README/AGENT 的 API 地图。
- 向后兼容优先：删除或重命名字段属于破坏性变更，必须在 commit 中标注 `BREAKING CHANGE` 并说明迁移方式。
- 流式接口必须可重连：以稳定的 `job_id` / 任务 ID 订阅；事件只是状态通知，最终结果以持久化状态或详情接口为准。

## 6. 文档义务

| 改动 | 必须更新 |
| --- | --- |
| 启动方式、目录、核心流程、API | `AGENT.md`（必要时 `README.md`） |
| 代码/提交/分支规范 | `RULE.md` |
| 颜色、排版、组件、动效、视觉方向 | `DESIGN.md` |
| 环境变量、OSS/STS 配置、部署限制 | `README.md` + `.env.example` |
| 新增依赖及版本约束 | `requirements.txt` / `package.json` + 相关说明 |

- 文档使用中文，命令必须可直接执行；不要写不存在的脚本或工具。
- 大段设计决策写入 `DESIGN.md`，不要散落在代码注释里；代码注释只解释「为什么」和隐蔽约束。

## 7. 验证要求

- 前端：改动后必须 `pnpm typecheck` 与 `pnpm test`；合并前跑 `pnpm build`。UI 改动需在浏览器验证：正常、空态、加载、失败、深色模式、窄屏。
- 后端：`pytest` 必须通过（`backend/tests`）；`docker compose up -d --build` 后 `/api/health` 为 ok，并实际请求受影响接口；后台任务类改动需观察 `job`/`material` 状态流转与日志。
- 测试栈为 2026-11-07 确认的最小范围（pytest / Vitest / Playwright），只覆盖 PageRef 核心链路；没有 CI。**不要声称「测试通过」**，除非确实执行了对应命令。新增测试框架仍属于独立任务，需先确认。
- PageContent 2.0 改动除后端/前端测试外，还必须跑 `builder npm test`、`validator npm test`、`node --test shared/page-shell/shell.test.mjs`；涉及 2.0 页面外观时用 `design_lab/build.mjs` + `validator/scripts/design-lab-shoot.mjs` 复核，规则见 `docs/pageref/PAGE_CONTENT_2.0.md`。
- 无法验证的改动必须在交付说明中明确写出（例如「未能在浏览器中验证 OSS 直传」）。
- 流式/长连接改动：必须验证关闭页面、刷新、断网后后端任务仍继续执行并落库；重新进入后可恢复状态；同时验证 0 个订阅者时任务仍能完成。

## 8. 禁止行为清单

- 直接向 `main` 提交或合并；对 `main` force push；未经指示 push / 创建 PR / 合并。
- 提交 `.env`、真实密钥、token、`backend/data/`、构建产物、个人 IDE 配置。
- 在功能 commit 中夹带全仓库格式化、无关重构、依赖大升级。
- 为通过检查而删除/跳过校验逻辑，或放宽类型/安全边界。
- 伪造验证结果、虚构测试命令、声称未执行的操作已完成。
- 把 LLM 输出直接 `v-html`、把长期云 AK 下发前端、把他人资源的存在性泄露给未授权用户。
- 把业务状态机、生成编排、权限判断放在前端，或以 Pinia/localStorage 作为任务终态来源。
- 用请求 / SSE / WebSocket 连接生命周期绑定长任务；客户端断开时取消任务、标记失败或丢弃结果。

## 9. 提交前检查表

- [ ] 分支从最新 `main` 切出，命名符合第 2.1 节；一个分支只做一件事；
- [ ] 每个 commit 都是可独立解释的原子任务，message 符合 Conventional Commits 中文格式；
- [ ] 暂存区没有密钥、环境文件、数据目录、构建产物、调试代码；
- [ ] 后端改动通过 `pytest` + 启动 + 实际接口验证；前端 `pnpm test`、`pnpm typecheck` 通过，UI 已验证；
- [ ] 契约三处一致（schemas / types / api），状态码与错误文案符合第 5 节；
- [ ] 前端没有承载业务规则/任务编排/权限判断，后端是唯一事实来源；
- [ ] 若涉及流式/长连接：已验证关闭页面或断开连接后任务继续执行并落库，重连/重进可恢复状态；
- [ ] 新增配置已进入 `Settings`、`.env.example` 与 README；
- [ ] 视觉改动只使用语义 token，并通过深色模式检查，已同步 `DESIGN.md`；
- [ ] 相关文档（AGENT / RULE / DESIGN / README）已更新；
- [ ] 未推送、未合并；等待人类维护者审阅并明确同意后再合并到 `main`。
