"""P8 基线统计（只读）。

从已生成的 bundle 与历史构建结果中统计单页内容密度、构建耗时与已知用量，
输出 `docs/pageref/P8_BASELINE.json` 与 `P8_BASELINE.md`，作为 PageRef v2 的对比基线。

用法（仓库根目录）：
    python backend/tests/fixtures/p8_baseline.py
    python backend/tests/fixtures/p8_baseline.py --deck-dir backend/data/mockfinal/11/8/decks/18

说明：
- 只读取文件，不连接数据库、不调用模型、不修改业务数据；
- 正文口径为 HTML 文本中的汉字数（去掉脚本/样式/标签后统计 `[\\u4e00-\\u9fff]`）；
- 可见块为 `[data-mp-block]` 中未标记 `hidden` / `data-mp-state="hidden"` 的元素（静态近似）；
- 历史 14 页 E2E 没有逐页 token，只有 P2 的 3 页有 usage；缺失项如实留空。
"""
from __future__ import annotations

import argparse
import html
import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
SCRIPT_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
BLOCK_OPEN_RE = re.compile(r"<[^>]*\bdata-mp-block\b[^>]*>", re.IGNORECASE)
LEGACY_BLOCK_RE = re.compile(
    r"<(?:section|aside)\b[^>]*>|<div\b[^>]*class\s*=\s*\"[^\"]*\bmp-card\b[^\"]*\"", re.IGNORECASE
)
ACTION_ATTR_RE = re.compile(r"\bdata-mp-action\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
HIDDEN_ATTR_RE = re.compile(
    r"\bhidden\b|\bdata-mp-state\s*=\s*[\"']hidden[\"']|\bstyle\s*=\s*[\"'][^\"']*display\s*:\s*none",
    re.IGNORECASE,
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def text_of(document: str) -> str:
    stripped = SCRIPT_RE.sub(" ", document)
    stripped = COMMENT_RE.sub(" ", stripped)
    stripped = TAG_RE.sub(" ", stripped)
    return re.sub(r"\s+", " ", html.unescape(stripped)).strip()


def measure_bundle(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    manifest = payload.get("manifest") or {}
    html_text = payload.get("html") or ""
    css = payload.get("css") or ""
    js = payload.get("js") or ""
    plain = text_of(html_text)
    blocks = BLOCK_OPEN_RE.findall(html_text)
    if blocks:
        block_metric = "data-mp-block"
        visible_blocks = [block for block in blocks if not HIDDEN_ATTR_RE.search(block)]
    else:
        # 1.0 页面用 section/aside/mp-card 组织内容，无 data-mp-block；按结构元素近似
        block_metric = "legacy-structural"
        legacy_blocks = LEGACY_BLOCK_RE.findall(html_text)
        blocks = legacy_blocks
        visible_blocks = legacy_blocks
    actions = ACTION_ATTR_RE.findall(html_text)
    teaching = manifest.get("teaching")
    interactions = manifest.get("interactions") or []
    return {
        "path": str(path.relative_to(repo_root())).replace("\\", "/"),
        "schema_version": payload.get("schema_version"),
        "runtime_version": payload.get("runtime_version"),
        "page_id": manifest.get("page_id"),
        "title": manifest.get("title"),
        "importance": manifest.get("importance"),
        "cjk_chars": len(CJK_RE.findall(plain)),
        "text_chars": len(plain),
        "visible_blocks": len(visible_blocks),
        "total_blocks": len(blocks),
        "block_metric": block_metric,
        "interactions": len(interactions),
        "html_actions": len(set(actions)),
        "has_teaching": isinstance(teaching, dict) and bool(teaching),
        "teaching_checks": len((teaching or {}).get("check") or []) if isinstance(teaching, dict) else 0,
        "css_bytes": len(css.encode("utf-8")),
        "js_bytes": len(js.encode("utf-8")),
        "html_bytes": len(html_text.encode("utf-8")),
        "bundle_bytes": path.stat().st_size,
    }


def pick_deck(bundles: list[Path], deck_dir: str | None) -> tuple[str, list[Path]]:
    if deck_dir:
        root = Path(deck_dir)
        if root.is_absolute():
            root = root.resolve()
        else:
            root = (repo_root() / root).resolve()
        found = sorted(root.rglob("bundle.json"))
        try:
            label = str(root.relative_to(repo_root())).replace("\\", "/")
        except ValueError:
            label = str(root)
        return label, found
    groups: dict[str, list[Path]] = {}
    for path in bundles:
        # .../decks/{deck_id}/pages/{page_id}/v{n}/bundle.json
        label = str(path.parents[3])
        groups.setdefault(label, []).append(path)
    label, found = max(groups.items(), key=lambda item: len(item[1]))
    try:
        label = str(Path(label).resolve().relative_to(repo_root())).replace("\\", "/")
    except ValueError:
        pass
    return label, sorted(found)


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def median(values: list[float]) -> float:
    return round(statistics.median(values), 2) if values else 0


def mean(values: list[float]) -> float:
    return round(statistics.fmean(values), 2) if values else 0


def aggregate(pages: list[dict[str, Any]]) -> dict[str, Any]:
    def values(key: str) -> list[float]:
        return [float(page[key]) for page in pages if isinstance(page.get(key), (int, float))]

    return {
        "pages": len(pages),
        "schemas": sorted({str(page.get("schema_version")) for page in pages}),
        "runtimes": sorted({str(page.get("runtime_version")) for page in pages}),
        "teaching_pages": sum(1 for page in pages if page.get("has_teaching")),
        "cjk_chars": {
            "median": median(values("cjk_chars")),
            "mean": mean(values("cjk_chars")),
            "min": min(values("cjk_chars"), default=0),
            "max": max(values("cjk_chars"), default=0),
        },
        "visible_blocks": {
            "median": median(values("visible_blocks")),
            "min": min(values("visible_blocks"), default=0),
            "max": max(values("visible_blocks"), default=0),
        },
        "total_blocks": {
            "median": median(values("total_blocks")),
            "min": min(values("total_blocks"), default=0),
            "max": max(values("total_blocks"), default=0),
        },
        "interactions": {
            "median": median(values("interactions")),
            "min": min(values("interactions"), default=0),
            "max": max(values("interactions"), default=0),
        },
        "css_bytes": {"median": median(values("css_bytes")), "mean": mean(values("css_bytes"))},
        "js_bytes": {"median": median(values("js_bytes")), "mean": mean(values("js_bytes"))},
        "html_bytes": {"median": median(values("html_bytes")), "mean": mean(values("html_bytes"))},
    }


def render_markdown(report: dict[str, Any]) -> str:
    agg = report["aggregate"]
    lines = [
        "# P8 · PageRef v2 基线（只读统计）",
        "",
        f"> 生成时间：{report['generated_at']}；数据源：`{report['deck']}`。",
        "> 本报告只统计已生成 bundle 与历史结果文件，不调用模型、不修改数据。",
        "",
        "## 1. 样本",
        "",
        f"- 页面数：{agg['pages']}",
        f"- Bundle 契约：{', '.join(agg['schemas'])}；Runtime：{', '.join(agg['runtimes'])}",
        f"- 含 `manifest.teaching` 的页面：{agg['teaching_pages']} / {agg['pages']}",
        "",
        "## 2. 内容密度（正文汉字数）",
        "",
        "| 指标 | 中位数 | 均值 | 最小 | 最大 |",
        "| --- | --- | --- | --- | --- |",
        f"| 正文汉字 | {agg['cjk_chars']['median']} | {agg['cjk_chars']['mean']} | {agg['cjk_chars']['min']} | {agg['cjk_chars']['max']} |",
        f"| 可见块 | {agg['visible_blocks']['median']} | - | {agg['visible_blocks']['min']} | {agg['visible_blocks']['max']} |",
        f"| 页内总块 | {agg['total_blocks']['median']} | - | {agg['total_blocks']['min']} | {agg['total_blocks']['max']} |",
        f"| 主交互 | {agg['interactions']['median']} | - | {agg['interactions']['min']} | {agg['interactions']['max']} |",
        "",
        "| 资源 | 中位数 | 均值 |",
        "| --- | --- | --- |",
        f"| CSS | {agg['css_bytes']['median']} B | {agg['css_bytes']['mean']} B |",
        f"| JS | {agg['js_bytes']['median']} B | {agg['js_bytes']['mean']} B |",
        f"| HTML | {agg['html_bytes']['median']} B | {agg['html_bytes']['mean']} B |",
        "",
        "## 3. 逐页数据",
        "",
        "| # | 页面 | 汉字 | 可见/总块 | 交互 | CSS B | JS B | 教学 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for index, page in enumerate(report["pages"], start=1):
        lines.append(
            f"| {index} | {page.get('title') or page.get('page_id')} | {page['cjk_chars']} | "
            f"{page['visible_blocks']}/{page['total_blocks']} | {page['interactions']} | "
            f"{page['css_bytes']} | {page['js_bytes']} | {'有' if page['has_teaching'] else '无'} |"
        )
    lines += [
        "",
        "## 4. 构建成本与耗时（历史结果）",
        "",
    ]
    e2e = report.get("e2e") or {}
    if e2e:
        job = e2e.get("job") or {}
        cost = e2e.get("cost") or {}
        lines += [
            f"- 14 页真实 E2E：{job.get('ready_pages', '?')}/{job.get('total_pages', '?')} 页 ready，"
            f"{job.get('duration_seconds', '?')} 秒，成本 ¥{cost.get('e2e_cny', '?')}（DeepSeek Flash，2026-11-07）。",
            "- 该次构建没有逐页 token/成本；自 P8 起 Builder `usage` 增加 cache/cost 字段，"
            "主 API 的 `deck_build_jobs.usage` 按 build_id 记录每次尝试的用量。",
        ]
    else:
        lines.append("- 未找到历史 E2E 结果文件。")
    p2 = report.get("p2_usage") or []
    if p2:
        lines += [
            "",
            "| P2 页面 | 输入 token | 输出 token | 耗时 ms |",
            "| --- | --- | --- | --- |",
        ]
        for page in p2:
            usage = page.get("usage") or {}
            lines.append(
                f"| {page.get('page_id')} | {usage.get('input_tokens', 0)} | "
                f"{usage.get('output_tokens', 0)} | {usage.get('duration_ms', 0)} |"
            )
        lines.append("")
        lines.append(
            "> 基线输入约 20.7k–22.4k token/页、输出 13.1k–26.5k token/页；P11 以同口径对比 cache 命中与成本。"
        )
    lines += [
        "",
        "## 5. 观察与后续",
        "",
        "- 页面正文中位数远低于 250–500 字（见上表），且没有检查题与教学结构；"
        "P9/P10 需把“角色、目标、讲解链、检查”变成可校验契约。",
        f"- 块数口径：{'data-mp-block' if report['pages'] and report['pages'][0].get('block_metric') == 'data-mp-block' else 'legacy-structural（section/aside/mp-card）'}；"
        "新页面统一使用 `[data-mp-block]`，基线以本表为准。",
        "- 每页 CSS 5–6KB、HTML 3–4KB，重复造轮子明显；P10 由 Shell 注入 DECK_KIT_CSS 后应以 ≤6KB CSS 为目标观察下降。",
        "- 当前 bundle 无 `manifest.teaching`，P12 学习面板必须对旧页面降级，不得伪造目标。",
        "- 基线截图与交互断言沿用 `docs/pageref/p5-screenshots/`、`p6-screenshots/` 与 `P5_RESULTS.json`、`P6_RESULTS.json`；"
        "P12 更新验收脚本后重新生成。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="P8 基线统计（只读）")
    parser.add_argument("--bundles-root", default="backend/data/mockfinal")
    parser.add_argument("--deck-dir", default=None)
    parser.add_argument("--e2e", default="docs/pageref/P4_REAL_E2E.json")
    parser.add_argument("--p2", default="docs/pageref/P2_RESULTS.json")
    parser.add_argument("--out-dir", default="docs/pageref")
    args = parser.parse_args()

    root = repo_root()
    bundles_root = Path(args.bundles_root)
    if not bundles_root.is_absolute():
        bundles_root = root / bundles_root
    all_bundles = sorted(bundles_root.rglob("bundle.json")) if bundles_root.exists() else []
    if not all_bundles:
        print(f"未找到任何 bundle：{bundles_root}", file=sys.stderr)
        return 1
    deck_label, bundle_paths = pick_deck(all_bundles, args.deck_dir)
    pages = [measure_bundle(path) for path in bundle_paths]

    e2e_path = Path(args.e2e)
    if not e2e_path.is_absolute():
        e2e_path = root / e2e_path
    e2e = load_json(e2e_path)
    e2e_pages = {str(page.get("id")): page for page in e2e.get("pages") or []}
    for page in pages:
        numeric = "".join(ch for ch in str(page.get("page_id") or "") if ch.isdigit())
        match = e2e_pages.get(numeric)
        if match:
            page["e2e"] = {
                "status": match.get("status"),
                "attempts": match.get("attempts"),
                "validation_status": match.get("validation_status"),
                "validation_duration_ms": match.get("validation_duration_ms"),
            }

    p2_path = Path(args.p2)
    if not p2_path.is_absolute():
        p2_path = root / p2_path
    p2 = load_json(p2_path)
    p2_usage = [
        {
            "page_id": page.get("page_id"),
            "status": page.get("status"),
            "usage": page.get("usage"),
        }
        for page in p2.get("pages") or []
        if isinstance(page, dict)
    ]

    from datetime import datetime, timezone

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "deck": deck_label,
        "pages": pages,
        "aggregate": aggregate(pages),
        "e2e": e2e,
        "p2_usage": p2_usage,
    }
    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = root / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "P8_BASELINE.json"
    md_path = out_dir / "P8_BASELINE.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    print(f"已写入 {json_path.relative_to(root)} 与 {md_path.relative_to(root)}（{len(pages)} 页）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
