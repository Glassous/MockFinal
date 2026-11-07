"""P5 浏览器验收演示数据（仅本地联调，不参与产品流程）。"""
import asyncio
import io
import json
import time
from datetime import datetime, timezone

import httpx

BASE = "http://127.0.0.1:8000"
TAG = str(int(time.time()))[-6:]
USERNAME = "p5demo" + TAG
PASSWORD = "Passw0rd!123"

STYLES = {
    "ready": {
        "preset": "blueprint",
        "content": ["概念定义", "公式推导"],
        "density": "standard",
        "custom_prompt": "多用图示解释。",
    },
    "building": {"preset": "drill", "content": ["易错点"], "density": "standard", "custom_prompt": ""},
    "partial": {"preset": "story", "content": ["例题"], "density": "concise", "custom_prompt": ""},
    "draft": {"preset": "editorial", "content": ["概念定义"], "density": "deep", "custom_prompt": "按讲义节奏。"},
}
TITLES = {
    "ready": "二分、矩阵与时间线",
    "building": "构建中示例",
    "partial": "部分失败示例",
    "draft": "待构建草稿",
}

KP_DEFS = [
    {
        "title": "二分查找：区间不变量",
        "summary": "用区间收缩动画理解二分查找的循环不变式与边界。",
        "importance": "core",
        "difficulty": "medium",
        "objectives": ["写出循环不变式", "解释 mid 取整"],
        "key_points": ["区间折半", "边界条件"],
        "formulas": ["$O(\\log n)$"],
        "misconceptions": ["边界取等号"],
        "interaction_idea": "区间收缩动画",
        "fixture": "bisect",
    },
    {
        "title": "矩阵乘法的几何意义",
        "summary": "把矩阵乘法理解为线性变换的复合。",
        "importance": "normal",
        "difficulty": "hard",
        "objectives": ["理解列向量组合", "逐步推导"],
        "key_points": ["线性组合", "复合变换"],
        "formulas": ["$A\\mathbf{x}$"],
        "misconceptions": ["交换律"],
        "interaction_idea": "网格变换演示",
        "fixture": "matrix",
    },
    {
        "title": "算法发展时间线",
        "summary": "用时间线串联查找算法的发展。",
        "importance": "minor",
        "difficulty": "easy",
        "objectives": ["梳理演进"],
        "key_points": ["线性查找", "二分查找"],
        "formulas": [],
        "misconceptions": [],
        "interaction_idea": "时间线逐步揭示",
        "fixture": "timeline",
    },
]


def thumbnail(index: int) -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (640, 360), "#f4f4f5")
    draw = ImageDraw.Draw(img)
    draw.rectangle([24, 24, 616, 336], outline="#d4d4d8", width=2)
    draw.rectangle([48, 48, 220, 72], fill="#16161a")
    draw.text((56, 52), "PAGE", fill="#ffffff")
    draw.text((48, 120), f"0{index}", fill="#16161a")
    draw.text((48, 300), "MockFinal PageRef", fill="#6b6b73")
    if index == 1:
        draw.line([300, 240, 580, 240], fill="#16161a", width=3)
        draw.line([300, 240, 360, 210], fill="#16161a", width=3)
        draw.line([300, 240, 360, 270], fill="#16161a", width=3)
    elif index == 2:
        for x in range(300, 580, 40):
            draw.line([x, 140, x, 300], fill="#e4e4e7", width=1)
        for y in range(140, 300, 40):
            draw.line([300, y, 580, y], fill="#e4e4e7", width=1)
        draw.rectangle([340, 180, 420, 260], outline="#16161a", width=3)
    else:
        for i, x in enumerate(range(300, 580, 70)):
            draw.ellipse([x, 200, x + 14, 214], fill="#16161a")
            if i < 3:
                draw.line([x + 14, 207, x + 70, 207], fill="#9a9aa2", width=2)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def load_bundle(name: str) -> dict:
    with open(f"/tmp/golden/{name}/bundle.json", encoding="utf-8") as handle:
        return json.load(handle)


async def main() -> None:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import DeckBuildEvent, DeckBuildJob, DeckPage, KnowledgePoint, ReviewDeck
    from app.services import bundle_store

    client = httpx.Client(base_url=BASE, timeout=30)
    client.post(
        "/api/auth/register",
        json={
            "username": USERNAME,
            "password": PASSWORD,
            "security_question": "q",
            "security_answer": "a",
        },
    )
    login = client.post(
        "/api/auth/login", json={"username": USERNAME, "password": PASSWORD}
    ).json()
    token = login["token"]
    user_id = login["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}
    workspace = client.post(
        "/api/workspaces",
        json={"name": "P5 浏览器验收", "description": "P5 阅读器与工作台验收"},
        headers=headers,
    ).json()
    empty_workspace = client.post(
        "/api/workspaces",
        json={"name": "空白工作区", "description": "空态验收"},
        headers=headers,
    ).json()

    deck_ids = {}
    for key, title in TITLES.items():
        deck = client.post(
            f"/api/workspaces/{workspace['id']}/decks",
            json={"title": title, "style": STYLES[key]},
            headers=headers,
        ).json()
        deck_ids[key] = deck["id"]

    fixtures = {name: load_bundle(name) for name in ("bisect", "matrix", "timeline")}

    async with SessionLocal() as db:
        for key, deck_id in deck_ids.items():
            deck = await db.get(ReviewDeck, deck_id)
            deck.source_signature = None
            deck.status = {
                "ready": "ready",
                "building": "building",
                "partial": "partial",
                "draft": "draft",
            }[key]
            chapters = []
            leaf_ids = []
            cursor = 0
            for chapter_index, chapter_title in enumerate(["查找与不变量", "线性变换"]):
                chapter = KnowledgePoint(
                    deck_id=deck.id,
                    parent_id=None,
                    ordinal=chapter_index,
                    title=chapter_title,
                    summary="",
                    importance="normal",
                    difficulty="medium",
                    objectives=[],
                    key_points=[],
                    formulas=[],
                    misconceptions=[],
                    source_refs=[],
                    interaction_idea="",
                )
                db.add(chapter)
                await db.flush()
                defs = KP_DEFS[:2] if chapter_index == 0 else KP_DEFS[2:]
                kp_snapshot = []
                for kp_index, definition in enumerate(defs):
                    row = KnowledgePoint(
                        deck_id=deck.id,
                        parent_id=chapter.id,
                        ordinal=kp_index,
                        title=definition["title"],
                        summary=definition["summary"],
                        importance=definition["importance"],
                        difficulty=definition["difficulty"],
                        objectives=definition["objectives"],
                        key_points=definition["key_points"],
                        formulas=definition["formulas"],
                        misconceptions=definition["misconceptions"],
                        source_refs=[
                            {
                                "material_id": 0,
                                "section_id": 101 + cursor,
                                "heading": chapter_title,
                                "quote": definition["summary"],
                                "unverified": False,
                            }
                        ],
                        interaction_idea=definition["interaction_idea"],
                    )
                    db.add(row)
                    await db.flush()
                    leaf_ids.append(row.id)
                    kp_snapshot.append(
                        {
                            "title": row.title,
                            "summary": row.summary,
                            "importance": row.importance,
                            "difficulty": row.difficulty,
                            "objectives": row.objectives,
                            "key_points": row.key_points,
                            "formulas": row.formulas,
                            "misconceptions": row.misconceptions,
                            "section_ids": [101 + cursor],
                            "interaction_idea": row.interaction_idea,
                            "page_count": 1,
                        }
                    )
                    cursor += 1
                chapters.append({"title": chapter_title, "knowledge_points": kp_snapshot})

            deck.outline = {
                "chapters": chapters,
                "page_plan": [
                    {
                        "ordinal": index,
                        "title": KP_DEFS[index]["title"],
                        "kind": "interactive" if index < 2 else "concept",
                        "kp_indices": [index],
                        "primary_kp_index": index,
                    }
                    for index in range(3)
                ],
                "density": STYLES[key]["density"],
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "unverified_knowledge_points": 0,
            }

            if key == "ready":
                page_defs = list(zip(leaf_ids, ("ready",) * 3, ("bisect", "matrix", "timeline")))
            elif key == "building":
                page_defs = [
                    (leaf_ids[0], "ready", "timeline"),
                    (leaf_ids[1], "building", None),
                    (leaf_ids[2], "planned", None),
                ]
            elif key == "partial":
                page_defs = [
                    (leaf_ids[0], "ready", "bisect"),
                    (leaf_ids[1], "failed", None),
                    (leaf_ids[2], "ready", "matrix"),
                ]
            else:
                page_defs = []

            pages = []
            for ordinal, (kp_id, status, fixture) in enumerate(page_defs):
                page = DeckPage(
                    deck_id=deck.id,
                    knowledge_point_ids=[kp_id],
                    primary_knowledge_point_id=kp_id,
                    ordinal=ordinal,
                    title=KP_DEFS[ordinal]["title"],
                    kind="interactive" if ordinal < 2 else "concept",
                    status=status,
                    current_version=0,
                    manifest={},
                    validation={},
                    build_attempts=1,
                )
                db.add(page)
                await db.flush()
                pages.append(page)
                if fixture:
                    bundle = json.loads(json.dumps(fixtures[fixture]))
                    bundle["manifest"]["page_id"] = f"page_{page.id}"
                    page.current_version = 1
                    page.bundle_key = await bundle_store.save_bundle(
                        user_id=user_id,
                        workspace_id=workspace["id"],
                        deck_id=deck.id,
                        page_id=page.id,
                        version=1,
                        bundle=bundle,
                    )
                    page.thumbnail_key = await bundle_store.save_thumbnail(
                        user_id=user_id,
                        workspace_id=workspace["id"],
                        deck_id=deck.id,
                        page_id=page.id,
                        version=1,
                        image=thumbnail(ordinal + 1),
                    )
                    page.manifest = bundle["manifest"]
                    page.validation = {"status": "passed", "issue_count": 0}
                    page.builder_build_id = f"bld_demo_{page.id}"

            if key in ("ready", "building", "partial"):
                if key == "ready":
                    status, progress, ready_pages, failed_pages = "done", 100, 3, 0
                    stage = "构建完成"
                elif key == "building":
                    status, progress, ready_pages, failed_pages = "building", 35, 1, 0
                    stage = "正在构建第 2 个页面…"
                else:
                    status, progress, ready_pages, failed_pages = "partial", 100, 2, 1
                    stage = "构建结束：1 个页面失败"
                job = DeckBuildJob(
                    deck_id=deck.id,
                    workspace_id=workspace["id"],
                    status=status,
                    stage=stage,
                    progress=progress,
                    total_pages=3,
                    ready_pages=ready_pages,
                    failed_pages=failed_pages,
                    error="页面最终校验未通过：布局溢出（1280×720）"
                    if key == "partial"
                    else None,
                    started_at=datetime.now(timezone.utc),
                    finished_at=None if key == "building" else datetime.now(timezone.utc),
                )
                db.add(job)
                await db.flush()
                events = [
                    ("stage", None, {"text": "开始读取资料分节…"}),
                    ("text", None, {"message": "规划完成：2 章、3 个知识点、3 个页面计划。"}),
                    ("stage", None, {"text": "开始逐页构建页面…"}),
                ]
                for page in pages:
                    if page.status == "ready":
                        events.append(
                            ("page_ready", page.id, {"message": f"第 {page.ordinal + 1} 页已通过校验"})
                        )
                        events.append(
                            ("validation", page.id, {"status": "passed", "issue_count": 0})
                        )
                    elif page.status == "building":
                        events.append(("text", page.id, {"message": "正在编写动画与布局…"}))
                    elif page.status == "failed":
                        events.append(
                            ("error", page.id, {"message": "页面最终校验未通过：布局溢出（1280×720）"})
                        )
                        events.append(("retry", page.id, {"message": "第 2 次尝试仍失败，已标记失败"}))
                if key != "building":
                    events.append(("stage", None, {"text": stage}))
                for event_type, page_id, payload in events:
                    db.add(
                        DeckBuildEvent(
                            job_id=job.id,
                            page_id=page_id,
                            type=event_type,
                            payload=payload,
                        )
                    )
                if key in ("ready", "partial"):
                    deck.last_page_id = pages[0].id
                    deck.completed_page_ids = [pages[0].id]
            await db.commit()

    print(
        json.dumps(
            {
                "username": USERNAME,
                "password": PASSWORD,
                "workspace_id": workspace["id"],
                "empty_workspace_id": empty_workspace["id"],
                "decks": deck_ids,
                "user_id": user_id,
            },
            ensure_ascii=True,
        )
    )


asyncio.run(main())