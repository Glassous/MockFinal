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
