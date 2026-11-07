"""文档解析：PDF / DOCX / PPTX / MD / TXT → langchain Document 列表。

metadata 约定：
- source：原始文件名；
- page：页码/幻灯片序号（从 1 开始，仅分页格式）；
- heading：章节标题（无标题时为空字符串）；
- heading_level：标题层级（1–6，未知为 0）。

每个 Document 对应一个「章节/页/幻灯片」的正文，后续由 sectioner 按长度细分。
"""
import re
from pathlib import Path

from langchain_core.documents import Document

_ATX_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_NUMBERED_HEADING = re.compile(r"^(第[一二三四五六七八九十百\d]+[章节讲篇]|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+)*[、.\s])")


def _decode_text(data: bytes) -> str:
    """utf-8 优先，charset-normalizer 兜底。"""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        from charset_normalizer import from_bytes

        result = from_bytes(data).best()
        if result is not None:
            return str(result)
    except Exception:  # noqa: BLE001
        pass
    return data.decode("utf-8", errors="replace")


def _looks_like_heading(line: str) -> bool:
    """短行、无句末标点、不是纯数字/符号，视为标题候选。"""
    text = line.strip()
    if not 2 <= len(text) <= 60:
        return False
    if text[-1] in "。！？!?；;，,、：:":
        return False
    return any(ch.isalnum() or "\u4e00" <= ch <= "\u9fff" for ch in text)


def _heading_from_text(text: str) -> str:
    for line in text.splitlines():
        candidate = line.strip()
        if candidate and _looks_like_heading(candidate):
            return candidate[:255]
    return ""


def _make_doc(
    text: str,
    filename: str,
    heading: str = "",
    heading_level: int = 0,
    page: int | None = None,
) -> Document | None:
    text = text.strip()
    if not text:
        return None
    metadata: dict = {
        "source": filename,
        "heading": heading[:255],
        "heading_level": heading_level,
    }
    if page is not None:
        metadata["page"] = page
    return Document(page_content=text, metadata=metadata)


def _parse_pdf(path: Path, filename: str) -> list[Document]:
    import pdfplumber

    docs: list[Document] = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = (page.extract_text() or "").strip()
            if not text:
                # 空文本页跳过（封面/空白页）
                continue
            doc = _make_doc(
                text,
                filename,
                heading=_heading_from_text(text),
                heading_level=1,
                page=page_number,
            )
            if doc is not None:
                docs.append(doc)
    if not docs:
        raise ValueError(f"《{filename}》未能提取到任何文本，疑似扫描件，暂不支持")
    return docs


def _docx_heading_level(paragraph) -> tuple[str, int]:
    """读取段落样式生成标题；兼容英文 Heading N 与中文「标题 N」。"""
    style = getattr(paragraph, "style", None)
    name = (getattr(style, "name", "") or "").strip()
    match = re.search(r"(\d+)\s*$", name)
    level = int(match.group(1)) if match else 0
    text = paragraph.text.strip()
    if not text:
        return "", 0
    lowered = name.lower()
    if lowered.startswith("heading") or name.startswith("标题"):
        return text[:255], level or 1
    if paragraph.style is not None and paragraph.style.name == "Title":
        return text[:255], 1
    return "", 0


def _parse_docx(path: Path, filename: str) -> list[Document]:
    import docx

    document = docx.Document(str(path))
    sections: list[tuple[str, int, list[str]]] = []
    current_heading = ""
    current_level = 0
    current_parts: list[str] = []

    def flush() -> None:
        if current_parts or current_heading:
            sections.append((current_heading, current_level, current_parts.copy()))
        current_parts.clear()

    for paragraph in document.paragraphs:
        heading, level = _docx_heading_level(paragraph)
        if heading:
            flush()
            current_heading, current_level = heading, level
            continue
        text = paragraph.text.strip()
        if text:
            current_parts.append(text)

    for table in document.tables:
        rows: list[str] = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            line = " | ".join(c for c in cells if c)
            if line:
                rows.append(line)
        if rows:
            current_parts.append("\n".join(rows))

    flush()

    docs: list[Document] = []
    for heading, level, parts in sections:
        body = "\n\n".join(parts).strip()
        if not body and heading:
            body = heading
        doc = _make_doc(body, filename, heading=heading, heading_level=level)
        if doc is not None:
            docs.append(doc)
    if not docs:
        raise ValueError(f"《{filename}》内容为空，无法解析")
    return docs


def _parse_pptx(path: Path, filename: str) -> list[Document]:
    from pptx import Presentation

    presentation = Presentation(str(path))
    docs: list[Document] = []
    for slide_number, slide in enumerate(presentation.slides, start=1):
        title = ""
        title_shape = getattr(slide.shapes, "title", None)
        if title_shape is not None and getattr(title_shape, "has_text_frame", False):
            title = title_shape.text_frame.text.strip()

        parts: list[str] = []
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            text = shape.text_frame.text.strip()
            if not text:
                continue
            if title and text == title:
                continue
            parts.append(text)
        if not parts and not title:
            continue
        doc = _make_doc(
            "\n".join(parts) or title,
            filename,
            heading=title[:255],
            heading_level=1,
            page=slide_number,
        )
        if doc is not None:
            docs.append(doc)
    if not docs:
        raise ValueError(f"《{filename}》未能提取到任何文本，疑似扫描件，暂不支持")
    return docs


def _parse_markdown(path: Path, filename: str) -> list[Document]:
    text = _decode_text(path.read_bytes())
    if not text.strip():
        raise ValueError(f"《{filename}》内容为空，无法解析")

    docs: list[Document] = []
    heading = ""
    level = 0
    buffer: list[str] = []

    def flush() -> None:
        body = "\n".join(buffer).strip()
        if body or heading:
            doc = _make_doc(body or heading, filename, heading=heading, heading_level=level)
            if doc is not None:
                docs.append(doc)
        buffer.clear()

    for line in text.splitlines():
        match = _ATX_HEADING.match(line.strip())
        if match:
            flush()
            heading = match.group(2).strip()[:255]
            level = len(match.group(1))
            continue
        buffer.append(line)
    flush()

    if not docs:
        raise ValueError(f"《{filename}》未能提取到有效文本")
    return docs


def _parse_text(path: Path, filename: str) -> list[Document]:
    text = _decode_text(path.read_bytes()).strip()
    if not text:
        raise ValueError(f"《{filename}》内容为空，无法解析")

    blocks = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    sections: list[tuple[str, int, list[str]]] = []
    current_heading = ""
    current_level = 0
    current_parts: list[str] = []

    def flush() -> None:
        if current_parts or current_heading:
            sections.append((current_heading, current_level, current_parts.copy()))
        current_parts.clear()

    for block in blocks:
        lines = block.splitlines()
        first = lines[0].strip() if lines else ""
        if first and _looks_like_heading(first):
            flush()
            current_heading = first[:255]
            current_level = 2 if _NUMBERED_HEADING.match(first) else 1
            body = "\n".join(lines[1:]).strip()
            if body:
                current_parts.append(body)
        else:
            current_parts.append(block)
    flush()

    docs: list[Document] = []
    for heading, level, parts in sections:
        body = "\n\n".join(parts).strip() or heading
        doc = _make_doc(body, filename, heading=heading, heading_level=level)
        if doc is not None:
            docs.append(doc)
    if not docs:
        raise ValueError(f"《{filename}》未能提取到有效文本")
    return docs


_PARSERS = {
    ".pdf": _parse_pdf,
    ".docx": _parse_docx,
    ".pptx": _parse_pptx,
    ".md": _parse_markdown,
    ".txt": _parse_text,
}


def parse_file(path: Path, filename: str) -> list[Document]:
    """按扩展名分发解析；不支持的格式抛 ValueError（中文可读文案）。"""
    ext = Path(filename).suffix.lower()
    parser = _PARSERS.get(ext)
    if parser is None:
        raise ValueError(f"不支持的文件类型：{ext or '未知'}（仅支持 pdf/docx/pptx/md/txt）")
    return parser(path, filename)
