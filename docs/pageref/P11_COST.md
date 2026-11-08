# P11 会话复用、Prompt 与成本实测

> 日期：2026-11-08。模型：DeepSeek Flash（OpenAI 兼容网关）；Builder `BUILDER_SESSION_MODE=deck`，`BUILDER_SESSION_PAGES_PER_LANE=3`。
> 计价口径：以网关账户余额差值为主（人民币，精确到分）；`usage.cost` 未配置单价，仅记录 token。

## 1. 预算与支出

| 项目 | 金额（CNY） |
| --- | ---: |
| 会话开始余额 | 116.19 |
| P10 结束后余额 | 115.82 |
| P11 开始余额（复用样本后） | 115.40 |
| A/B 结束后余额 | 114.73 |
| 失败注入结束后余额 | 114.23 |
| **P11 支出** | **1.17** |
| **累计支出（自会话开始）** | **1.96** |

P11 预算 ¥3，真实模型总预算 ¥6，均在限额内。14 页成本门禁（≤¥1.2）待 P13 全量 E2E 测量。
A/B 段支出 ¥0.67，失败注入段支出 ¥0.50（其中 2 页为取消/校验失败，token 仍计费）。

## 2. 轮换样本（章节切换）

来源：`P11_LANE_SAMPLE.json`。同 lane 顺序构建 mechanism（第 1 章）→ worked_example（第 2 章），第 2 页前因章节切换轮换会话。

| 页面 | 角色 | 输入 | 输出 | Cache Read | 构建耗时 | 校验 | 教学分 |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | mechanism | 29,283 | 20,147 | 674,176 | 118.6s | passed | 80 |
| 2 | worked_example | 27,938 | 17,315 | 585,728 | 98.2s | warning（11px 字号） | 100 |

- 轮换后第 2 页输入未下降，说明新会话未继承前缀缓存；符合“章节切换重建上下文”的预期。
- 结束 `DELETE /v1/sessions/{key}` 返回 202 `closed`。

## 3. 复用样本（同章节，改动前）

来源：`P11_LANE_REUSE.json`。第 2 页复用同一 lane 会话（旧版长提示词）。

| 页面 | 角色 | 输入 | 输出 | Cache Read | 构建耗时 | 校验 | 教学分 |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | mechanism | 22,094 | 17,527 | 488,704 | 103.0s | passed | 80 |
| 2 | practice | 8,522 | 12,624 | 649,344 | 70.8s | passed | 80 |

- 第 2 页输入 token **−61.4%**，耗时 **−31.3%**；证明会话复用本身有效。

## 4. A/B（2 页黄金样本：mechanism → practice，同章节）

来源：`P11_AB_PAGE_ZH.json`、`P11_AB_LANE_ZH.json`、`P11_AB_LANE_COMPACT_LOW.json`。
第 1 页为会话冷启动，第 2 页为复用/独立页；全部 6 页 `passed`、教学分 80、无 Validator issue。

| 方案 | Prompt | Thinking | 页1 输入/输出/耗时 | 页2 输入/输出/耗时 | 合计输入 | 合计输出 | 合计耗时 |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| A 逐页 | zh | medium | 41,558 / 23,493 / 140.7s | 28,075 / 17,946 / 104.5s | 69,633 | 41,439 | 245.2s |
| B Deck lane | zh | medium | 29,604 / 25,894 / 146.7s | 6,886 / 13,312 / 84.4s | 36,490 | 39,206 | 231.1s |
| C Deck lane | compact | low | 17,524 / 16,417 / 92.5s | 3,040 / 8,475 / 46.2s | 20,564 | 24,892 | 138.6s |

相对 A（逐页 / zh / medium），C（lane / compact / low）：

- 输入 token **−70.5%**，输出 token **−39.9%**，总耗时 **−43.5%**；
- 首轮通过率 2/2，教学分 80，与 A/B 持平；
- 第 2 页相对第 1 页输入 **−82.7%**（3,040 vs 17,524），复用收益显著。

注意：输入 token 含网关前缀缓存差异，冷启动页波动较大（compact/low 在后续重启测试中首屏为 28,772）。同一会话内的第 2 页下降趋势稳定（zh：−76.7%，compact：−82.7%）。

## 5. 失败注入

| 场景 | 操作 | 结果 | 恢复验证 |
| --- | --- | --- | --- |
| 取消页面 | 第 1 页启动 8s 后 `POST /cancel` | `canceled`，usage 全 0（`P11_FI_CANCEL.json`） | 同 key 第 2 页 `succeeded`，结束后 DELETE 202（`P11_FI_CANCEL_RECOVERY.json`） |
| Validator 宕机 | 停止 Validator 后构建第 1 页 | `failed`，中文 fail-closed 原因；lane 未销毁（`P11_FI_VALIDATOR_DOWN.json`） | 重启 Validator 后同 key 第 2 页 `succeeded`，输入 6,130（复用命中），DELETE 202（`P11_FI_VALIDATOR_RECOVERY.json`） |
| Builder 重启 | 构建第 1 页后停止并重启 Builder（healthz `sessions=0`） | 会话池丢失 | 同 key 第 2 页 `succeeded`，自动新建会话，DELETE 202（`P11_FI_RESTART_RECOVERY.json`） |

结论：单页取消/校验失败/进程重启均不污染后续页面；清理接口幂等；Builder 重启后由主 API 以 `first=false` 触发重建会话，无需人工干预。

未完成注入：超时（与取消同路径）、TTL（由定时清理覆盖）、会话异常（模型调用失败路径会关闭 lane 并写 handoff，已在代码路径与 Mock 测试覆盖）。

## 6. 思考档位限制

- `PAGE_BUILDER_REASONING` 默认 `false`：当前网关模型未声明 reasoning 支持，Pi 不会发送 thinking 参数，因此 `off/minimal/low` 的实际差异未能在本模型上测出。
- 方案 C 的收益主要来自 **compact prompt + 会话复用 + 短任务卡**，不能归因于 thinking 档位。
- 若切换到支持 `reasoning` 的模型/网关，设置 `PAGE_BUILDER_REASONING=1` 后可按同脚本补测 off/minimal/low。

## 7. 14 页成本门禁

按 A/B 的 compact/low 复用形态线性外推：冷启动页约 17–29k 输入，后续页约 3–7k 输入，14 页预计输入 <120k、输出 <200k，单 Deck 成本预计 ¥0.6–0.9，低于 ¥1.2 门禁。最终以 P13 真实 14 页 E2E 的前后余额差为准。

### 7.1 实测结果（P13，2026-11-08）

Deck 18 整册重建，2 lane、compact/low、thinking 未生效（同 §6）。任务 job 12：14/14 ready、0 failed、940.8s；余额 114.06 → 112.53，**实际支出 ¥1.53**（含冷启动与全部重试/校验，无额外失败页）。

| 指标 | 预测 | 实测 |
| --- | --- | --- |
| 输入 token | <120k | **246,317**（高于预测；每页均 3–40k，lancet 冷启动/压缩开销） |
| 输出 token | <200k | **274,052** |
| Cache read | - | **9,589,504**（命中率 97.5%） |
| 单 Deck 成本 | ¥0.6–0.9 | **¥1.53** |
| 门禁 | ≤¥1.2（本行）/ P13 ≤¥2 | ¥1.53 超出单 Deck ¥1.2 目标，但满足 P13 ≤¥2 |

偏差原因：真实 14 页每页均触发新工具轮次与自检，`BUILDER_SESSION_PAGES_PER_LANE=3` 使每条 lane 多次轮换、每轮重新冷启动；cache 读虽高，输入仍高于线性外推。后续若要逼近 ¥1.2，可提高 `BUILDER_SESSION_PAGES_PER_LANE`（减少轮换）或降低单页自检轮次。成本仍低于 P13 预算。

P13 另含两次单页遥测验证（¥0.10），P13 合计 ¥1.63；按会话开始余额 116.19 − 112.43，P8–P13 累计 **¥3.76**（总预算 ¥6）。
