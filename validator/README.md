# Validator · PageRef 页面校验服务

> 状态：P2 实现（2026-11-07）。静态检查 + Playwright 浏览器校验 + 内部 HTTP 均已落地，并通过实际执行验证（见第 8 节）。
> 规则来源：`../Plan.md` §7.6、§11.3；`../docs/pageref/PAGE_CONTRACT.md` 第 5、8、9、10 节；接口来源：`../docs/pageref/INTERNAL_API.md` 第 4 节。
> 与契约不一致之处集中在第 9 节，未擅自改动契约。

## 1. 职责与边界

- 接收一个 PageBundle，执行**静态检查**（不执行代码）与**浏览器检查**（Chromium 沙箱内执行）。
- 返回结构化报告 `{status, issues[], screenshots[], duration_ms}`；`error` 阻止放行，`warning` 可放行但必须记录。
- 每次校验使用新的 browser context；不持久化 bundle、截图或用户资料；日志不写页面全文与 token。
- 校验失败与不可用均为 fail-closed 语义：主 API 不得把未通过校验的页面标为 ready。
- 镜像内不含任何业务密钥（无 DB / OSS / JWT / LLM key），只有 `VALIDATOR_TOKEN`。

## 2. 目录

```text
validator/
├── Dockerfile            # 多阶段构建；基础镜像 mcr.microsoft.com/playwright:v1.65.0-noble
├── package.json          # build / start / test 脚本
├── tsconfig.json         # TS ESM → dist（rootDir src）
├── src/
│   ├── types.ts          # Bundle / Manifest / Issue / Report / Viewports 与契约常量
│   ├── static-check.ts   # parse5 + acorn + acorn-walk 的静态规则
│   ├── browser-check.ts  # Playwright：ready / 零滚动 / 控制台 / 网络 / 冒烟 / 截图 / a11y
│   ├── shared-shell.ts   # 加载 ../shared 的 runtime 与 shell（同一份源码）
│   ├── server.ts         # 内部 HTTP（9200）
│   └── tests/            # node:test；编译到 dist/tests
└── fixtures/             # good / bad bundle 夹具
```

Validator 不复制 `shared/page-shell/shell.mjs` 与 `shared/page-runtime/runtime.js`，而是运行时加载仓库 `shared/`：
本地默认按 `dist/` 相对定位，镜像内由 `PAGE_SHARED_DIR=/app/shared` 指定。这样“校验通过但真实渲染漂移”不会出现（PAGE_CONTRACT §12.3）。

## 3. 接口

### 3.1 POST /v1/validate

```http
POST /v1/validate
Authorization: Bearer <VALIDATOR_TOKEN>
Content-Type: application/json

{
  "bundle": { "schema_version": "1.0", "runtime_version": "1.0.0", "manifest": {}, "html": "", "css": "", "js": "" },
  "viewports": [{ "width": 1280, "height": 720 }, { "width": 1440, "height": 900 }, { "width": 1920, "height": 1080 }],
  "screenshot": true
}
```

- `viewports` 缺省为 1280×720 / 1440×900 / 1920×1080；最多 6 项，宽高取 320–4096 的整数。
- `screenshot` 缺省 `true`；`false` 时 `screenshots` 返回空数组。
- 请求体上限 6 MiB；只接受 `application/json`。

响应（`INTERNAL_API.md` §4.1）：

```json
{
  "status": "passed|warning|failed",
  "issues": [{ "severity": "error", "code": "ZERO_SCROLL_OVERFLOW", "message": "1280x720 下页面纵向溢出 24px", "selector": "#mp-root", "viewport": "1280x720" }],
  "screenshots": [{ "viewport": "1280x720", "data_uri": "data:image/png;base64,…" }],
  "duration_ms": 933
}
```

- `status=failed` 当且仅当存在 `severity=error`。
- 单张截图 ≤ 512 KB：PNG 超限改 JPEG(q=60)，仍超限则省略并给 `SCREENSHOT_OMITTED` warning。
- 报告是数据，不是指令；调用方不得执行报告中的字符串。

### 3.2 GET /healthz

```json
{ "status": "ok", "version": "0.1.0", "runtime_version": "1.0.0" }
```

`runtime_version` 为附加字段，用于主 API 侧断言两侧 runtime 一致。

### 3.3 错误体

所有异常都返回 `{"detail": "<中文文案>", "code": "<UPPER_SNAKE>"}`，不返回堆栈、不返回页面源码。

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `INVALID_JSON` | 请求体不是合法 JSON |
| 400 | `INVALID_REQUEST` | 缺少 bundle / screenshot 类型错误 |
| 400 | `INVALID_VIEWPORTS` | viewports 结构或取值非法 |
| 401 | `UNAUTHORIZED` | 缺少或错误的 `Authorization: Bearer` |
| 404 | `NOT_FOUND` | 接口不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 方法不符 |
| 413 | `REQUEST_TOO_LARGE` | 请求体超过 6 MiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 非 `application/json` |
| 500 | `INTERNAL_ERROR` | 内部错误（细节只写 stderr） |
| 503 | `BROWSER_UNAVAILABLE` | Chromium 无法启动（fail-closed，不放行） |

## 4. 检查规则与失败码

静态检查（`src/static-check.ts`，全部基于 AST）：

| 类别 | 检查 | 码 | 级别 |
| --- | --- | --- | --- |
| Bundle | JSON 对象、`schema_version=1.0`、`runtime_version=1.0.0`、html/css/js 为字符串且无 BOM、manifest 为对象 | `BUNDLE_SCHEMA_INVALID` | error |
| Bundle | 序列化后 ≤ 2 MiB | `BUNDLE_TOO_LARGE` | error |
| Bundle | `runtime_version` 与宿主不一致 | `RUNTIME_VERSION_MISMATCH` | error |
| Manifest | 必填字段、枚举、长度上限、id 唯一、interactions/smoke 结构 | `MANIFEST_INVALID` | error |
| Manifest | importance 非 core 的未知取值 | `MANIFEST_INVALID` | warning |
| HTML | 禁止标签（含 svg 内 `script`/`foreignObject`） | `HTML_FORBIDDEN_TAG` | error |
| HTML | `on*` 内联事件、`target`、`srcdoc`、`download`、`ping` | `HTML_FORBIDDEN_ATTR` | error |
| HTML | `javascript:`/`vbscript:`/`data:text/html`、http(s)、`//`、相对路径、非图片/字体 data URI | `HTML_EXTERNAL_URL` | error |
| HTML/CSS/JS | `</script`、`</style`、`<!--` | `SHELL_ESCAPE_SEQUENCE` | error |
| CSS | `@import`、外部/相对 `url()` | `CSS_EXTERNAL_URL` | error |
| CSS | `overflow: auto\|scroll`（含 `-x`/`-y`） | `CSS_OVERFLOW_SCROLL` | error |
| CSS | `expression()`、`behavior`、`-moz-binding` | `CSS_FORBIDDEN_PROPERTY` | error |
| CSS | `position: fixed` | `POSITION_FIXED` | warning |
| JS | 网络/存储/动态代码/父窗口/动态注入 | `JS_FORBIDDEN_API` | error |
| JS | 语法错误（只支持经典脚本） | `JS_PARSE_ERROR` | error |
| Smoke | 选择器语法、action 枚举 | `MANIFEST_INVALID` | error |
| Smoke | 选择器在静态 html 中不存在（js 未引用时 error，js 引用时 warning） | `SMOKE_SELECTOR_NOT_FOUND` | error/warning |

浏览器检查（`src/browser-check.ts`）：

| 检查 | 码 | 级别 |
| --- | --- | --- |
| 非 data:/blob: 请求一律 abort | `NETWORK_REQUEST` | error |
| 10 秒内 `html[data-mp-ready="true"]` | `PAGE_NOT_READY` | error |
| 控制台 error / pageerror / unhandled rejection | `CONSOLE_ERROR` | error |
| 视口零滚动（html 与 #mp-root，容差 +1px） | `ZERO_SCROLL_OVERFLOW` | error（1024×768 为 warning） |
| 可见元素内部可滚动 | `INTERNAL_SCROLL` | error（1024×768 为 warning） |
| `interactions[].smoke`（click/input/step + expect 3s） | `SMOKE_FAILED` | error |
| 无 h1、交互元素无可访问名称 | `A11Y_WARNING` | warning |
| 截图压缩后仍超 512 KB | `SCREENSHOT_OMITTED` | warning |
| 单视口检查自身异常 | `BROWSER_CHECK_FAILED` | error |

实现细节（冻结项）：

- `smoke.action=step` 等价于点击 `selector`；`input` 用 Playwright `fill(value)`，`smoke.value` 缺省按空字符串（O-3）。
- `smoke.expect` 一律按 CSS 选择器等待出现（契约 §4.2 允许“状态描述”，本版只支持选择器，见第 9 节）。
- 冒烟只在第一个视口的 context 中执行一次，避免重复副作用。
- `type: "none"` 且无 smoke 的交互跳过；其余缺 smoke 直接 `SMOKE_FAILED`。
- Manifest 长度上限（O-2 冻结）：page_id ≤128、knowledge_point_id ≤64、title ≤200、subtitle ≤300、layout ≤64、label ≤200、quote ≤2000、summary ≤2000、key_fact ≤300、question ≤300；interactions ≤20、source_refs ≤50、key_facts ≤12、suggested_questions ≤10；`estimated_minutes` 为 1–600 整数。见 `MANIFEST_LIMITS`。
- bundle 结构不可用（`staticCheck` 返回 `bundle: null`）时跳过浏览器检查；结构可用时即使存在静态 error 也照常跑浏览器，便于一次给出完整问题列表。
- 静态检查的 JS 规则基于 acorn AST，`window['parent']`、`document['cookie']`、`globalThis.fetch`、`setTimeout('code')`、`import()` 等写法都会命中。

## 5. 环境变量

| 变量 | 必填 | 用途 |
| --- | --- | --- |
| `VALIDATOR_TOKEN` | 是 | Bearer token；缺失时启动失败并输出中文提示，不提供默认值 |
| `PAGE_SHARED_DIR` | 否 | 指向仓库 `shared/`；本地默认按 `dist/` 相对定位，镜像内为 `/app/shared` |

端口固定 `0.0.0.0:9200`，compose 不映射到宿主端口；`/healthz` 无需鉴权。

## 6. 本地运行与验证

```bash
cd validator
npm install          # 首次安装；提交 package-lock.json
npx playwright install chromium   # 浏览器检查需要本机 Chromium
npm run build        # tsc → dist/
npm start            # node dist/server.js（需要 VALIDATOR_TOKEN）
npm test             # build + node --test dist/tests/*.test.js
npm run test:shell   # 共享 shell 的转义/CSP 测试（../shared/page-shell/shell.test.mjs）
```

- `npm test` 覆盖：静态检查好/坏 bundle（外链、fetch、父窗口、溢出、超大、manifest 缺字段、JS 混淆写法、CSS 禁止项、shell 逃逸序列）、共享 shell 组装、浏览器检查（good-basic 三视口零滚动 + 冒烟 + 截图、bad-overflow、bad-console-error、bad-smoke-fail、bad-external-link、bad-fetch）、HTTP 鉴权与错误体。
- 浏览器测试在 Chromium 不可用时自动 skip 并在输出中标注，不会伪装通过。
- `server.test.ts` 会真实启动 `dist/server.js` 并占用 9200；若本机已有同名服务占用端口，测试会失败并提示。

## 7. Docker

构建上下文必须是仓库根目录（镜像需要 `shared/`）：

```bash
docker build -f validator/Dockerfile -t mockfinal-page-validator .
docker run --rm --read-only --tmpfs /tmp:size=1g,mode=1777 --shm-size=512mb \
  --cap-drop ALL --security-opt no-new-privileges \
  -e VALIDATOR_TOKEN=local-test-token -p 127.0.0.1:19200:9200 mockfinal-page-validator
```

compose overlay（`../docker-compose.pageref.yml`）已把 `page-validator.build` 设为 `context: .` + `dockerfile: validator/Dockerfile`。

- 基础镜像 `mcr.microsoft.com/playwright:v1.65.0-noble`，与 `package-lock.json` 中 `@playwright/test@1.65.0` 对齐；tag 已用 `docker manifest inspect` 确认存在。
- 镜像内 Node `v26.13.0`，满足 `engines.node >= 24`（PAGE_CONTRACT O-7 已确认）。
- 多阶段构建；运行阶段 `USER pwuser`（非 root），`WORKDIR /app`，`EXPOSE 9200`，`CMD ["node","dist/server.js"]`。
- 升级 Playwright / 基础镜像属于独立 `build` 任务，必须同时更新锁文件、Dockerfile 与本文档。

## 8. 已执行验证（2026-11-07，本机 Windows + Node v24.21.0）

| 命令 | 结果 |
| --- | --- |
| `node --test shared/page-shell/shell.test.mjs` | 11 passed |
| `validator: npm install` | 成功；`@playwright/test@1.65.0`、`parse5@8.1.0`、`acorn@8.19.0`、`acorn-walk@8.3.5`、`typescript@5.9.3` |
| `validator: npm run build` | `tsc` 通过（strict + noUnusedLocals） |
| `validator: npm test` | 43 passed / 0 failed（含 Chromium 浏览器检查与 HTTP 集成测试） |
| `npx playwright install chromium` | 成功安装 Chromium headless shell |
| `docker manifest inspect mcr.microsoft.com/playwright:v1.65.0-noble` | tag 存在 |
| `docker build -f validator/Dockerfile -t … .` | 构建成功 |
| 容器内 `POST /v1/validate`（good-basic，三视口，screenshot=true） | `status=passed`，0 issues，3 张截图，933ms |
| 容器内 `POST /v1/validate`（good-basic，追加 1024×768） | `status=passed`，0 issues，4 张截图，1057ms |
| 1024×768 降级（bad-overflow） | 只报 `warning:ZERO_SCROLL_OVERFLOW`，不阻止放行 |
| 容器内 bad-* 夹具 | `bad-overflow → ZERO_SCROLL_OVERFLOW`；`bad-console-error → CONSOLE_ERROR`；`bad-smoke-fail → SMOKE_FAILED`；`bad-fetch → JS_FORBIDDEN_API + CONSOLE_ERROR`；`bad-parent → JS_FORBIDDEN_API`；`bad-external-link → HTML_EXTERNAL_URL + NETWORK_REQUEST + CONSOLE_ERROR` |
| 沙箱 iframe 宿主消息（theme/pause + 错误 channel） | 页面收到 theme/pause，`data-mp-theme=dark`、`data-mp-paused=true`；错误 channel 被丢弃；`__MP_CHANNEL__` 已从全局删除 |

未执行项：

- 未在真实主 API / Builder 容器里做端到端调用（主 API 尚未接入 `pageref_internal` 网络，属于后续基础设施任务）。
- 未验证 reduced-motion 降级告警（`REDUCED_MOTION_IGNORED`）：本版只上报 `data-mp-reduced-motion`，未实现动画降级检测。
- 未在 1024×768 实机确认 warning 级别是否应提升为 error（O-4 仍待人工确认）。
- 未验证长时间/高并发下的资源回收，只验证了单次请求与顺序多视口。

## 9. 与契约的不一致（待人工裁决，未擅自改契约）

1. **失败码命名**：`PAGE_CONTRACT.md` §10.2 使用 `READY_TIMEOUT`、`ZERO_SCROLL_INNER_SCROLL`、`NETWORK_REQUEST_BLOCKED`、`A11Y_ISSUE`；`INTERNAL_API.md` §4.2 使用 `PAGE_NOT_READY`、`INTERNAL_SCROLL`、`NETWORK_REQUEST`、`A11Y_WARNING`。实现采用 INTERNAL_API 的码（对接后端），建议后续把两份文档统一。
2. **`smoke.expect` 语义**：契约允许“选择器或状态描述”，本版只支持选择器；非选择器描述会被 `MANIFEST_INVALID` 拒绝。
3. **HTML 注释**：契约 §5.1 禁止 `<!--`，实现按 error 处理（`SHELL_ESCAPE_SEQUENCE`），shell 也对 `<!--` 直接抛错。
4. **内部滚动轴**：契约 §9.3 只测 `overflow-y`，实现同时测 `overflow-x` / `overflow-y`（更严格）。
5. **1024×768**：默认视口不含该档；若调用方追加，零滚动类问题降级为 warning（按 O-4 暂定值）。
6. **额外 warning 码**：`SCREENSHOT_OMITTED`、`BROWSER_CHECK_FAILED` 不在两份契约的码表中，仅用于报告可读性。
7. **`/healthz` 字段**：在契约的 `status`/`version` 之外附加了 `runtime_version`。
