"""Deck 规划纯函数测试（不依赖数据库/真实 LLM）。

覆盖：JSON 提取与修复重试、Pydantic/业务约束校验、source_refs 回退与 unverified、
页面计划密度与页数边界、Page Brief 结构与来源预算。
"""
import json
from types import SimpleNamespace

import pytest

from app.services.deck_planner import (
    DENSITY_PAGE_RANGES,
    SOURCE_TOTAL_BUDGET,
    DeckPlanningError,
    JsonExtractError,
    Outline,
    build_outline,
    build_page_brief,
    extract_json_object,
    parse_outline,
    plan_pages,
    resolve_source_refs,
)


def _kp(title: str, **overrides) -> dict:
    payload = {
        "title": title,
        "summary": f"{title} 的摘要",
        "importance": "normal",
        "difficulty": "medium",
        "objectives": [f"掌握 {title}"],
        "key_points": [f"{title} 要点"],
        "formulas": [],
        "misconceptions": [f"{title} 易错点"],
        "section_ids": [1],
        "interaction_idea": "",
        "page_count": 1,
    }
    payload.update(overrides)
    return payload


def _outline_payload(chapter_count: int = 3, kp_per_chapter: int = 2) -> dict:
    chapters = []
    for chapter_index in range(chapter_count):
        chapters.append(
            {
                "title": f"第 {chapter_index + 1} 章",
                "knowledge_points": [
                    _kp(f"知识点 {chapter_index + 1}-{kp_index + 1}")
                    for kp_index in range(kp_per_chapter)
                ],
            }
        )
    return {"chapters": chapters}


class FakeLLM:
    """按顺序返回预设文本，并记录调用次数。"""

    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls = 0
        self.messages: list[list[tuple[str, str]]] = []

    async def __call__(self, messages):
        self.messages.append(list(messages))
        response = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        return response


# ===== JSON 提取 =====
def test_extract_json_object_handles_fence_and_prose() -> None:
    text = '下面是规划结果：\n```json\n{"chapters": [{"title": "一"}]}\n```\n以上是全部内容。'
    assert extract_json_object(text) == {"chapters": [{"title": "一"}]}


def test_extract_json_object_handles_braces_inside_strings() -> None:
    text = '说明 {"a": "含 } 与 { 的字符串", "b": {"c": 1}} 结束'
    assert extract_json_object(text) == {"a": "含 } 与 { 的字符串", "b": {"c": 1}}


def test_extract_json_object_rejects_invalid_text() -> None:
    with pytest.raises(JsonExtractError):
        extract_json_object("完全没有 JSON 的说明文字")


# ===== 大纲校验与修复 =====
def test_parse_outline_accepts_valid_payload_and_marks_uncovered() -> None:
    payload = _outline_payload()
    payload["chapters"][0]["knowledge_points"][0]["section_ids"] = []
    payload["chapters"][0]["knowledge_points"][0]["summary"] = ""
    outline = parse_outline(payload)
    assert isinstance(outline, Outline)
    assert "资料未覆盖" in outline.chapters[0].knowledge_points[0].summary


@pytest.mark.parametrize(
    "chapter_count,kp_per_chapter",
    [(2, 3), (7, 1), (3, 1)],
)
def test_parse_outline_rejects_count_violations(chapter_count: int, kp_per_chapter: int) -> None:
    with pytest.raises(DeckPlanningError):
        parse_outline(_outline_payload(chapter_count, kp_per_chapter))


def test_parse_outline_rejects_invalid_importance() -> None:
    payload = _outline_payload()
    payload["chapters"][0]["knowledge_points"][0]["importance"] = "critical"
    with pytest.raises(DeckPlanningError):
        parse_outline(payload)


async def test_build_outline_repairs_then_succeeds() -> None:
    valid = _outline_payload()
    fake = FakeLLM(["这不是 JSON", json.dumps(valid, ensure_ascii=False)])
    outline = await build_outline(fake, "数据结构", "期末复习", [])
    assert len(outline["chapters"]) == 3
    assert fake.calls == 2
    # 第二次调用必须把校验错误反馈给 LLM
    assert len(fake.messages[1]) == 4
    assert "未通过校验" in fake.messages[1][-1][1]


async def test_build_outline_fails_after_two_repairs() -> None:
    fake = FakeLLM(['{"chapters": []}'])
    with pytest.raises(DeckPlanningError):
        await build_outline(fake, "数据结构", "", [], max_repair_attempts=2)
    assert fake.calls == 3


async def test_build_outline_validates_invalid_section_type() -> None:
    payload = _outline_payload()
    payload["chapters"][0]["knowledge_points"][0]["section_ids"] = ["abc"]
    with pytest.raises(DeckPlanningError):
        parse_outline(payload)


# ===== source_refs =====
SECTIONS = [
    {
        "id": 1,
        "material_id": 10,
        "heading": "二分查找",
        "content": "二分查找每次把搜索区间折半，时间复杂度为 O(log n)。" * 20,
    },
    {
        "id": 2,
        "material_id": 10,
        "heading": "动态规划",
        "content": "动态规划通过状态转移方程求解最优子结构问题。",
    },
]


def test_resolve_source_refs_accepts_valid_ids() -> None:
    refs, unverified = resolve_source_refs([1], SECTIONS)
    assert unverified is False
    assert refs[0]["section_id"] == 1
    assert refs[0]["material_id"] == 10
    assert refs[0]["heading"] == "二分查找"
    assert len(refs[0]["quote"]) <= 200


def test_resolve_source_refs_falls_back_by_keyword() -> None:
    refs, unverified = resolve_source_refs([999], SECTIONS, keywords=["动态规划"])
    assert unverified is True
    assert refs and refs[0]["section_id"] == 2
    assert refs[0]["unverified"] is True


def test_resolve_source_refs_marks_unverified_without_match() -> None:
    refs, unverified = resolve_source_refs([999], SECTIONS, keywords=["量子力学"])
    assert unverified is True
    assert refs == []


def test_resolve_source_refs_does_not_fallback_when_ids_valid() -> None:
    refs, unverified = resolve_source_refs([2], SECTIONS, keywords=["二分查找"])
    assert unverified is False
    assert [ref["section_id"] for ref in refs] == [2]


# ===== 页面计划 =====
@pytest.mark.parametrize("density", ["concise", "standard", "deep"])
@pytest.mark.parametrize("kp_total", [6, 10, 16])
def test_plan_pages_respects_density_range_and_coverage(density: str, kp_total: int) -> None:
    chapter_count = 3
    per_chapter = kp_total // chapter_count
    chapters = _outline_payload(chapter_count, per_chapter)["chapters"]
    # 补足到 kp_total
    remaining = kp_total - per_chapter * chapter_count
    for index in range(remaining):
        chapters[index]["knowledge_points"].append(_kp(f"补充知识点 {index}"))

    plans = plan_pages(chapters, density)
    lower, upper = DENSITY_PAGE_RANGES[density]
    assert lower <= len(plans) <= upper
    assert 6 <= len(plans) <= 16
    covered = {index for plan in plans for index in plan["kp_indices"]}
    assert covered == set(range(kp_total))
    assert [plan["ordinal"] for plan in plans] == list(range(len(plans)))


def test_plan_pages_merges_when_kp_exceeds_concise_range() -> None:
    chapters = _outline_payload(4, 4)["chapters"]  # 16 个知识点，concise 上限 9
    plans = plan_pages(chapters, "concise")
    assert len(plans) <= 9
    covered = {index for plan in plans for index in plan["kp_indices"]}
    assert covered == set(range(16))
    assert any(len(plan["kp_indices"]) > 1 for plan in plans)


def test_plan_pages_kind_follows_importance_and_interaction() -> None:
    chapters = [
        {
            "title": "第一章",
            "knowledge_points": [
                _kp("核心", importance="core", interaction_idea="用动画演示区间收缩"),
                _kp("次要", importance="minor"),
            ],
        }
    ]
    # 为满足 6–16 页下限，额外补充普通知识点
    chapters[0]["knowledge_points"].extend(_kp(f"普通 {index}") for index in range(8))
    plans = plan_pages(chapters, "concise")
    kinds = {plan["primary_kp_index"]: plan["kind"] for plan in plans}
    assert kinds[0] == "interactive"
    assert kinds[1] == "summary"


def test_plan_pages_rejects_unknown_density() -> None:
    with pytest.raises(DeckPlanningError):
        plan_pages(_outline_payload()["chapters"], "super-deep")


# ===== Page Brief =====
def test_build_page_brief_structure_and_source_budget() -> None:
    deck = SimpleNamespace(
        title="数据结构 · 复习页",
        style={"preset": "blueprint", "content": ["formula"], "density": "standard", "custom_prompt": ""},
    )
    kp = {
        "id": 7,
        "title": "二分查找",
        "summary": "区间折半",
        "objectives": ["掌握二分"],
        "key_points": ["循环不变量"],
        "formulas": ["$O(\\log n)$"],
        "misconceptions": ["边界错误"],
        "source_refs": [
            {"section_id": 1, "material_id": 10},
            {"section_id": 2, "material_id": 10},
            {"section_id": 3, "material_id": 10},
        ],
        "interaction_idea": "区间收缩动画",
    }
    sections = {
        index: {
            "id": index,
            "material_id": 10,
            "heading": f"分节 {index}",
            "content": ("二分查找 " * 1200)[:5000],
        }
        for index in (1, 2, 3)
    }
    pages = [
        {"id": 1, "ordinal": 0, "title": "上一页", "summary": "上一页摘要"},
        {"id": 2, "ordinal": 1, "title": "当前页", "summary": "当前页摘要"},
        {"id": 3, "ordinal": 2, "title": "下一页", "summary": "下一页摘要"},
    ]

    brief = build_page_brief(deck, kp, pages, sections, current_page=pages[1])

    assert brief["page_id"] == ""
    assert brief["deck_title"] == "数据结构 · 复习页"
    assert brief["knowledge_point"]["title"] == "二分查找"
    assert brief["style"]["preset"] == "blueprint"
    assert brief["constraints"]["no_scroll"] is True
    assert brief["constraints"]["no_network"] is True
    assert brief["constraints"]["runtime_version"] == "1.0.0"
    assert brief["constraints"]["language"] == "zh-CN"
    assert brief["previous_page"]["title"] == "上一页"
    assert brief["next_page"]["title"] == "下一页"
    assert all(len(excerpt["text"]) <= 6000 for excerpt in brief["source_excerpts"])
    assert sum(len(excerpt["text"]) for excerpt in brief["source_excerpts"]) <= SOURCE_TOTAL_BUDGET
    assert brief["source_meta"]["truncated_section_ids"]


def test_build_page_brief_marks_missing_sections() -> None:
    deck = {"title": "D", "style": {}}
    kp = {
        "title": "知识点",
        "summary": "",
        "objectives": [],
        "key_points": [],
        "formulas": [],
        "misconceptions": [],
        "source_refs": [{"section_id": 404, "material_id": 1}],
        "interaction_idea": "",
    }
    brief = build_page_brief(deck, kp, [], {})
    assert brief["source_excerpts"] == []
    assert brief["source_meta"]["missing_section_ids"] == [404]
    assert brief["source_meta"]["unverified"] is True
    assert brief["style"]["density"] == "standard"
