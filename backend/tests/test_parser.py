"""解析器标题提取测试（不依赖数据库与外部服务）。"""
from pathlib import Path

from app.services.parser import parse_file


def test_markdown_headings_become_sections(tmp_path: Path) -> None:
    path = tmp_path / "notes.md"
    path.write_text(
        "# 第一章 查找\n\n"
        "无序数组只能线性扫描。\n\n"
        "## 1.1 二分查找\n\n"
        "每次比较后排除一半区间，复杂度 O(log n)。\n",
        encoding="utf-8",
    )

    docs = parse_file(path, "notes.md")

    assert [doc.metadata["heading"] for doc in docs] == ["第一章 查找", "1.1 二分查找"]
    assert [doc.metadata["heading_level"] for doc in docs] == [1, 2]
    assert "线性扫描" in docs[0].page_content
    assert "排除一半区间" in docs[1].page_content


def test_markdown_without_heading_keeps_single_section(tmp_path: Path) -> None:
    path = tmp_path / "plain.md"
    path.write_text("只有正文，没有标题。\n第二行。\n", encoding="utf-8")

    docs = parse_file(path, "plain.md")

    assert len(docs) == 1
    assert docs[0].metadata["heading"] == ""
    assert "只有正文" in docs[0].page_content


def test_text_numbered_heading_is_detected(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text(
        "第一章 绪论\n\n课程介绍与基本概念。\n\n"
        "第二章 线性表\n\n顺序存储与链式存储。\n",
        encoding="utf-8",
    )

    docs = parse_file(path, "notes.txt")

    assert [doc.metadata["heading"] for doc in docs] == ["第一章 绪论", "第二章 线性表"]
    assert all(doc.metadata["heading_level"] == 2 for doc in docs)
