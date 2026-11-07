"""P6 浏览器验收夹具：为 P5 演示页补齐 manifest 引用的来源分节。

仅本地演示使用；幂等，可重复执行：
    docker exec -w /app -e PYTHONPATH=/app mockfinal-api-p6 \
        python tests/fixtures/p6_seed.py
"""
import asyncio
import os

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Material, MaterialSection

WORKSPACE_ID = int(os.getenv("P6_WORKSPACE_ID", "8"))
SECTIONS = [
    (
        102,
        "闭区间写法与循环不变式",
        "循环不变式是：若目标存在，其下标一定在闭区间 [left, right] 内。"
        "每次比较后区间折半，mid 向下取整，因此不会漏掉边界元素。",
    ),
    (
        103,
        "复杂度、边界与常见错误",
        "二分查找每次把搜索区间折半，时间复杂度为 O(log n)，额外空间为 O(1)。"
        "常见错误是 while 条件漏掉等号，或 mid 取整方式导致死循环。",
    ),
]


async def main() -> None:
    ids = [section_id for section_id, _, _ in SECTIONS]
    async with SessionLocal() as db:
        rows = await db.execute(select(MaterialSection).where(MaterialSection.id.in_(ids)))
        existing = {section.id for section in rows.scalars().all()}
        missing = [item for item in SECTIONS if item[0] not in existing]
        if not missing:
            print("P6 seed 已存在，跳过")
            return

        material = Material(
            workspace_id=WORKSPACE_ID,
            filename="P6 页面助手演示资料.md",
            storage_key=f"mockfinal/p6-demo/{WORKSPACE_ID}/p6-demo.md",
            size=2048,
            content_type="text/markdown",
            status="indexed",
            chunk_count=len(SECTIONS),
        )
        db.add(material)
        await db.flush()
        for section_id, heading, content in missing:
            db.add(
                MaterialSection(
                    id=section_id,
                    material_id=material.id,
                    workspace_id=WORKSPACE_ID,
                    ordinal=section_id - 102,
                    heading=heading,
                    content=content,
                    char_count=len(content),
                    meta={"source": "p6-acceptance"},
                )
            )
        await db.commit()
        print(f"P6 seed 写入 {len(missing)} 个分节，material_id={material.id}")


if __name__ == "__main__":
    asyncio.run(main())
