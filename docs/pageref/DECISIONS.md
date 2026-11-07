# DECISIONS.md · PageRef 决策记录

> 基线日期：2026-11-07。本文件归档 `../../Plan.md` §17 的 Q1–Q8 结论，并补充 P0 阶段的技术版本锁定与升级策略。
> 方案来源唯一：`../../Plan.md`。本文件只做归档与执行约束，不引入与 Plan 冲突的新方案；两者不一致时以 `../../Plan.md` 为准，并在同一任务中回写本文件。
> 需要变更已确认决策时，必须先由人类维护者同意，更新 Plan §17，再更新本文件；不得在代码或提示词中夹带未归档的替代方案。

## 1. 已确认决策（Q1–Q8）

| # | 问题 | 结论 | Plan 落地位置 |
| --- | --- | --- | --- |
| Q1 | 模拟考试是否保留 | **保留**。继续使用旧生成与展示，改造为 sections 驱动；本期不做页面化重做 | §2.1 / §3.2 / §16.3 |
| Q2 | Deck 是否允许彩色主题 | **否**。保持单色纸感 + 动效；风格差异靠排版、网格、密度、交互隐喻 | §3.6 / §9.6 |
| Q3 | 移动端零滚动承诺 | **桌面（≥1024 宽）零滚动；移动端滚动阅读**。不承诺移动端单屏 | §3.8 / §7.5 |
| Q4 | 是否引入测试框架 | **是**。最小 pytest + Vitest + Playwright，只覆盖 PageRef 核心链路 | §13.1 |
| Q5 | 默认 Pi 模型 | **环境可配**，优先工具调用稳定的 Coder 模型；启动时做工具调用探测 | §6.5 / §8.8 |
| Q6 | 页数/成本上限 | **6–16 页；构建并发 2；单页 8 分钟超时**；可按环境调整 | §8.4 / §12.3 |
| Q7 | 大纲是否需人工确认 | **否**。自动进入构建；仅在没有页面或整册失败时允许“重新规划”，已有页面时建议新建 Deck | §3.1 / §8.4 |
| Q8 | 页面是否允许外链资源 | **否**。页面完全自包含，CSP 与 Validator 双重拦截 | §7.1 / §11.1 |

### 1.1 对实现的直接约束

- Q1：PageRef 不重做模拟考试；旧 `exam` 工件与接口在迁移期保留，删除需单独 `BREAKING CHANGE`。
- Q2：页面 CSS 只使用 `--mp-*` 语义变量与单色系；禁止彩色渐变、光晕、玻璃拟态、彩色主题预设。
- Q3：Validator 的零滚动硬门禁只覆盖 1280×720、1440×900、1920×1080；1024×768 为缩放提示场景；小于 768 宽允许纵向滚动。
- Q4：测试栈按独立 `chore` 提交落地；在测试栈落地前，不得声称相关测试已通过。本 P0 任务不添加测试代码。
- Q5：模型名只能通过环境变量 `PAGE_BUILDER_MODEL` 注入；仓库与镜像内不写死真实模型或密钥；启动探测失败时 Builder 启动失败，主 API 健康检查标记 `page_builder: unavailable`。
- Q6：默认上限写入 `Settings`：`DECK_MIN_PAGES=6`、`DECK_MAX_PAGES=16`、`PAGE_BUILDER_CONCURRENCY=2`、`PAGE_BUILDER_TIMEOUT_SECONDS=480`。变更需记录原因。
- Q7：构建流程不设置人工大纲确认节点；重新规划只允许在“无页面”或“整册失败”时触发。
- Q8：页面不得加载任何外部资源；CSP `connect-src 'none'`、`img-src data:`、`frame-src 'none'`；Validator 阻断全部非本地请求。

## 2. 技术锁定

| 项 | 锁定值 | 依据 | 执行要求 |
| --- | --- | --- | --- |
| Pi Agent | `@earendil-works/pi-coding-agent` 精确 `1.5.0`（MIT） | Plan §6.1、§6.3、§14.3 P0 | `builder/package.json` 使用精确版本，不加 `^`/`~`；不使用浮动标签 |
| Node.js | 24 LTS | Plan §6.2、§14.3 P0 | `builder/package.json` 与 `validator/package.json` 声明 `"engines": { "node": ">=24" }`；Builder 镜像使用 `node:24-slim` |
| Pi 运行时要求 | Pi 1.5.0 要求 Node ≥ 22.19 | Plan §6.1 | Node 24 满足该要求；不得回退到低于 22.19 的版本 |
| Bundle 结构版本 | `schema_version = "1.0"` | Plan §7.1、§7.8 | 修改结构必须提升版本并同步 `PAGE_CONTRACT.md` |
| 运行时版本 | `runtime_version = "1.0.0"` | Plan §7.3、§7.8 | 前端 shell 与 Validator 共用同一 runtime 与版本号 |
| Harness 版本 | `harness_version = "0.1.0"`（P2 v0 起点） | Plan §7.8 | 与 schema/runtime 独立演进；升级跑黄金回归 |
| 页面大小上限 | 2 MiB（`2097152` 字节） | Plan §7.1、§8.8 | 超限直接失败，不截断 |
| 页面超时 | 单页 480 秒（8 分钟） | Plan §6.4、Q6 | Builder 硬超时；修复最多 2 轮 |
| 构建并发 | 2 | Plan §8.4、Q6 | 可按环境调整，需记录 |
| 页数范围 | 6–16 页 | Plan §8.4、Q6 | 由后端 `Settings` 控制 |
| 验收视口 | 1280×720、1440×900、1920×1080 | Plan §6.8、§7.6 | 三个视口零滚动为硬门禁；1024×768 为提示场景 |
| 沙箱 | `sandbox="allow-scripts"`，无 `allow-same-origin` | Plan §7.4、§11.1 | 不得放宽；Validator 与前端一致 |
| 网络 | 页面 `connect-src 'none'`；Validator 阻断外网 | Plan §7.4、§7.6、Q8 | 出现外部请求即失败 |
| 安全材料 | 页面完全自包含；无外链、无字体外链 | Plan §7.1、Q8 | 图片/图标内联 SVG 或 `data:` URI |
| Playwright | `@playwright/test` 使用 `^` 约束；镜像使用官方 Playwright 镜像 | Plan §6.6、§13.1 | 版本在 P2 与镜像标签对齐；不使用非官方来源 |
| TypeScript | devDependency，使用 `^` 约束 | RULE §4.2 | 仅用于 Builder/Validator 源码；不进入运行时产物 |

说明：

- P0 不执行 `npm install`，不生成锁文件。P2 首次安装后必须提交 `package-lock.json`，并以锁文件作为可复现构建依据。
- Pi 版本、Node 主版本、Playwright 镜像标签属于基础设施契约，升级必须走独立任务（见第 4 节）。
- 模型与网关不属于仓库锁定内容：`LLM_BASE_URL`、`LLM_API_KEY`、`PAGE_BUILDER_MODEL` 只通过环境变量注入，值按部署环境填写。

## 3. 环境变量基线（来自 Plan 附录 A）

### 3.1 主后端新增

```text
PAGE_BUILDER_URL=http://page-builder:9100
PAGE_BUILDER_TOKEN=change-me
PAGE_BUILDER_MODEL=qwen3-coder-plus
PAGE_BUILDER_TIMEOUT_SECONDS=480
PAGE_BUILDER_CONCURRENCY=2
PAGE_VALIDATOR_URL=http://page-validator:9200
PAGE_VALIDATOR_TOKEN=change-me
DECK_MAX_PAGES=16
DECK_MIN_PAGES=6
DECK_PAGE_MAX_ATTEMPTS=2
DECK_JOB_TIMEOUT_SECONDS=1800
DECK_MAX_MATERIAL_CHARS=200000
DECK_MAX_BUNDLE_BYTES=2097152
```

### 3.2 Builder 容器

```text
LLM_BASE_URL=
LLM_API_KEY=
PAGE_BUILDER_MODEL=
PAGE_VALIDATOR_URL=http://page-validator:9200
PAGE_VALIDATOR_TOKEN=change-me
BUILDER_TOKEN=change-me
PI_CODING_AGENT_DIR=/opt/mockfinal-pi/agent
```

### 3.3 Validator 容器

```text
VALIDATOR_TOKEN=change-me
```

- 所有 token 与密钥只放环境变量；不写入镜像、不写入日志、不下发前端。
- `change-me` 只是文档占位值；实际部署必须在根 `.env` 覆盖，`docker-compose.pageref.yml` 使用必填变量语法拒绝空值。

## 4. 升级策略

### 4.1 总原则

1. **锁定版本，不跟随浮动标签**：Pi 使用精确版本；Node 使用主版本标签；Playwright 镜像使用固定标签。
2. **升级是独立任务**：Pi、Node、Playwright、TypeScript、模型网关协议变化均单独开 `chore/*` 或 `build/*` 任务，不夹带在功能提交中（RULE §3.5、§2.2）。
3. **先回归，后合并**：升级任务必须跑黄金用例，产出与基线可比的记录；未跑回归不得合并。
4. **失败可回退**：升级前记录当前锁定值与基线指标；失败时回退版本并保留记录。
5. **Harness 变更同样算升级**：修改 `SKILL.md`、`references/`、`prompts/`、Extension、模板或默认模型，都必须提升 `harness_version` 并跑黄金回归。

### 4.2 回归范围

| 阶段 | 回归集合 | 记录项 |
| --- | --- | --- |
| P2 PoC | `builder/fixtures/golden/` 的 3 个页面（二分、矩阵、时间线） | 首轮通过率、修复 1 轮后通过率、零滚动、交互冒烟、外部请求、控制台错误、构建耗时、token |
| P2 之后 | Plan §13.2 的 10 个固定 brief | 同上，另加人工 1–5 分视觉评分 |
| 安全升级 | 3 个黄金页 + 红队用例 | `docs/pageref/POC_ACCEPTANCE.md` 的红队清单必须全部保持拦截 |

### 4.3 判定

- 升级后必须满足：首轮 ≥ 2/3、修复 1 轮后 3/3、零滚动 3/3、交互冒烟 3/3、外部请求与静态安全违规为 0、单页 p90 ≤ 6 分钟（本地网关条件下可放宽但需记录）。
- 任一项低于基线或低于门槛，升级任务判失败，回退版本。
- 记录写入 `docs/pageref/POC_ACCEPTANCE.md` 或后续评估报告，不得只留在会话中。

## 5. 未决事项

以下事项不属于已确认决策，P0 不擅自定稿：

| 编号 | 事项 | 当前状态 | 责任阶段 |
| --- | --- | --- | --- |
| O-1 | KaTeX 公式渲染方式（shell 注入或 bundle 自包含） | 契约 v0.1 保留为待冻结项 | P2 |
| O-2 | Manifest 字段长度上限 | 未定 | P2 Validator 实现 |
| O-3 | 1024×768 零滚动失败级别 | 暂定 warning | P2 |
| O-4 | `harness_version` 落地形式 | 只约定独立版本号 | P2 |
| O-5 | Validator 官方镜像内 Node 版本是否满足 24 | 待验证 | P2 镜像构建 |
| O-6 | 测试栈具体版本与脚本 | Q4 已确认引入，但 P0 不安装 | 独立 `chore` 任务 |

## 6. 决策变更流程

1. 提出变更：说明动机、影响范围、回滚方式，并附黄金回归计划。
2. 人类维护者确认后，先更新 `../../Plan.md` §17 或对应章节。
3. 同步更新本文件、`PAGE_CONTRACT.md`、（如涉及）`AGENT.md` / `RULE.md` / `DESIGN.md`。
4. 涉及版本号变更时，按 `PAGE_CONTRACT.md` 第 12 节提升对应版本。
5. 变更与实现放在同一个原子任务中；不得先改代码后补决策。
