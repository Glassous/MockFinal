# P10 真实 Pi 教学小样报告

日期：2026-11-08
模式：真实 Pi（`deepseek-flash`，thinking=medium，Builder 0.2.0 / Pi 1.5.0）
预算上限：P10 小样 ≤¥1；实际支出 **¥0.37**（余额 116.19 → 115.82，CNY）

## 1. 三页教学样本（mechanism / worked_example / practice）

Brief：`builder/fixtures/teaching/<role>/brief.json`；均使用 schema 1.1、runtime 1.1.0、`design_system=1.0`、`teaching_contract` 与角色模板。

| 角色 | 结果 | 耗时 | input | output | cache read | 教学评分 | bundle | CSS | HTML | 正文汉字 | chain / check |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| mechanism | succeeded | 98.5s | 30,251 | 18,233 | 420,352 | 80 | 18,584 | 6,561 | 4,526 | 342 | 3 / 1 |
| worked_example | succeeded | 99.5s | 24,609 | 19,656 | 301,184 | 100 | 21,637 | 6,181 | 5,116 | 144 | 4 / 1 |
| practice | succeeded | 98.1s | 27,126 | 19,191 | 454,016 | 80 | 15,609 | 4,660 | 3,710 | 289 | 5 / 1 |

- 三页均一次通过 Validator（桌面三视口 + 冒烟 + 教学结构），`validation=passed`，无教学警告。
- mechanism / practice 的 80 分来自评分口径：非 `worked_example` 角色未提供例题，例题项为 0；目标 20 + 讲解链 20 + 误区 15 + 检查 15 + 来源承接 10。
- `worked_example` 提供 4 步例题，得满分 100。
- 每页均从角色模板起步（manifest schema 1.1、`data-mp-block`、步骤器与检查骨架），Pi 替换了真实内容。

原始报告：`P10_PI_SAMPLE.json`。

## 2. CSS 预算复测

第一轮 mechanism 页面 `page.css` 为 6,561 字节，与 P8 基线中位数（6,230 字节）基本持平，未达到“CSS 明显下降”。原因是 Pi 重写了 `.mp-page/.mp-head/.mp-title/.mp-sub` 等 Kit 已提供的基础类。

调整：

- 构建提示与模板提示明确要求只追加页面专属样式，禁止重定义 Kit 基础类，教学页 CSS ≤4 KiB；
- Validator 新增 `CSS_BUDGET_WARNING`（schema 1.1 + `design_system=1.0`，`page.css >4096` 字节，warning）；
- Builder 修复手册同步该码。

复测同一 mechanism brief：

| 指标 | 调整前 | 调整后 | 变化 |
| --- | ---: | ---: | ---: |
| `page.css` | 6,561 | 3,962 | −39.6% |
| bundle 总量 | 18,584 | 14,609 | −21.4% |
| JS | 3,953 | 3,202 | −19.0% |
| 教学评分 | 80 | 80 | 持平 |
| Validator | passed | passed（无 CSS 警告） | — |

原始报告：`P10_PI_SAMPLE_CSS.json`。

## 3. 成本与结论

- 三页首轮：¥0.13；CSS 复测一页：¥0.24；合计 **¥0.37**，低于 P10 上限 ¥1，剩余 ¥0.63 不再使用。
- `PAGE_BUILDER_COST_*` 未配置，`usage.cost` 记为 0；以上为 DeepSeek 余额实际差值，按 2 位小数计。
- 结论：真实 Pi 能在角色模板上完成 1.1 教学页，三页首轮通过；教学结构、内容预算、桌面零滚动与移动端检查均有效。CSS 预算通过提示 + warning 可收敛到 4 KiB 以内。
- 下一步（P11）：lane 会话复用与稳定前缀，目标是降低每页 input/cache 成本，并在黄金集上做 A/B。
