# P9_REPORT.md · 教学契约与规划

> 日期：2026-11-08。范围：PageRef v2 P9（教学契约、大纲规划、页面 brief、来源引用与预算）。
> 契约字段以 `PAGE_CONTRACT.md` §14 为准；内容与密度规范见 `TEACHING_PAGE_SPEC.md`。

## 1. 交付

| 能力 | 实现 |
| --- | --- |
| 页面契约 1.1 | `schema_version="1.1"`、`manifest.design_system="1.0"`、`manifest.teaching`（role / objectives / chain / check / misconceptions / summary / worked_example / sources） |
| 大纲与角色 | `deck_planner.py` 校验 `teaching_role_hint`；无 hint 时按知识重要度与交互选择 role sequence（如 mechanism → worked_example）；章节末页补 summary |
| 页面 brief | `teaching_contract` 并入 brief：目标与 `source_refs`、讲解链 `block_id`、检查点、误区、密度与字数预算、`teaching_version` |
| 来源引用 | 按 section id 精确解析；缺失时按关键词回退；仍无法定位则标记 `unverified`，由前端提示“待核对”，不伪造来源 |
| 密度预算 | `DECK_VISIBLE_LAYER_CHARS=450`、`DECK_TOTAL_PAGE_CHARS=700` 随契约下发；Validator 检查块结构与教学完整性 |
| 开关 | `DECK_TEACHING_ENABLED`（默认 false，P10 门禁后开启）；`DECK_TEACHING_MIN_SCORE=70` 为评分门禁 |

## 2. 规划规则

- 支持 `concise / standard / deep` 三档密度，规划页数落在对应区间；知识点过多时按角色序列拆页，过少时合并但不丢失目标。
- 每页只保留一个主教学角色；复杂知识点拆成 `mechanism → worked_example → practice`，每页仍遵守单层密度预算。
- 输出结构经 Pydantic 解析与二次修复（最多两轮）；非法 role、章节/知识点数量越界、重要度非法均拒绝。
- 生成的 `teaching_contract` 是 LLM 不可信输出的一部分：字段校验失败即 fail-closed，不带病下发 Builder。

## 3. 测试与证据

- `backend/tests/test_deck_planner.py`：34 passed（大纲修复、来源解析、密度区间、角色序列/提示、brief 结构与预算、教学契约合并）。
- Validator：`TEACHING_MISSING / TEACHING_INVALID / TEACHING_BLOCK_MISSING / TEACHING_CHECK_MISSING / TEACHING_OBJECTIVE_MISMATCH` 静态检查与教学评分（见 `PAGE_CONTRACT.md` §14、`TEACHING_PAGE_SPEC.md`）。
- 真实模型小样见 `P10_PI_SAMPLE.md`；14 页整册证据见 `P13_RESULTS.json`。

## 4. 已知限制

- 教学评分是结构/承接启发式，不替代人工教学审阅；`worked_example` 以外角色的例题项为 0 分属预期。
- 规划仍依赖 LLM 输出质量；来源解析失败会标记待核对，而不是补造引用。
