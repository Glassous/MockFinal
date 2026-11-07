# settings.json 说明

> 本文件解释 `settings.json` 的意图。JSON 不允许写注释，因此说明放在这里。
> 状态：P0 骨架，描述的是 **P2 实施目标**。字段名与取值以 Pi 1.5.0 的官方 settings schema 为准，P2 实现时必须逐项核对并回写本说明。

## 1. 当前内容

```json
{
  "tools": ["read", "write", "edit", "check_page", "report_progress"],
  "defaultModel": null,
  "extensionDirs": ["../extensions/mockfinal-guard"]
}
```

| 字段 | 意图 |
| --- | --- |
| `tools` | 工具白名单。只允许读取、写文件、编辑、页面自检与进度上报；**不包含 `bash`**，这是「无 bash」的第一道约束 |
| `defaultModel` | 留空，由环境变量 `PAGE_BUILDER_MODEL` 注入；不在镜像中写死模型 |
| `extensionDirs` | `mockfinal-guard` 扩展目录（P2 创建），用于 `tool_call` 白名单复核、路径守卫与 `agent_end` 记录 |

## 2. 关键约束

- 白名单是唯一启用方式；未列出的工具（包括 `bash`、任何 shell、任何网络工具）不得通过其他配置重新启用。
- Extension 必须在 `tool_call` 中再次拦截未注册工具，不能只依赖 settings；两层同时生效。
- `read` 只允许 build cwd 与只读 Harness 资源目录；`write` / `edit` 只允许 build cwd，且解析后不得越界、不得经过符号链接。
- 不读取宿主 `~/.pi/agent` 的个人配置；`PI_CODING_AGENT_DIR` 指向镜像内只读 Harness 目录。
- 模型凭据只通过环境变量注入，不写入 settings、不写入镜像、不写日志。

## 3. P2 待办

1. 对照锁定的 Pi 1.5.0 类型声明与文档，确认 `tools`、`defaultModel`、`extensionDirs` 的真实字段名与格式；不一致时修正 `settings.json` 并更新本文件。
2. 确认 `check_page`、`report_progress` 作为自定义工具时的注册方式（Extension `registerTool()`）。
3. 确认工具名大小写、是否支持工具级别参数限制。
4. 增加启动时断言：白名单中不得出现 `bash`，Extension 加载失败时 Builder 启动失败。
5. 在黄金用例回归中验证：模型无法调用未注册工具，路径越界请求被拒绝。
