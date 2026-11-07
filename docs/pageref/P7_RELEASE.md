# P7_RELEASE.md · 迁移、发布与回滚手册

> 适用范围：`feat/pageref` 分支 P0–P7 交付（2026-11-07）。本手册用于内部验收环境；合并 `main` 必须由人类维护者明确同意，Agent 不自行 push/merge。

## 1. 发布前检查（P7 门禁）

| 检查 | 命令 / 方式 | 通过标准 |
| --- | --- | --- |
| 后端默认测试 | `pytest`（测试容器） | 全部通过 |
| Deck 隔离库集成 | `P4_INTEGRATION=1 DATABASE_URL=...mockfinal_p4_test pytest tests/test_decks_api.py` | 6 passed（含 12 页断线恢复、启动自愈） |
| 前端类型/单测/构建 | `cd frontend && pnpm typecheck && pnpm test && pnpm build` | 全部通过 |
| Validator | `cd validator && npm run build && npm test` | 全部通过 |
| Builder | `cd builder && npm test` | 全部通过 |
| 红队 | 启动 Validator 后 `VALIDATOR_TOKEN=... node scripts/red-team.mjs` | 16/16 拦截 |
| P5 回归 | `node validator/scripts/p5-acceptance.mjs`（演示数据） | 34/34 |
| P6 回归 | 假 LLM + `node validator/scripts/p6-acceptance.mjs` | 24/24 |
| 真实 Pi 门禁 / 多页 E2E | `builder npm run gate:run` + 真实 LLM 构建 | **P2 3/3；P4 14 页 14/14 ready、0 issues、911s；成本 ¥0.14 + ¥1.69（¥10 预算内）** |
| 工作区 | `git status` | 无 `.env`、密钥、`backend/data/`、构建产物；未 commit/push |

> 演示浏览器验收使用黄金 bundle/假 LLM；真实 Pi 门禁与多页 E2E 已用 DeepSeek `deepseek-flash` 通过，证据见 `P2_RESULTS.json`、`P4_REAL_E2E.json` 与截图目录。维护者仍需完成人工视觉/发布签收。

## 2. 环境变量

新增/确认（完整表见 `README.md` 与 `backend/.env.example`）：

```text
# LLM（生成 + 页面助手）
LLM_BASE_URL=          # 非 OpenAI 官方网关必须显式填写；为空会告警并使用 api.openai.com
LLM_API_KEY=
LLM_MODEL=qwen-plus
PAGE_CHAT_MAX_TOKENS=900

# 页面构建/校验（内部网络，不暴露公网）
PAGE_BUILDER_URL=
PAGE_BUILDER_TOKEN=
PAGE_VALIDATOR_URL=
PAGE_VALIDATOR_TOKEN=
```

`PAGE_BUILDER_TOKEN` 与 Builder 的 `BUILDER_TOKEN` 必须一致；`PAGE_VALIDATOR_TOKEN` 与 Validator 的 `VALIDATOR_TOKEN` 必须一致。缺失时 Deck 构建/重建返回 503 或页面失败（fail-closed），不会跳过校验。

## 3. 部署顺序

1. **备份**：`pg_dump` 业务库；记录当前镜像 tag 与 `.env` 校验和。
2. **停写/维护窗口**（可选）：暂停新构建；已运行构建可等完成或取消。
3. **更新代码/镜像**：后端、前端、Builder、Validator 使用同一版本；Builder/Validator 仅接内部网络。
   HMAC 已绑定 method/path/body，**主 API 与 Builder 必须同版本更新**；旧 Builder 与新 API 互相拒绝签名。
4. **启动 API**：`create_all` 幂等建表（含 `material_sections`、Deck 六表、`page_chat_messages`），启动自愈把遗留活跃任务置 failed；确认 `/api/health`。
5. **启动 Builder/Validator**：确认 `/healthz`；配置共享 token。
6. **前端**：构建产物或 dev server 指向新 API；先验证登录/资料/旧版生成。
7. **烟测**：创建 Deck → 构建 1 页 → 阅读 → 选区问答；构建中取消/重试各一次。
8. **观察**：构建失败率、`page_chat` 429/503、Validator 5xx、存储增长。

## 4. 数据迁移

- **旧资料**：`material_sections` 由解析分节生成；历史上已 `indexed` 但无分节的资料会在下一次生成前懒回填（幂等）。回填失败不改变资料状态，返回中文原因；可重新上传或重试生成。
- **旧复习/模拟卷**：`artifacts` 与旧版 Markdown 继续只读可访问；模拟考试仍由 sections 驱动生成，不受 Deck 功能影响。
- **Deck 六表**：`create_all` 只建缺失表，不给已存在表加列；P7 未新增列。若从更早 P3 前版本升级，需先按历史补列逻辑启动一次 API。
- **页面助手**：`page_chat_messages` 自 P3 建表；新增数据仅读写本表，无跨表迁移。
- **向量清理（可选、不可逆）**：P1 后应用不再读写 `material_chunks`/pgvector。确认旧版工件与回滚窗口结束后，由维护者手动执行：
  ```sql
  -- 先备份；确认无旧版本实例仍依赖后执行
  DROP TABLE IF EXISTS material_chunks;
  DROP EXTENSION IF EXISTS vector;
  ```
  不执行不影响新功能，只保留冗余存储；**不要**在未确认前自动清理。

## 5. 回滚

| 场景 | 步骤 |
| --- | --- |
| 新前端异常 | 回退前端构建产物；旧 API 仍兼容（新增字段为附加字段，旧调用忽略） |
| 后端异常 | 回退 API 镜像；新表可保留（旧代码不读写时无副作用）；不要回滚已执行的向量清理 |
| Builder/Validator 异常 | 停用构建入口或在网关层关闭 `/api/decks/*/build|rebuild`；阅读器继续展示已 ready 页面；新构建 fail-closed 返回 503 |
| AI 助手异常 | 关闭助手入口或清空 `LLM_API_KEY`（POST 返回 503）；历史消息保留 |
| 数据损坏/误删 | 从 `pg_dump` 恢复；Deck 页面 bundle 在 OSS/本地存储按 key 保留，恢复 DB 后仍需对应对象 |
| 全量回滚 | 回退应用镜像到上一 tag；保留 `.env` 中新增变量（空值不启用）；旧版功能不依赖新表 |
| HMAC 协议回滚 | 主 API 与 Builder 必须成对回退；禁止只回退一侧，否则所有构建请求 401 |

回滚后执行：`/api/health`、登录、资料列表、旧版生成/模拟卷、Deck 阅读、助手 503/可用性检查。

## 6. 安全与运维要点

- **权限**：Deck/Page/Bundle/Chat/Job/Event 全部沿 deck → workspace → user 校验，他人资源 404。
- **生成代码**：iframe `sandbox="allow-scripts"`（无 same-origin）、srcdoc-only、CSP `connect-src 'none'`/`img-src data:`；Validator 拦截网络并 fail-closed；阅读器检测 srcdoc 就绪后的二次导航并销毁页面。
- **Prompt Injection**：资料/摘要/选区使用随机边界包裹并标注为数据；页面 Builder 无网络/无密钥/无 bash；助手无工具。
- **成本**：页面数 6–16、资料 200k 字符、单页 bundle 2 MiB、页面并发 2、单页重试上限、构建总超时 1800s、助手 20 次/分/user、单次回答 900 tokens。
- **日志**：构建与助手记录 deck/job/page/user/attempts/duration/sources 等字段；不记录完整 prompt、资料正文、选区文本、LLM key。

### 6.1 已接受的残留风险（需维护者知悉）

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| iframe 自导航外泄 | 沙箱仍允许 frame 自身导航到外部 URL，浏览器无法在请求前拦截；延迟触发的恶意链接可能把页面文本拼进 URL | 静态检查新增外部 URL 赋值/`setAttribute`/`assign`/`replace` 规则；阅读器检测二次 load 后立即销毁；Validator 运行时拦截并报告；残余风险需在真实模型红队中复核 |
| Validator 顶层渲染 | Validator 在页面顶层加载 shell，而非生产 srcdoc iframe；沙箱边界本身未在 Validator 内复现 | 阅读器实际使用 sandbox；新增 shell 标签白名单与 static-check；后续可改为 iframe 包装验证 |
| HMAC 同端点重放 | 签名已绑定 method/path/body，但无 nonce；±300s 内同一请求仍可重放 | 内部网络；create 幂等/body 指纹、cancel 幂等、GET 只读；需要时增加 nonce 缓存 |
| 进程内限流 | 助手限流为单 worker 内存计数 | 单实例/单 worker 部署；多副本需 Redis/DB 共享计数 |
| 旧 bundle 版本保留 | 重建成功后旧版本对象未删除，用于回滚/排查 | 定期按 key 前缀清理；删除工作区时已清理当前 bundle/thumbnail |
| 下载内存占用 | 资料下载一次性读入内存（≤50MB/请求），并发高时可能占内存 | 容器 mem_limit；后续可改流式下载与并发信号量 |
| 无 CI/lint | 仅本地最小测试栈 | 发布前手工执行本手册命令 |

## 7. 观察指标（日志优先）

- `page_build status=ready|failed duration_ms attempts`：构建成功率、耗时、重试率；
- `page_chat status=done duration_ms sources chars`：助手首答/失败率、来源使用；
- API 5xx/503、Validator 504 `VALIDATION_TIMEOUT`、429 次数；
- `deck_build_events` 条数/增长、存储对象增长、OSS/本地清理失败日志。

## 8. 发布结论模板

```text
版本：feat/pageref @ <commit>
后端：pytest 87 passed；P4 集成 6 passed（含 12 页断线恢复、启动自愈）
前端：typecheck/test 20 passed/build ok
Validator：44 passed；红队 16/16
Builder：22 passed
浏览器：P5 34/34、P6 24/24（假 LLM）
真实模型：P2 Gate 3/3、P4 14 页 E2E 14/14（DeepSeek `deepseek-flash`，合计 ¥1.83）；12 页编排/断线恢复另由隔离库集成覆盖
已知残留：见 §6.1
结论：待人类维护者审阅，未 push/merge
```
