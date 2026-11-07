"""分节纯函数测试：标题继承、长度上限、ordinal 连续性、空内容过滤。"""
from langchain_core.documents import Document

from app.services.sectioner import SECTION_CHUNK_SIZE, docs_to_section_payloads


def test_docs_to_sections_preserves_heading_and_page() -> None:
    docs = [
        Document(
            page_content="二分查找每次把区间折半。" * 300,
            metadata={"source": "algo.pdf", "heading": "二分查找", "heading_level": 2, "page": 7},
        )
    ]

    payloads = docs_to_section_payloads(docs)

    assert len(payloads) > 1
    assert all(payload["heading"] == "二分查找" for payload in payloads)
    assert all(payload["page"] == 7 for payload in payloads)
    assert all(payload["char_count"] == len(payload["content"]) for payload in payloads)
    assert all(len(payload["content"]) <= SECTION_CHUNK_SIZE for payload in payloads)
    assert [payload["ordinal"] for payload in payloads] == list(range(len(payloads)))
    assert payloads[0]["meta"]["part"] == 1
    assert payloads[0]["meta"]["parts"] == len(payloads)


def test_docs_to_sections_skips_empty_and_keeps_ordinal() -> None:
    docs = [
        Document(page_content="   ", metadata={"heading": "空节"}),
        Document(page_content="第一个有效分节", metadata={"heading": "一", "page": 1}),
        Document(page_content="第二个有效分节", metadata={"heading": "二", "page": 2}),
    ]

    payloads = docs_to_section_payloads(docs)

    assert [payload["heading"] for payload in payloads] == ["一", "二"]
    assert [payload["ordinal"] for payload in payloads] == [0, 1]
    assert payloads[0]["meta"]["heading_level"] == 0


def test_short_document_is_one_section() -> None:
    docs = [Document(page_content="短内容", metadata={"source": "a.txt"})]

    payloads = docs_to_section_payloads(docs)

    assert len(payloads) == 1
    assert payloads[0]["content"] == "短内容"
    assert payloads[0]["heading"] == ""
    assert payloads[0]["page"] is None
