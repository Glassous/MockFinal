# RULE.md · MockFinal 仓库规范

> 本文件规定**代码规范、接口契约、文档义务与 Git 协作纪律**。Agent 与人类开发者都必须遵守；
> 提交前逐条对照第 9 节检查表。视觉规则见 `DESIGN.md`，项目结构与流程见 `AGENT.md`。

## 1. 基本原则

1. **小步、原子、可回滚**：一次只解决一个问题；每个 commit 都能独立解释、独立回退。
2. **契约优先**：`functions/lib/serializers.ts`、`frontend/src/types/index.ts`、`api/*.ts`
   字段名逐字一致；破坏契约的改动必须在同一个原子任务里同步三处。
3. **默认安全**：不泄露密钥、不信任用户输入与 LLM 输出、所有资源校验归属。
4. **优雅降级**：LLM 未配置时返回可操作的中文提示；资料索引不依赖外部服务。
5. **不引入无必要的复杂度**：能用一个函数解决的不建抽象。新增依赖、迁移工具、消息队列
   必须先与人类维护者确认。
6. **中文面向用户，英文面向代码**：UI 文案、错误信息、注释、文档使用中文；变量、函数、
   类型、表名、API 字段使用英文。
7. **后端是唯一事实来源**：权限、状态机、最终校验、任务编排、AI 与存储决策全部在函数内执行；
   前端只保留展示所需的交互状态与轻量输入预检。
8. **长任务生命周期独立于页面**：生成与 Deck 构建由 `advance` 接口驱动，cursor、阶段与租约
   必须持久化；刷新、断网、路由切换后能从后端状态继续，不得只存在于内存。

### 1.1 Serverless 附加规范（`functions/`）

1. **单函数**：只允许一个 `app` Edge Function；新增接口在 `functions/routes/` 注册，不新建入口。
2. **零第三方依赖**：只用 WebCrypto、`fetch`、平台注入的 `_qoder/*`；不得使用 `npm:` 或
   第三方包，避免 `prepare_site` 打包失败。密码/JWT/分节/JSON 解析均自写。
3. **无事务假设**：多表写入按顺序执行、单语句落库、失败即停；删除按子表→父表手工级联；
   所有写入必须可重放（固定 Storage key + 条件更新 + 计数器重算）。
4. **ID 应用侧生成**：主键一律 `lib/ids.ts` 的 bigint（< 2^53）；不使用 serial/identity。
5. **存储路径服务端派生**：对象 key 必须是 `materials/{userId}/{workspaceId}/...`、
   `decks/{deckId}/...`、`jobs/{userId}/{jobId}/...`；禁止信任前端路径；签名 URL 不得写入
   日志、错误信息或前端持久化。
6. **契约一致**：错误 `{detail:string}`、422 `{detail:[{loc,msg,type}]}`、删除 204 无体、
   他人资源 404。
7. **秘密只走 Secrets**：`JWT_SECRET`、`LLM_*` 由 Sites Secrets 注入；不得硬编码或提交。
8. **构建验证**：改动函数后必须跑 `npx tsc --noEmit -p ../functions/tsconfig.json` 与
   `node --test "functions/tests/*.test.ts"`；不引入浏览器 E2E/视觉回归。
9. **平台模块不可本地加载**：`lib/db.ts` / `lib/storage.ts` 依赖 `_qoder/*`。纯逻辑必须拆到
   独立模块；单测不得静态 import 这两个文件，必要时使用动态 import。

## 2. Git 分支与提交规范

### 2.1 分支模型

- `main` 是唯一主分支，必须始终可运行、可交付。
- **功能开发必须在功能分支中进行**，禁止直接向 `main` 提交（包括文档与紧急修复）。
- 功能分支命名为 `feat/<名称>`（Git ref 不允许 `:` 和 `[`）。其他类型：

| 任务类型 | 分支名 | 示例 |
| --- | --- | --- |
| 新功能 | `feat/<名称>` | `feat/question-bank` |
| Bug 修复 | `fix/<名称>` | `fix/upload-progress` |
| 重构（行为不变） | `refactor/<名称>` | `refactor/generation-pipeline` |
| 纯文档 | `docs/<名称>` | `docs/agent-guides` |
| 依赖/工具/构建 | `chore/<名称>` | `chore/bump-deps` |
| 视觉改版 | `design/<名称>` | `design/editorial-v2` |

- 分支从最新 `main` 切出；开发期间及时同步 `main`，评审前解决全部冲突。
- 一个分支只承载一个内聚目标。
- **任何分支合并进 `main` 前必须由人类维护者审阅并明确同意。** Agent 不得自行合并。

### 2.2 原子任务与 commit 粒度

- **一个原子任务 = 一个 commit**：可独立描述、独立验证、独立回退，完成后仓库仍可构建。
- 允许功能分支上的 WIP commit；评审前整理为干净历史。
- 代码、契约、必要文档、锁文件必须一起提交。
- 禁止在功能 commit 中夹带全仓库格式化、无关重命名、依赖大升级。
- 提交前审查暂存区，**不要盲目 `git add -A`**；确认没有 `.env`、密钥、`dist/`、
  `node_modules/`、调试代码或临时文件。

### 2.3 Commit message（Conventional Commits）

```text
<type>(<scope>): <中文摘要>

<可选正文：为什么这样改、影响范围、取舍>
<可选脚注：BREAKING CHANGE / 关联 issue>
```

- `type`：`feat`、`fix`、`refactor`、`docs`、`style`、`test`、`perf`、`build`、`ci`、`chore`。
- `scope` 推荐：`functions`、`frontend`、`db`、`docs`、`infra`，或具体模块名。
- 摘要中文、祈使/陈述语气，≤ 50 字符，结尾不加句号；正文说明**为什么**，不复述 diff。
- 破坏性变更在 type 后加 `!` 并写 `BREAKING CHANGE: ...`。

### 2.4 合并与保护

- 默认 merge commit 保留原子提交；是否 squash 由人类评审者决定。
- 禁止对 `main` force push；禁止强推已共享分支；禁止改写他人历史。
- 合并前必须满足：人工批准、验证命令通过、受影响的运行路径已实际验证、无冲突。
- **Agent 不得擅自 `git push`、创建/关闭 PR、合并分支或修改远端设置**，除非用户明确指示。

## 3. 函数代码规范（TypeScript / Deno）

### 3.1 风格与组织

- TypeScript strict；2 空格缩进；单引号；不加分号。
- 命名：变量/函数 `camelCase`；类型/接口 `PascalCase`；常量 `UPPER_SNAKE_CASE`；表名/字段 `snake_case`。
- 导出函数写返回类型；不用 `any`；外部数据用 `unknown` + 收窄（`lib/db.ts` 的 `Row` 等）。
- 导入使用相对路径并带 `.ts` 后缀（Deno 要求）；仅类型导入使用 `import type`。

### 3.2 分层职责

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| `router.ts` | 路径归一化、方法分派 | 业务逻辑 |
| `routes/` | HTTP 参数/状态码、鉴权、调用 lib、序列化 | 复杂纯算法（放 `lib/`） |
| `lib/` | 业务编排、LLM、存储、分块、规划、渲染 | 依赖 `Request`/`Response` 处理纯逻辑 |
| `lib/page-kit/` | PageContent 校验与 HTML 渲染 | 引入浏览器 API 或第三方包 |
| `serializers.ts` | 请求/响应契约 | 数据库访问 |

- 资源归属校验统一走 `getOwnedWorkspace` / `getOwnedDeck` / `ownedPage` 等；**他人资源一律 404**。
- 新增路由必须在 `router.ts` 注册；路径风格保持一致（`/workspaces/:id/materials`）。

### 3.3 数据与存储

- 所有查询经 `lib/db.ts`；不手写连接串，不假设事务。
- 平台 DB 子集限制：只用 `.eq()` 过滤、`.order()`、`.limit()`；不使用 join、`.in()`、数组列或 CHECK。
- 迁移只允许 `app.*`；加列必须可空、无默认值；索引只用普通 B-tree。
- 长耗时 LLM 调用之外不要持有内存大对象；大产物写 Storage，cursor 只存指针/计数。
- 存储读写的 key 由服务端拼接；上传前校验字节上限（页面 bundle ≤2 MiB）。

### 3.4 错误处理

- 面向用户的错误：`HttpError(status, '中文可读文案')`；不返回英文堆栈、provider 原始错误、
  JWT、Secret、签名 URL。
- 外部错误映射：429/502 向上抛出交给前端退避；其余错误在 `advance` 内 `failJob` 落中文原因。
- LLM 输出不可信：结构化输出必须经 `lib/json.ts` 与 `chatJson` 校验；页面内容必须经
  `page-kit` 校验；Markdown 由前端清洗。
- 事件写入失败不影响主流程（`addEvent` 内部吞错）。

### 3.5 配置与依赖

- 配置集中 `lib/config.ts`；业务代码不直接读 `Deno.env`。
- 新增 Secret 必须同步 README Secrets 表与 Qoder Sites 配置说明。
- 不新增第三方依赖；确有需要先与人类维护者确认。

### 3.6 安全

- `JWT_SECRET` 仅来自 Secrets；开发占位值不得用于生产。
- 密码 PBKDF2；密保答案 `trim + lower` 后哈希；重置密码递增 `token_version`。
- Storage 私有；下载走 302 签名地址；签名 URL 不进日志。
- 提示词用随机边界包裹资料，明确资料是数据而非指令。
- 页面 bundle 在 iframe 中运行，`sandbox` 只能是 `allow-scripts`。

## 4. 前端代码规范（Vue 3 / TypeScript / Tailwind）

### 4.1 文件与命名

- SFC 顺序：`<script setup lang="ts">` → `<template>` → `<style scoped>`（仅必要时）。
- 组件 `PascalCase.vue`；页面 `*View.vue`；布局 `*Layout.vue`；基础组件 `App` 前缀。
- 类型统一放 `src/types/index.ts`，与函数契约逐字对齐。
- 导入使用 `@/` 别名；仅类型导入使用 `import type`。

### 4.2 TypeScript

- `strict` + `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`。
- **禁止 `any`**；不明类型用 `unknown` + 收窄。不要放宽 `tsconfig` 或使用 `@ts-ignore`。
- 导出 API 函数写返回类型；props/emits 使用 `defineProps<...>()` / `defineEmits<...>()`。
- 非空断言只在不变式明确时使用。

### 4.3 代码风格

- 2 空格缩进；单引号；语句不加分号；多行结构保留尾逗号；模板属性每行一个。
- 未配置 ESLint/Prettier；若引入必须单独 `chore` 分支一次性全量格式化。
- 禁止 `console.log` / `debugger`；错误通过 toast、表单内联提示或全局 401 处理。

### 4.4 网络与状态

- 所有 HTTP 请求集中在 `src/api/`，统一走 `client.ts` 的 `request` / `requestBlob`
  （Bearer、`{detail}` 解析、401 清 token 并跳登录）。
- 组件内禁止直接 `fetch`；上传使用 `api/materials.ts` 的 XHR 封装与 `lib/upload.ts`。
- 错误处理统一：`error instanceof ApiError ? error.detail : '兜底中文文案'`。
- Pinia setup store；登录/登出必须 `workspaceStore.reset()`。
- 推进循环（`advance`）与上传中止必须在 `onBeforeUnmount` 清理定时器与 AbortController；
  429/502 退避 1.2s/3s，其余错误 2s 兜底。
- 路由守卫使用 vue-router 5 返回值写法；不要写 `next()`。

### 4.5 样式与视觉

- **唯一样式来源**：`src/style.css` 的语义 token；组件只用 `bg-panel`、`text-ink`、
  `border-border` 等语义类。
- 禁止裸色值/裸阴影（透明度遮罩 `#000` 除外）；新增变量先加到 `style.css` 并同步 `DESIGN.md`。
- 深浅色由 token 自动切换；新组件必须检查两套主题。
- 图标使用 `lucide-vue-next`；纯图标按钮必须有 `aria-label` 与 `title`。
- 可访问性底线：表单 `label` 绑定输入；焦点可见；弹窗 `role="dialog"` + `aria-modal`；
  toast 容器 `aria-live="polite"`；状态不只靠颜色区分。

### 4.6 前端职责边界

- 前端只负责展示、交互反馈与 API 调用；业务规则、权限、状态机、AI/存储决策由函数执行。
- 不自行推断资源权限或任务终态；以接口返回为准。
- 业务状态不得只存在于 Pinia / localStorage；刷新后必须能从后端恢复。
- 长任务状态以 job / deck 接口为准；页面刷新或重新进入时必须重新查询。
- 关闭页面、路由切换、断网只关闭连接，不发送取消信号。

## 5. API 契约规范

- 字段命名以现有契约为准：绝大多数为 `snake_case`；**不得单方面改名**。
- 创建类接口返回 **200**；删除 **204**；未认证 401；无权/不存在 404；冲突 409；
  自定义参数错误 400；字段校验错误 422（`detail` 为数组，前端提取首条 `msg`）。
- 业务错误体固定 `{"detail": "<中文文案>"}`。
- 列表接口直接返回 JSON 数组，不包 `{items: ...}`。
- 时间字段为 ISO 8601 UTC；前端用 `lib/format.ts` 格式化。
- 新增/修改接口必须同步：`routes/*.ts` → `serializers.ts` → `types/index.ts` → `api/*.ts`
  → 受影响组件；必要时更新 README/AGENT 的 API 地图。
- 推进类接口（`advance`）必须可从 cursor 续跑；重放不得重复扣费式产生重复产物。
- 页面 bundle 契约：`{schema_version:'1.1', runtime_version:'1.1.0', manifest, html, css, js}`。

## 6. 文档义务

| 改动 | 必须更新 |
| --- | --- |
| 启动方式、目录、核心流程、API | `AGENT.md`（必要时 `README.md`） |
| 代码/提交/分支规范 | `RULE.md` |
| 颜色、排版、组件、动效、视觉方向 | `DESIGN.md` |
| Secrets、部署限制、平台常量 | `README.md` + `docs/serverless/*` |
| 生成/构建阶段、预算、Storage key | `docs/serverless/GENERATION_PIPELINE.md` |

- 文档使用中文，命令必须可直接执行；不要写不存在的脚本或工具。
- 代码注释只解释「为什么」和隐蔽约束。

## 7. 验证要求

- 前端：`pnpm test && pnpm typecheck && pnpm build`；UI 改动需在浏览器验证主路径与边界状态
  （空态、加载、失败、深色模式、窄屏）。
- 函数：`npx tsc --noEmit -p ../functions/tsconfig.json`；
  `node --test "functions/tests/*.test.ts"`。
- 线上：`SITES_BASE_URL=https://<site> node scripts/smoke-sites.mjs` 覆盖注册、上传、生成、
  Deck 构建、bundle、问答、取消与单页重做；需已配置 LLM Secrets。
- **不要声称「测试通过」**，除非确实执行了对应命令。无法验证的部分必须在交付说明中写明。
- 新增测试框架属于独立任务，需先确认。

## 8. 禁止行为清单

- 直接向 `main` 提交或合并；对 `main` force push；未经指示 push / 创建 PR / 合并。
- 提交 `.env`、真实密钥、token、构建产物、个人 IDE 配置。
- 在功能 commit 中夹带全仓库格式化、无关重构、依赖大升级。
- 为通过检查而删除/跳过校验逻辑，或放宽类型/安全边界。
- 伪造验证结果、虚构测试命令、声称未执行的操作已完成。
- 把 LLM 输出直接 `v-html`、把 Secret 下发前端、把他人资源的存在性泄露给未授权用户。
- 把业务状态机、生成编排、权限判断放在前端，或以 Pinia/localStorage 作为任务终态来源。
- 用页面生命周期绑定长任务；关闭页面时取消任务或丢弃结果。
- 在函数中静态 import 平台模块却让无平台环境的单测直接加载。
- 提交签名 URL、provider 原始错误、JWT 或 Secret 到日志与错误体。

## 9. 提交前检查表

- [ ] 分支从最新 `main` 切出，命名符合第 2.1 节；一个分支只做一件事；
- [ ] 每个 commit 都是可独立解释的原子任务，message 符合 Conventional Commits 中文格式；
- [ ] 暂存区没有密钥、环境文件、数据目录、构建产物、调试代码；
- [ ] 前端 `pnpm test` / `pnpm typecheck` / `pnpm build` 通过，UI 已验证；
- [ ] 函数类型检查与纯函数单测通过；
- [ ] 契约三处一致（serializers / types / api），状态码与错误文案符合第 5 节；
- [ ] 前端没有承载业务规则/任务编排/权限判断；
- [ ] 任务推进只依赖持久化 cursor/lease，刷新与断网可续跑；
- [ ] 新增 Secret/配置已进入 README 与 `lib/config.ts`；
- [ ] 视觉改动只使用语义 token，并检查深色模式；
- [ ] 相关文档（AGENT / RULE / DESIGN / README / docs/serverless）已更新；
- [ ] 未推送、未合并；等待人类维护者审阅并明确同意后再合并。
