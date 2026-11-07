"""Deck Pydantic schema 边界测试（不依赖数据库）。

覆盖：风格预设中文别名、枚举/长度边界、进度字段上限、Bundle 契约必填项。
"""
import pytest
from pydantic import ValidationError

from app.schemas import (
    DECK_DENSITIES,
    DECK_STYLE_PRESETS,
    DeckCreate,
    DeckProgressUpdate,
    DeckStyle,
    PageBundleOut,
)


def test_deck_style_maps_chinese_preset_to_code() -> None:
    style = DeckStyle(preset="讲义", density="deep", content=["formula", "formula", ""])
    assert style.preset == "editorial"
    assert style.density == "deep"
    assert style.content == ["formula"]


def test_deck_style_accepts_all_presets_and_densities() -> None:
    for preset in DECK_STYLE_PRESETS:
        assert DeckStyle(preset=preset).preset == preset
    for density in DECK_DENSITIES:
        assert DeckStyle(density=density).density == density


def test_deck_style_rejects_unknown_preset() -> None:
    with pytest.raises(ValidationError):
        DeckStyle(preset="随性")


def test_deck_style_rejects_unknown_density() -> None:
    with pytest.raises(ValidationError):
        DeckStyle(density="extreme")


def test_deck_style_custom_prompt_limit() -> None:
    assert len(DeckStyle(custom_prompt="提" * 500).custom_prompt) == 500
    with pytest.raises(ValidationError):
        DeckStyle(custom_prompt="提" * 501)


def test_deck_style_content_item_limit() -> None:
    with pytest.raises(ValidationError):
        DeckStyle(content=["x" * 33])


def test_deck_create_title_limit() -> None:
    DeckCreate(title="标" * 255)
    with pytest.raises(ValidationError):
        DeckCreate(title="标" * 256)


def test_deck_progress_update_limits() -> None:
    assert DeckProgressUpdate(completed_page_ids=list(range(500))).completed_page_ids
    with pytest.raises(ValidationError):
        DeckProgressUpdate(completed_page_ids=list(range(501)))


def test_page_bundle_requires_core_fields() -> None:
    bundle = PageBundleOut(
        schema_version="1.0",
        runtime_version="1.0.0",
        manifest={"page_id": "page_1"},
        html="<div></div>",
    )
    assert bundle.css == ""
    assert bundle.js == ""
    with pytest.raises(ValidationError):
        PageBundleOut(schema_version="1.0", runtime_version="1.0.0", manifest={})
