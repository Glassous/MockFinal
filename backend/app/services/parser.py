"""文档解析：PDF / DOCX / PPTX / MD / TXT → langchain Document 列表。

metadata 约定：source（原始文件名）、page（页码/幻灯片序号，从 1 开始，仅分页格式）。
"""
from pathlib import Path

from langchain_core.documents import Document


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


def _parse_pdf(path: Path, filename: str) -> list[Document]:
    import pdfplumber

    docs: list[Document] = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = (page.extract_text() or "").strip()
            if not text:
                # 空文本页跳过（封面/空白页）
                continue
            docs.append(Document(page_content=text, metadata={"source": filename, "page": page_number}))
    if not docs:
        raise ValueError(f"《{filename}》未能提取到任何文本，疑似扫描件，暂不支持")
    return docs


def _parse_docx(path: Path, filename: str) -> list[Document]:
    import docx

    document = docx.Document(str(path))
    parts: list[str] = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            parts.append(text)
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            line = " | ".join(c for c in cells if c)
            if line:
                parts.append(line)
    if not parts:
        raise ValueError(f"《{filename}》内容为空，无法解析")
    return [Document(page_content="\n\n".join(parts), metadata={"source": filename})]


def _parse_pptx(path: Path, filename: str) -> list[Document]:
    from pptx import Presentation

    presentation = Presentation(str(path))
    docs: list[Document] = []
    for slide_number, slide in enumerate(presentation.slides, start=1):
        parts: list[str] = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                if text:
                    parts.append(text)
        if not parts:
            continue
        docs.append(
            Document(page_content="\n".join(parts), metadata={"source": filename, "page": slide_number})
        )
    if not docs:
        raise ValueError(f"《{filename}》未能提取到任何文本，疑似扫描件，暂不支持")
    return docs


def _parse_text(path: Path, filename: str) -> list[Document]:
    text = _decode_text(path.read_bytes()).strip()
    if not text:
        raise ValueError(f"《{filename}》内容为空，无法解析")
    return [Document(page_content=text, metadata={"source": filename})]


_PARSERS = {
    ".pdf": _parse_pdf,
    ".docx": _parse_docx,
    ".pptx": _parse_pptx,
    ".md": _parse_text,
    ".txt": _parse_text,
}


def parse_file(path: Path, filename: str) -> list[Document]:
    """按扩展名分发解析；不支持的格式抛 ValueError（中文可读文案）。"""
    ext = Path(filename).suffix.lower()
    parser = _PARSERS.get(ext)
    if parser is None:
        raise ValueError(f"不支持的文件类型：{ext or '未知'}（仅支持 pdf/docx/pptx/md/txt）")
    return parser(path, filename)
