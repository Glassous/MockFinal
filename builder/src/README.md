# src · 实现说明与 Pi SDK 适配差异

> 状态：P2 已实现（2026-11-07）。本文件记录实现要点与锁定版本 `@earendil-works/pi-coding-agent@1.5.0` 的真实 API 差异。

## 1. 文件职责

| 文件 | 职责 |
| --- | --- |
| `server.ts` | 内部 HTTP 9100、HMAC 验签、任务队列（并发 2）、幂等/409、取消、超时、健康检查 |
| `session.ts` | Pi 会话创建、Harness 资源加载、事件映射、check_page/report_progress 实现、修复闭环、MOCK 模式 |
| `task-store.ts` | 进程内任务表（`TaskStore` 接口，可换持久化实现） |
| `validator-client.ts` | `POST /v1/validate`（Bearer），超时/网络错误一律 fail-closed |
| `bundle.ts` | 4 文件收集、路径/大小/扩展名/禁止序列/Manifest 检查、组装 PageBundle |
| `events.ts` | seq 递增、单事件 4KB 截断、200 条上限与折叠摘要 |
| `paths.ts` | resolveWithin / 符号链接逐段检查 / 扩展名 / 体积限制 |
| `hmac.ts` | `HMAC-SHA256(token, "{timestamp}.{METHOD}.{path}.{rawBody}")`、±300s、常量时间比较、body 指纹 |
| `config.ts` | 环境变量解析与默认值（构建根目录默认 `os.tmpdir()/mockfinal-builds`） |
| `types.ts` | 共享类型；`GUARD_CONTEXT_SYMBOL` 为 Builder 与扩展的进程内契约 |

## 2. 与 P0 草案/Plan 的差异（以 1.5.0 类型声明为准）

1. **settings.json 字段名**：真实 schema 用 `extensions` / `skills` / `prompts` / `defaultTools`，没有 `extensionDirs` / `tools` / `defaultModel`。Builder 不依赖该文件的字段，而是在内存 `SettingsManager` 中显式给出路径，并用 `DefaultResourceLoader.additional*Paths` 加载。
2. **工具白名单**：`createAgentSession({ tools })` 是 allowlist；`excludeTools` 再排除 `bash/powershell/grep/find/ls/codemode`。创建后断言 `getActiveToolNames()` 不含禁用工具，Guard 扩展在 `tool_call` 再做一次拦截。
3. **before_agent_start**：`event.systemPrompt` 只读，通过返回 `{ systemPrompt: 原文 + 契约提醒 }` 追加提醒（每次 run 生效）。
4. **agent_settled** 才是「不会再有自动重试/压缩」的稳定信号；`agent_end` 只表示一次底层 run 结束。事件映射两者都用：`agent_settled` → `page_done`。
5. **扩展加载**：目录形式 `extensions/mockfinal-guard/index.ts` 由 jiti 直接执行，无需编译；`typebox` 由 Pi 的虚拟模块映射，扩展只做 type-only import。
6. **宿主技能泄漏**：`DefaultResourceLoader` 即使覆盖 `agentDir` 仍会加载 `~/.agents/skills`。Builder 用 `skillsOverride` 过滤为只保留 Harness 目录内的技能（本次验证结果为仅 `mockfinal-page-builder`）。
7. **自定义 Provider**：用 `ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })` + `registerProvider()` 注册 OpenAI 兼容网关（`openai-completions`），不读写宿主 `models.json` / `auth.json`；密钥只来自 `LLM_API_KEY` 环境变量。
8. **Usage**：`session.getSessionStats().tokens` 提供 input/output token；失败路径记录直到失败时刻的用量。
9. **Codemode/MCP/ToolSearch 不加载**：SDK 默认不加载这些内置扩展，Builder 也未注册。

## 3. 未验证项

- 真实 LLM 网关的端到端生成（本环境没有 LLM 凭据）：`session.prompt()` 之后的事件映射、修复闭环与真实产物质量都未验证。
- Guard 扩展的 `tool_call` 拦截在真实模型调用中的行为（已通过会话工具清单与单元测试间接覆盖，未做真实越权调用回放）。
- Validator 容器已实现（P2）；本目录测试使用本地假 Validator 验证协议，真实容器协议由 P4 集成/协议检查覆盖。
