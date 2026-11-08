"""Deck 编排纯函数测试：资料签名稳定性与事件 payload 体积上限（不依赖数据库）。"""
import json

from app.services.deck_builder import MAX_EVENT_TEXT_BYTES, _truncate_payload, compute_source_signature


def test_source_signature_is_order_independent_and_content_sensitive() -> None:
    sections = [
        {"material_id": 1, "id": 2, "content": "第二节"},
        {"material_id": 1, "id": 1, "content": "第一节"},
    ]
    reordered = list(reversed(sections))
    assert compute_source_signature(sections) == compute_source_signature(reordered)

    changed = [
        {"material_id": 1, "id": 1, "content": "第一节（已修改）"},
        {"material_id": 1, "id": 2, "content": "第二节"},
    ]
    assert compute_source_signature(sections) != compute_source_signature(changed)
    assert len(compute_source_signature(sections)) == 64


def test_source_signature_accepts_tuples_and_skips_invalid() -> None:
    rows = [(1, 1, "a"), (1, 2, "b"), (None, None, "坏行")]
    assert len(compute_source_signature(rows)) == 64


def test_event_payload_is_truncated_to_limit() -> None:
    payload = {"message": "错误信息" * 3000, "extra": "x" * 100}
    trimmed = _truncate_payload(payload)
    size = len(json.dumps(trimmed, ensure_ascii=False).encode("utf-8"))
    assert size <= MAX_EVENT_TEXT_BYTES


def test_extract_builder_usage_normalizes_values() -> None:
    from app.services.deck_builder import _extract_builder_usage

    usage = _extract_builder_usage(
        {
            "usage": {
                "input_tokens": "120",
                "output_tokens": -5,
                "cache_read_tokens": 10,
                "cache_write_tokens": None,
                "cost": "0.25",
                "duration_ms": 1234.9,
            }
        },
        7,
        2,
    )
    assert usage == {
        "page_id": 7,
        "attempt": 2,
        "input_tokens": 120,
        "output_tokens": 0,
        "cache_read_tokens": 10,
        "cache_write_tokens": 0,
        "cost": 0.25,
        "duration_ms": 1234,
    }
    assert _extract_builder_usage({}, 1, 1) is None
    assert _extract_builder_usage({"usage": "bad"}, 1, 1) is None
    assert _extract_builder_usage({"usage": {"cost": "NaN"}}, 1, 1)["cost"] == 0


async def test_successful_page_records_usage(monkeypatch) -> None:
    from types import SimpleNamespace

    from app.services import deck_builder
    from app.services.deck_builder import _BuildContext

    recorded: list[tuple] = []
    usage_payload = {
        "input_tokens": 1000,
        "output_tokens": 500,
        "cache_read_tokens": 2000,
        "cache_write_tokens": 0,
        "cost": 0,
        "duration_ms": 1234,
    }

    class FakeBuilder:
        async def create_build(self, *args, **kwargs):
            return {}

        async def get_build(self, build_id):
            return {"status": "succeeded", "usage": usage_payload}

        async def get_events(self, build_id, after_seq):
            return {"events": [], "next_seq": after_seq}

        async def get_bundle(self, build_id):
            return {"bundle": {"schema_version": "1.1", "manifest": {}, "html": "", "css": "", "js": ""}}

    class FakeValidator:
        async def validate(self, bundle, viewports=None, screenshot=True):
            return {"status": "passed", "issues": [], "screenshots": [], "duration_ms": 10}

    async def fake_record(job_id, page_id, build_id, usage):
        recorded.append((job_id, page_id, build_id, usage))

    async def fake_begin(ctx, page):
        return 1

    async def fake_commit(ctx, page, build_id, bundle, bundle_key, thumbnail_key, summary):
        return True

    async def fake_save_bundle(**kwargs):
        return "bundle-key"

    async def fake_true(*args, **kwargs):
        return True

    async def fake_cancel(job_id):
        return False

    async def fake_next_version(page_id):
        return 1

    monkeypatch.setattr(deck_builder, "make_builder_client", lambda: FakeBuilder())
    monkeypatch.setattr(deck_builder, "make_validator_client", lambda: FakeValidator())
    monkeypatch.setattr(deck_builder, "_begin_page_attempt", fake_begin)
    monkeypatch.setattr(deck_builder, "_commit_page_ready", fake_commit)
    monkeypatch.setattr(deck_builder, "save_bundle", fake_save_bundle)
    monkeypatch.setattr(deck_builder, "_normalize_teaching", fake_true)
    monkeypatch.setattr(deck_builder, "_set_page_validating", fake_true)
    monkeypatch.setattr(deck_builder, "_next_page_version", fake_next_version)
    monkeypatch.setattr(deck_builder, "_is_cancel_requested", fake_cancel)
    monkeypatch.setattr(deck_builder, "_record_page_usage", fake_record)
    monkeypatch.setattr(deck_builder, "_register_inflight", lambda *args: None)
    monkeypatch.setattr(deck_builder, "_unregister_inflight", lambda *args: None)

    ctx = _BuildContext(job_id=9, deck_id=18, workspace_id=1, user_id=1, total_pages=1)
    page = SimpleNamespace(id=10, ordinal=0, title="页10", kind="focus")
    outcome = await deck_builder._build_one_page(
        ctx, page, {"knowledge_point": {"title": "标题"}}, rebuild=True
    )

    assert outcome.status == "ready"
    assert len(recorded) == 1
    job_id, page_id, build_id, usage = recorded[0]
    assert job_id == 9
    assert page_id == 10
    assert build_id is not None and build_id.startswith("bld_10_v1_")
    assert usage["input_tokens"] == 1000
    assert usage["cache_read_tokens"] == 2000


def test_assign_lanes_groups_chapters_and_balances() -> None:
    from types import SimpleNamespace

    from app.services.deck_builder import assign_lanes

    pages = [
        SimpleNamespace(id=index, ordinal=index, title=f"页{index}", kind="focus")
        for index in range(1, 9)
    ]
    chapters = {1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4}
    lanes = assign_lanes(pages, 2, chapters)

    assert [sorted(page.id for page in lane) for lane in lanes] == [
        [1, 2, 5, 6],
        [3, 4, 7, 8],
    ]
    for lane in lanes:
        assert [page.ordinal for page in lane] == sorted(page.ordinal for page in lane)
    for chapter in set(chapters.values()):
        lane_ids = [
            index
            for index, lane in enumerate(lanes)
            if any(chapters[page.id] == chapter for page in lane)
        ]
        assert len(lane_ids) == 1


def test_assign_lanes_without_chapters_round_robins() -> None:
    from types import SimpleNamespace

    from app.services.deck_builder import assign_lanes

    pages = [
        SimpleNamespace(id=index, ordinal=index, title=f"页{index}", kind="focus")
        for index in range(1, 5)
    ]
    lanes = assign_lanes(pages, 2, {})
    assert [[page.id for page in lane] for lane in lanes] == [[1, 3], [2, 4]]


async def test_build_pages_lane_mode_passes_session_metadata(monkeypatch) -> None:
    from types import SimpleNamespace

    from app.services import deck_builder
    from app.services.deck_builder import _BuildContext, _PageOutcome

    calls: list[tuple] = []

    async def fake_build_one_page(ctx, page, brief, *, rebuild, session=None):
        calls.append((page.id, session))
        return _PageOutcome("ready")

    async def fake_is_cancel_requested(job_id: int) -> bool:
        return False

    async def fake_cancel_page(ctx, page):
        return None

    async def fake_commit_page_failure(ctx, page, message, **kwargs):
        return None

    async def fake_cleanup(session_key: str) -> None:
        calls.append(("cleanup", session_key))

    monkeypatch.setattr(deck_builder, "_build_one_page", fake_build_one_page)
    monkeypatch.setattr(deck_builder, "_is_cancel_requested", fake_is_cancel_requested)
    monkeypatch.setattr(deck_builder, "_cancel_page", fake_cancel_page)
    monkeypatch.setattr(deck_builder, "_commit_page_failure", fake_commit_page_failure)
    monkeypatch.setattr(deck_builder, "_cleanup_builder_session", fake_cleanup)
    monkeypatch.setattr(deck_builder.settings, "deck_session_reuse_enabled", True)
    monkeypatch.setattr(deck_builder.settings, "deck_lane_count", 2)
    monkeypatch.setattr(deck_builder.settings, "page_builder_concurrency", 2)

    pages = [
        SimpleNamespace(id=index, ordinal=index, title=f"页{index}", kind="focus")
        for index in range(1, 5)
    ]
    brief_map = {
        1: {"deck_context": {"chapter_index": 1}},
        2: {"deck_context": {"chapter_index": 1}},
        3: {"deck_context": {"chapter_index": 2}},
        4: {"deck_context": {"chapter_index": 2}},
    }
    ctx = _BuildContext(job_id=7, deck_id=9, workspace_id=1, user_id=1)
    failures = await deck_builder._build_pages(ctx, pages, brief_map, rebuild=False)

    assert failures == []
    session_calls = [call for call in calls if call[0] != "cleanup"]
    assert sorted(call[0] for call in session_calls) == [1, 2, 3, 4]
    by_lane: dict[str, list[tuple[int, dict]]] = {}
    for page_id, session in session_calls:
        by_lane.setdefault(session["key"], []).append((page_id, session))
    assert sorted(by_lane) == ["deck_9_job_7_lane_0", "deck_9_job_7_lane_1"]
    lane0 = sorted(by_lane["deck_9_job_7_lane_0"], key=lambda item: item[1]["page_index"])
    assert [item[0] for item in lane0] == [1, 2]
    assert [item[1]["page_index"] for item in lane0] == [0, 1]
    assert [item[1]["page_total"] for item in lane0] == [2, 2]
    assert [item[1]["first"] for item in lane0] == [True, False]
    lane1 = sorted(by_lane["deck_9_job_7_lane_1"], key=lambda item: item[1]["page_index"])
    assert [item[0] for item in lane1] == [3, 4]
    cleanup_keys = sorted(call[1] for call in calls if call[0] == "cleanup")
    assert cleanup_keys == ["deck_9_job_7_lane_0", "deck_9_job_7_lane_1"]


async def test_lane_mode_continues_after_single_page_failure(monkeypatch) -> None:
    from types import SimpleNamespace

    from app.services import deck_builder
    from app.services.deck_builder import _BuildContext, _PageOutcome

    calls: list[tuple] = []

    async def fake_build_one_page(ctx, page, brief, *, rebuild, session=None):
        calls.append((page.id, session))
        if page.id == 1:
            return _PageOutcome("failed", "首轮校验失败")
        if page.id == 2:
            raise RuntimeError("模型异常")
        return _PageOutcome("ready")

    async def fake_is_cancel_requested(job_id: int) -> bool:
        return False

    async def fake_cancel_page(ctx, page):
        return None

    async def fake_commit_page_failure(ctx, page, message, **kwargs):
        calls.append(("failure", page.id, message))

    async def fake_cleanup(session_key: str) -> None:
        calls.append(("cleanup", session_key))

    monkeypatch.setattr(deck_builder, "_build_one_page", fake_build_one_page)
    monkeypatch.setattr(deck_builder, "_is_cancel_requested", fake_is_cancel_requested)
    monkeypatch.setattr(deck_builder, "_cancel_page", fake_cancel_page)
    monkeypatch.setattr(deck_builder, "_commit_page_failure", fake_commit_page_failure)
    monkeypatch.setattr(deck_builder, "_cleanup_builder_session", fake_cleanup)
    monkeypatch.setattr(deck_builder.settings, "deck_session_reuse_enabled", True)
    monkeypatch.setattr(deck_builder.settings, "deck_lane_count", 1)
    monkeypatch.setattr(deck_builder.settings, "page_builder_concurrency", 1)

    pages = [
        SimpleNamespace(id=index, ordinal=index, title=f"页{index}", kind="focus")
        for index in range(1, 4)
    ]
    brief_map = {index: {"deck_context": {"chapter_index": 1}} for index in range(1, 4)}
    ctx = _BuildContext(job_id=8, deck_id=9, workspace_id=1, user_id=1)
    failures = await deck_builder._build_pages(ctx, pages, brief_map, rebuild=False)

    assert failures == [
        ("页1", "首轮校验失败"),
        ("页2", "页面构建发生内部错误，请稍后重试"),
    ]
    built = [call for call in calls if call[0] in (1, 2, 3)]
    assert [call[0] for call in built] == [1, 2, 3]
    assert len({call[1]["key"] for call in built}) == 1
    failure_pages = [call[1] for call in calls if call[0] == "failure"]
    assert failure_pages == [2]
    cleanup_keys = [call[1] for call in calls if call[0] == "cleanup"]
    assert cleanup_keys == ["deck_9_job_8_lane_0"]


async def test_lane_mode_cancel_breaks_lane_and_still_cleans_up(monkeypatch) -> None:
    from types import SimpleNamespace

    from app.services import deck_builder
    from app.services.deck_builder import _BuildContext, _PageOutcome

    calls: list[tuple] = []

    async def fake_build_one_page(ctx, page, brief, *, rebuild, session=None):
        calls.append(("build", page.id))
        return _PageOutcome("canceled", "任务已取消")

    async def fake_is_cancel_requested(job_id: int) -> bool:
        return False

    async def fake_cancel_page(ctx, page):
        calls.append(("cancel", page.id))

    async def fake_commit_page_failure(ctx, page, message, **kwargs):
        return None

    async def fake_cleanup(session_key: str) -> None:
        calls.append(("cleanup", session_key))

    monkeypatch.setattr(deck_builder, "_build_one_page", fake_build_one_page)
    monkeypatch.setattr(deck_builder, "_is_cancel_requested", fake_is_cancel_requested)
    monkeypatch.setattr(deck_builder, "_cancel_page", fake_cancel_page)
    monkeypatch.setattr(deck_builder, "_commit_page_failure", fake_commit_page_failure)
    monkeypatch.setattr(deck_builder, "_cleanup_builder_session", fake_cleanup)
    monkeypatch.setattr(deck_builder.settings, "deck_session_reuse_enabled", True)
    monkeypatch.setattr(deck_builder.settings, "deck_lane_count", 1)
    monkeypatch.setattr(deck_builder.settings, "page_builder_concurrency", 1)

    pages = [
        SimpleNamespace(id=index, ordinal=index, title=f"页{index}", kind="focus")
        for index in range(1, 4)
    ]
    brief_map = {index: {"deck_context": {"chapter_index": 1}} for index in range(1, 4)}
    ctx = _BuildContext(job_id=10, deck_id=9, workspace_id=1, user_id=1)
    await deck_builder._build_pages(ctx, pages, brief_map, rebuild=False)

    assert [call for call in calls if call[0] == "build"] == [("build", 1)]
    assert [call[1] for call in calls if call[0] == "cleanup"] == ["deck_9_job_10_lane_0"]


def _outline_override_payload() -> dict:
    kp = {
        "title": "知识点",
        "summary": "摘要",
        "importance": "core",
        "difficulty": "medium",
        "objectives": ["目标"],
        "section_ids": [1],
        "teaching_role_hint": "mechanism",
    }
    return {
        "chapters": [
            {"title": "第一章", "knowledge_points": [{**kp, "title": f"1-{index}"} for index in range(2)]},
            {"title": "第二章", "knowledge_points": [{**kp, "title": f"2-{index}"} for index in range(2)]},
            {"title": "第三章", "knowledge_points": [{**kp, "title": f"3-{index}"} for index in range(2)]},
        ]
    }


def test_outline_override_is_validated_and_normalized() -> None:
    from app.services.deck_builder import _parse_outline_override

    outline = _parse_outline_override({"outline_override": _outline_override_payload()})
    assert outline is not None
    assert len(outline["chapters"]) == 3
    assert sum(len(chapter["knowledge_points"]) for chapter in outline["chapters"]) == 6


def test_outline_override_rejects_invalid_payload() -> None:
    import pytest

    from app.services.deck_builder import _parse_outline_override
    from app.services.deck_planner import DeckPlanningError

    with pytest.raises(DeckPlanningError):
        _parse_outline_override({"outline_override": {"chapters": []}})
    assert _parse_outline_override({"outline_override": None}) is None


def test_deck_style_accepts_content_2_fields() -> None:
    from app.schemas import DeckStyle

    style = DeckStyle(
        design_system="2.0",
        page_theme="problem",
        outline_override=_outline_override_payload(),
    )
    dumped = style.model_dump()
    assert dumped["design_system"] == "2.0"
    assert dumped["page_theme"] == "problem"
    assert dumped["outline_override"]["chapters"]
