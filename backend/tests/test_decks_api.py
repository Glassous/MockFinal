"""Deck P4 集成测试：真实编排 + 假 Builder/Validator（httpx.MockTransport）。

默认跳过；需显式提供独立 Postgres 测试库后执行：

    P4_INTEGRATION=1 DATABASE_URL=postgresql+psycopg://.../mockfinal_p4_test \
    PAGE_BUILDER_URL=http://builder.test PAGE_BUILDER_TOKEN=test \
    PAGE_VALIDATOR_URL=http://validator.test PAGE_VALIDATOR_TOKEN=test \
    pytest tests/test_decks_api.py

- 不依赖真实 LLM：`build_outline` 与 `plan_pages` 由 monkeypatch 固定；
- 不依赖 docker builder/validator：用 httpx.MockTransport 模拟内部 HTTP 语义
  （HMAC 由真实客户端生成，假服务只按路径返回 202/200/409）；
- 覆盖：首次构建 2 页（1 成功 1 失败 → partial）、Validator 失败重试、取消、
  单页重建、rebuild_all 保留旧版本、bundle/thumbnail API、归属 404、Builder 不可用 fail-closed；
  12 页构建（并发 2、单页失败隔离、客户端断线重连、失败页重试后整册收敛为 ready）。
"""
import asyncio
import base64
import json
import os
import re
import uuid

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("P4_INTEGRATION") != "1",
    reason="P4 集成测试需要独立 Postgres 测试库（P4_INTEGRATION=1 + DATABASE_URL）",
)

PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(
    base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
).decode("ascii")


if os.getenv("P4_INTEGRATION") == "1":
    from sqlalchemy import func, select

    from app.config import settings
    from app.database import SessionLocal, engine
    from app.main import app
    from app.models import (
        Base,
        DeckBuildEvent,
        DeckBuildJob,
        DeckPage,
        KnowledgePoint,
        Material,
        MaterialSection,
        ReviewDeck,
    )
    from app.services import deck_builder, page_chat
    from app.services.page_builder_client import PageBuilderClient
    from app.services.page_validator import PageValidatorClient


# ===== 假 Builder / Validator =====
class FakeBuilder:
    """按 INTERNAL_API 语义模拟 Builder：202 创建、轮询 running→succeeded/failed、增量事件。"""

    def __init__(self) -> None:
        self.builds: dict[str, dict] = {}
        self.create_requests: list[dict] = []
        self.canceled: list[str] = []
        self.unavailable = False
        self.hang = False
        self.fail_keywords: list[str] = []

    def _bundle(self, page_id: str, title: str) -> dict:
        return {
            "schema_version": "1.0",
            "runtime_version": "1.0.0",
            "manifest": {
                "schema_version": "1.0",
                "page_id": page_id,
                "title": title,
                "knowledge_point_ids": ["kp_test"],
                "importance": "core",
                "estimated_minutes": 3,
                "layout": "focus",
                "interactions": [],
                "source_refs": [],
                "a11y": {"reduced_motion": True},
            },
            "html": f"<div class=\"mp-page\">{title}</div>",
            "css": ".mp-page { height: 100dvh; }",
            "js": "MockFinal.ready({});",
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.unavailable:
            return httpx.Response(
                503,
                json={"detail": "页面构建服务暂时不可用，请稍后重试", "code": "BUILDER_UNAVAILABLE"},
            )
        path = request.url.path
        if request.method == "POST" and path == "/v1/builds":
            body = json.loads(request.content or b"{}")
            build_id = body["build_id"]
            page_id = body["page_brief"]["page_id"]
            title = body["page_brief"]["knowledge_point"]["title"]
            self.create_requests.append(body)
            self.builds[build_id] = {
                "page_id": page_id,
                "title": title,
                "polls": 0,
                "canceled": False,
                "events": [
                    {
                        "seq": 1,
                        "type": "stage",
                        "payload": {"text": "Pi 会话已启动，开始构建页面"},
                        "at": "2026-11-07T05:00:00Z",
                    },
                    {
                        "seq": 2,
                        "type": "text",
                        "payload": {"text": "正在搭建页面结构与动画"},
                        "at": "2026-11-07T05:00:01Z",
                    },
                    {
                        "seq": 3,
                        "type": "tool",
                        "payload": {"text": "写入 page.js"},
                        "at": "2026-11-07T05:00:02Z",
                    },
                ],
            }
            return httpx.Response(202, json={"build_id": build_id, "status": "queued"})

        match = re.search(r"/v1/builds/([^/]+)(/events|/bundle|/cancel)?$", path)
        if not match:
            return httpx.Response(404, json={"detail": "接口不存在", "code": "NOT_FOUND"})
        build_id = match.group(1)
        action = match.group(2) or ""
        state = self.builds.get(build_id)
        if state is None:
            return httpx.Response(
                404, json={"detail": "构建任务不存在或已过期", "code": "BUILD_NOT_FOUND"}
            )

        if action == "/events":
            after = int(request.url.params.get("after_seq", "0"))
            events = [event for event in state["events"] if event["seq"] > after]
            next_seq = state["events"][-1]["seq"] if state["events"] else after
            return httpx.Response(
                200,
                json={
                    "events": events,
                    "next_seq": next_seq,
                    "finished": state["polls"] >= 2 or state["canceled"],
                },
            )
        if action == "/cancel":
            state["canceled"] = True
            self.canceled.append(build_id)
            return httpx.Response(202, json={"build_id": build_id, "status": "canceled"})
        if action == "/bundle":
            if state["polls"] < 2 and not state["canceled"]:
                return httpx.Response(
                    409, json={"detail": "构建尚未成功", "code": "BUILD_NOT_READY"}
                )
            return httpx.Response(
                200,
                json={
                    "build_id": build_id,
                    "bundle": self._bundle(state["page_id"], state["title"]),
                    "validation": {"status": "passed", "issues": []},
                },
            )

        state["polls"] += 1
        if self.hang:
            status = "canceled" if state["canceled"] else "running"
        elif any(keyword in state["title"] for keyword in self.fail_keywords):
            status = "failed"
        else:
            status = "running" if state["polls"] <= 1 else "succeeded"
        if state["polls"] == 1 and not self.hang:
            state["events"].append(
                {
                    "seq": 4,
                    "type": "check",
                    "payload": {"text": "页面自检：未发现阻断问题"},
                    "at": "2026-11-07T05:00:03Z",
                }
            )
        return httpx.Response(
            200,
            json={
                "build_id": build_id,
                "status": "canceled" if state["canceled"] else status,
                "stage": "正在构建页面",
                "attempts": 1,
                "error": "页面构建失败：交互冒烟未通过" if status == "failed" else None,
                "events_cursor": len(state["events"]),
                "usage": {
                    "input_tokens": 1000,
                    "output_tokens": 500,
                    "cache_read_tokens": 200,
                    "cache_write_tokens": 100,
                    "cost": 0.01,
                    "duration_ms": 1200,
                },
            },
        )


class FakeValidator:
    """按 INTERNAL_API §4 返回 passed/failed；可配置整体失败或首轮失败。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.always_fail = False
        self.fail_titles: set[str] = set()
        self.fail_once_titles: set[str] = set()
        self.unavailable = False
        self.failed_once: set[str] = set()

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.unavailable:
            return httpx.Response(
                503,
                json={"detail": "浏览器环境无法启动", "code": "BROWSER_UNAVAILABLE"},
            )
        body = json.loads(request.content or b"{}")
        bundle = body.get("bundle") or {}
        manifest = bundle.get("manifest") or {}
        page_id = str(manifest.get("page_id") or "")
        title = str(manifest.get("title") or "")
        self.calls.append(
            {
                "page_id": page_id,
                "title": title,
                "screenshot": body.get("screenshot"),
                "viewports": body.get("viewports"),
            }
        )
        should_fail = self.always_fail or title in self.fail_titles
        if title in self.fail_once_titles and page_id not in self.failed_once:
            self.failed_once.add(page_id)
            should_fail = True
        if should_fail:
            return httpx.Response(
                200,
                json={
                    "status": "failed",
                    "issues": [
                        {
                            "severity": "error",
                            "code": "ZERO_SCROLL_OVERFLOW",
                            "message": "1280x720 视口出现纵向溢出，内容超出 100dvh",
                            "selector": ".mp-page",
                            "viewport": "1280x720",
                        }
                    ],
                    "screenshots": [],
                    "duration_ms": 15,
                },
            )
        return httpx.Response(
            200,
            json={
                "status": "passed",
                "issues": [],
                "screenshots": [{"viewport": "1280x720", "data_uri": PNG_DATA_URI}],
                "duration_ms": 20,
            },
        )


def _outline_for(material_index: list[dict], kps_per_chapter: int = 2) -> dict:
    """固定 3 章的合法大纲（默认 6 个知识点，不调用 LLM）。"""
    section_ids = [
        int(section["id"])
        for material in material_index
        for section in material.get("sections", [])
    ] or [1]
    chapters = []
    for chapter_index in range(3):
        knowledge_points = []
        for kp_index in range(kps_per_chapter):
            global_index = chapter_index * 2 + kp_index
            knowledge_points.append(
                {
                    "title": f"知识点 {chapter_index + 1}-{kp_index + 1}",
                    "summary": f"第 {global_index + 1} 个知识点摘要",
                    "importance": "core" if global_index == 0 else "normal",
                    "difficulty": "medium",
                    "objectives": ["掌握概念"],
                    "key_points": ["要点一", "要点二"],
                    "formulas": [],
                    "misconceptions": [],
                    "section_ids": [section_ids[global_index % len(section_ids)]],
                    "interaction_idea": "用动画演示区间收缩" if global_index == 0 else "",
                    "page_count": 1,
                }
            )
        chapters.append(
            {"title": f"第 {chapter_index + 1} 章", "knowledge_points": knowledge_points}
        )
    return {"chapters": chapters}


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in text.strip().split("\n\n"):
        name = "message"
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[len("event: ") :]
            elif line.startswith("data: "):
                data_lines.append(line[len("data: ") :])
        if data_lines:
            events.append((name, json.loads("\n".join(data_lines))))
    return events


def _two_page_plans(chapters, density) -> list[dict]:
    return [
        {
            "primary_kp_index": 0,
            "kp_indices": [0],
            "title": "第一页",
            "kind": "interactive",
            "ordinal": 0,
        },
        {
            "primary_kp_index": 1,
            "kp_indices": [1],
            "title": "第二页",
            "kind": "concept",
            "ordinal": 1,
        },
    ]


def _twelve_page_plans(chapters, density) -> list[dict]:
    return [
        {
            "primary_kp_index": index,
            "kp_indices": [index],
            "title": f"第 {index + 1} 页",
            "kind": "interactive" if index % 3 == 0 else "concept",
            "ordinal": index,
        }
        for index in range(12)
    ]


if os.getenv("P4_INTEGRATION") == "1":

    @pytest.fixture(autouse=True)
    def _configured_services(monkeypatch, tmp_path) -> None:
        """自包含配置：占位 LLM + 假 Builder/Validator 地址与 token（不发真实请求）。"""
        monkeypatch.setattr(settings, "llm_api_key", "test-placeholder")
        monkeypatch.setattr(settings, "llm_base_url", "http://127.0.0.1:9")
        monkeypatch.setattr(settings, "page_builder_url", "http://builder.test")
        monkeypatch.setattr(settings, "page_builder_token", "builder-token")
        monkeypatch.setattr(settings, "page_validator_url", "http://validator.test")
        monkeypatch.setattr(settings, "page_validator_token", "validator-token")
        # 隔离对象存储：测试 bundle/缩略图写入临时目录，不污染 backend/data
        monkeypatch.setattr(settings, "local_storage_dir", tmp_path / "storage")
        # 测试用更短的轮询间隔，避免每页等待 0.6s
        monkeypatch.setattr(deck_builder, "EVENT_POLL_INTERVAL_SECONDS", 0.01)

    def _install_fakes(monkeypatch) -> tuple[FakeBuilder, FakeValidator]:
        builder = FakeBuilder()
        validator = FakeValidator()
        monkeypatch.setattr(
            deck_builder,
            "make_builder_client",
            lambda: PageBuilderClient(
                base_url="http://builder.test",
                token="builder-token",
                transport=httpx.MockTransport(builder.handler),
            ),
        )
        monkeypatch.setattr(
            deck_builder,
            "make_validator_client",
            lambda: PageValidatorClient(
                base_url="http://validator.test",
                token="validator-token",
                transport=httpx.MockTransport(validator.handler),
            ),
        )
        return builder, validator

    async def _register(client: httpx.AsyncClient) -> dict:
        username = f"p4_{uuid.uuid4().hex[:10]}"
        response = await client.post(
            "/api/auth/register",
            json={
                "username": username,
                "password": "secret123",
                "security_question": "测试问题？",
                "security_answer": "测试答案",
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    async def _create_workspace_and_deck(
        client: httpx.AsyncClient, headers: dict, name: str
    ) -> tuple[int, int]:
        workspace_response = await client.post(
            "/api/workspaces", json={"name": name, "description": "数据结构"}, headers=headers
        )
        assert workspace_response.status_code == 200, workspace_response.text
        workspace_id = workspace_response.json()["id"]
        async with SessionLocal() as db:
            material = Material(
                workspace_id=workspace_id,
                filename="algo.md",
                storage_key="mockfinal/test/algo.md",
                size=10,
                content_type="text/markdown",
                status="indexed",
                chunk_count=2,
            )
            db.add(material)
            await db.flush()
            db.add_all(
                [
                    MaterialSection(
                        material_id=material.id,
                        workspace_id=workspace_id,
                        ordinal=0,
                        heading="二分查找",
                        content="二分查找每次把搜索区间折半，时间复杂度 O(log n)。" * 10,
                        char_count=300,
                    ),
                    MaterialSection(
                        material_id=material.id,
                        workspace_id=workspace_id,
                        ordinal=1,
                        heading="动态规划",
                        content="动态规划依赖最优子结构与状态转移方程。" * 10,
                        char_count=250,
                    ),
                ]
            )
            await db.commit()
        deck_response = await client.post(
            f"/api/workspaces/{workspace_id}/decks",
            json={"style": {"preset": "blueprint", "density": "standard"}},
            headers=headers,
        )
        assert deck_response.status_code == 200, deck_response.text
        return workspace_id, deck_response.json()["id"]

    async def _wait_job(client: httpx.AsyncClient, job_id: int, headers: dict) -> dict:
        payload: dict = {}
        for _ in range(600):
            response = await client.get(f"/api/deck-jobs/{job_id}", headers=headers)
            assert response.status_code == 200, response.text
            payload = response.json()
            if payload["status"] in ("done", "partial", "failed", "canceled"):
                return payload
            await asyncio.sleep(0.02)
        pytest.fail(f"构建任务未在超时时间内结束：{payload}")

    async def _get_pages(client: httpx.AsyncClient, deck_id: int, headers: dict) -> list[dict]:
        detail = await client.get(f"/api/decks/{deck_id}", headers=headers)
        assert detail.status_code == 200, detail.text
        return detail.json()["pages"]

    async def test_p4_build_partial_bundle_rebuild_and_rebuild_all(monkeypatch) -> None:
        # 安全护栏：只允许在库名含 test 的独立测试库上清表重跑
        assert "test" in settings.database_url, "P4 集成测试必须指向名称包含 test 的独立数据库"
        builder, validator = _install_fakes(monkeypatch)

        async def fake_build_outline(
            llm_call, workspace_name, workspace_description, material_index, **kwargs
        ):
            return _outline_for(list(material_index))

        monkeypatch.setattr(deck_builder, "build_outline", fake_build_outline)
        monkeypatch.setattr(deck_builder, "plan_pages", _two_page_plans)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                auth = await _register(client)
                headers = {"Authorization": f"Bearer {auth['token']}"}
                _, deck_id = await _create_workspace_and_deck(client, headers, "P4 集成测试")

                # 第二页最终校验失败：触发带问题摘要的重试（最多 2 次尝试）
                validator.fail_titles = {"知识点 1-2"}

                build_response = await client.post(
                    f"/api/decks/{deck_id}/build", json={}, headers=headers
                )
                assert build_response.status_code == 200, build_response.text
                job_id = build_response.json()["job_id"]
                job = await _wait_job(client, job_id, headers)
                assert job["status"] == "partial", job
                assert job["total_pages"] == 2
                assert job["ready_pages"] == 1
                assert job["failed_pages"] == 1
                assert job["progress"] == 100
                assert job["finished_at"] is not None
                assert job["error"] is None

                detail = (await client.get(f"/api/decks/{deck_id}", headers=headers)).json()
                assert detail["status"] == "partial"
                pages = detail["pages"]
                assert len(pages) == 2
                first_page, second_page = pages
                assert first_page["status"] == "ready"
                assert first_page["has_bundle"] is True
                assert first_page["manifest_title"] == "知识点 1-1"
                assert first_page["validation_status"] == "passed"
                assert first_page["current_version"] == 1
                assert second_page["status"] == "failed"
                assert second_page["has_bundle"] is False
                assert second_page["validation_status"] == "failed"
                assert second_page["validation_issue_count"] == 1

                # 页面详情：attempts=2（Builder 成功、最终校验连续失败两次）
                page_detail = (
                    await client.get(
                        f"/api/decks/{deck_id}/pages/{second_page['id']}", headers=headers
                    )
                ).json()
                assert page_detail["build_attempts"] == 2
                assert page_detail["builder_build_id"] is None

                # Builder 收到的 brief 带硬约束且 page_id 正确
                first_build = next(
                    item
                    for item in builder.create_requests
                    if item["page_brief"]["knowledge_point"]["title"] == "知识点 1-1"
                )
                assert first_build["page_brief"]["constraints"]["no_network"] is True
                assert first_build["page_brief"]["page_id"] == f"page_{first_page['id']}"

                # P8：Builder 用量按 build_id 并入 job.usage
                from app.database import SessionLocal
                from app.models import DeckBuildJob

                async with SessionLocal() as db:
                    job_row = await db.get(DeckBuildJob, job_id)
                    assert job_row is not None
                    assert job_row.usage, "job.usage 应记录每次 Builder 尝试的用量"
                    entry = next(iter(job_row.usage.values()))
                    assert entry["input_tokens"] == 1000
                    assert entry["cache_read_tokens"] == 200
                    assert entry["cost"] == 0.01

                # bundle / thumbnail API
                bundle_response = await client.get(
                    f"/api/decks/{deck_id}/pages/{first_page['id']}/bundle", headers=headers
                )
                assert bundle_response.status_code == 200, bundle_response.text
                bundle = bundle_response.json()
                assert bundle["manifest"]["page_id"] == f"page_{first_page['id']}"
                assert bundle["html"]
                thumbnail_response = await client.get(
                    f"/api/decks/{deck_id}/pages/{first_page['id']}/thumbnail", headers=headers
                )
                assert thumbnail_response.status_code == 200
                assert thumbnail_response.headers["content-type"].startswith("image/png")
                missing_bundle = await client.get(
                    f"/api/decks/{deck_id}/pages/{second_page['id']}/bundle", headers=headers
                )
                assert missing_bundle.status_code == 404
                assert "尚未生成完成" in missing_bundle.json()["detail"]

                # 事件：类型映射、page_id 与体积上限
                events_response = await client.get(
                    f"/api/deck-jobs/{job_id}/events?after_id=0", headers=headers
                )
                events = events_response.json()
                assert events
                assert len(events) <= 200
                assert all(
                    len(json.dumps(event["payload"], ensure_ascii=False)) <= 4096
                    for event in events
                )
                event_types = {event["type"] for event in events}
                assert {"stage", "page_ready", "validation", "error", "retry"} <= event_types
                assert any(
                    event["type"] == "stage"
                    and "正在构建第 1/2 页" in event["payload"].get("text", "")
                    for event in events
                )
                assert all(
                    event["page_id"] in (None, first_page["id"], second_page["id"])
                    for event in events
                )

                # 归属：他人一律 404
                other = await _register(client)
                other_headers = {"Authorization": f"Bearer {other['token']}"}
                assert (
                    await client.get(
                        f"/api/decks/{deck_id}/pages/{first_page['id']}/bundle",
                        headers=other_headers,
                    )
                ).status_code == 404
                assert (
                    await client.get(
                        f"/api/decks/{deck_id}/pages/{first_page['id']}/thumbnail",
                        headers=other_headers,
                    )
                ).status_code == 404
                assert (
                    await client.post(
                        f"/api/decks/{deck_id}/pages/{first_page['id']}/rebuild",
                        json={},
                        headers=other_headers,
                    )
                ).status_code == 404

                # ===== 单页重建：带 feedback，成功后版本 +1，其他页不受影响 =====
                validator.fail_titles = set()
                rebuild_response = await client.post(
                    f"/api/decks/{deck_id}/pages/{second_page['id']}/rebuild",
                    json={"feedback": "请补充区间收缩动画，并放大公式"},
                    headers=headers,
                )
                assert rebuild_response.status_code == 200, rebuild_response.text
                rebuild_job = await _wait_job(
                    client, rebuild_response.json()["job_id"], headers
                )
                assert rebuild_job["status"] == "done", rebuild_job
                assert rebuild_job["target_page_id"] == second_page["id"]

                pages_after_rebuild = await _get_pages(client, deck_id, headers)
                assert pages_after_rebuild[0]["current_version"] == 1
                assert pages_after_rebuild[1]["status"] == "ready"
                assert pages_after_rebuild[1]["current_version"] == 1
                assert pages_after_rebuild[1]["has_bundle"] is True
                rebuild_request = builder.create_requests[-1]
                assert rebuild_request["feedback"] == "请补充区间收缩动画，并放大公式"
                detail = (await client.get(f"/api/decks/{deck_id}", headers=headers)).json()
                assert detail["status"] == "ready"  # 失败页重试成功后，整册状态随之收敛

                # ===== rebuild_all：全部失败时旧版本仍可读，页面保持 ready =====
                validator.always_fail = True
                version_before = [page["current_version"] for page in pages_after_rebuild]
                rebuild_all_response = await client.post(
                    f"/api/decks/{deck_id}/build",
                    json={"rebuild_all": True},
                    headers=headers,
                )
                assert rebuild_all_response.status_code == 200, rebuild_all_response.text
                rebuild_all_job = await _wait_job(
                    client, rebuild_all_response.json()["job_id"], headers
                )
                assert rebuild_all_job["status"] == "failed", rebuild_all_job
                assert rebuild_all_job["failed_pages"] == 2
                assert rebuild_all_job["error"] and "失败" in rebuild_all_job["error"]

                pages_after_failed_rebuild = await _get_pages(client, deck_id, headers)
                assert [page["status"] for page in pages_after_failed_rebuild] == [
                    "ready",
                    "ready",
                ]
                assert [
                    page["current_version"] for page in pages_after_failed_rebuild
                ] == version_before
                still_readable = await client.get(
                    f"/api/decks/{deck_id}/pages/{first_page['id']}/bundle", headers=headers
                )
                assert still_readable.status_code == 200
                detail = (await client.get(f"/api/decks/{deck_id}", headers=headers)).json()
                assert detail["status"] == "ready"  # 旧版本均可读

                # ===== 删除：204 + bundle 变为 404 =====
                assert (
                    await client.delete(f"/api/decks/{deck_id}", headers=headers)
                ).status_code == 204
                assert (
                    await client.get(
                        f"/api/decks/{deck_id}/pages/{first_page['id']}/bundle", headers=headers
                    )
                ).status_code == 404
                async with SessionLocal() as db:
                    for model in (
                        DeckPage,
                        KnowledgePoint,
                        DeckBuildJob,
                        DeckBuildEvent,
                        ReviewDeck,
                    ):
                        count = await db.scalar(select(func.count()).select_from(model))
                        assert count == 0, f"{model.__tablename__} 未级联删除"

    async def test_p4_twelve_pages_disconnect_partial_then_recover(monkeypatch) -> None:
        """12 页构建：并发上限、单页失败隔离、客户端断线后恢复、失败页重试收敛。"""
        assert "test" in settings.database_url, "P4 集成测试必须指向名称包含 test 的独立数据库"
        builder, _validator = _install_fakes(monkeypatch)

        async def fake_build_outline(
            llm_call, workspace_name, workspace_description, material_index, **kwargs
        ):
            return _outline_for(list(material_index), kps_per_chapter=4)

        monkeypatch.setattr(deck_builder, "build_outline", fake_build_outline)
        monkeypatch.setattr(deck_builder, "plan_pages", _twelve_page_plans)
        monkeypatch.setattr(settings, "page_builder_concurrency", 2)

        original_build_one_page = deck_builder._build_one_page
        active_pages = 0
        max_active_pages = 0

        async def slow_build_one_page(*args, **kwargs):
            nonlocal active_pages, max_active_pages
            active_pages += 1
            max_active_pages = max(max_active_pages, active_pages)
            try:
                await asyncio.sleep(0.03)
                return await original_build_one_page(*args, **kwargs)
            finally:
                active_pages -= 1

        monkeypatch.setattr(deck_builder, "_build_one_page", slow_build_one_page)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                auth = await _register(client)
                headers = {"Authorization": f"Bearer {auth['token']}"}
                _, deck_id = await _create_workspace_and_deck(
                    client, headers, "P4 十二页恢复测试"
                )
                builder.fail_keywords = {"知识点 3-4"}

                build_response = await client.post(
                    f"/api/decks/{deck_id}/build", json={}, headers=headers
                )
                assert build_response.status_code == 200, build_response.text
                job_id = build_response.json()["job_id"]

                # 等到 12 页进入构建后主动断开客户端：后台任务不得随连接取消
                for _ in range(300):
                    current = (
                        await client.get(f"/api/deck-jobs/{job_id}", headers=headers)
                    ).json()
                    if current["status"] == "building" and current["total_pages"] == 12:
                        break
                    await asyncio.sleep(0.01)
                else:
                    pytest.fail(f"构建任务未进入 12 页构建阶段：{current}")

            # 新连接模拟刷新/断线重连，从持久化状态继续观察
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                job = await _wait_job(client, job_id, headers)
                assert job["status"] == "partial", job
                assert job["total_pages"] == 12
                assert job["ready_pages"] == 11
                assert job["failed_pages"] == 1
                assert job["progress"] == 100
                assert job["finished_at"] is not None
                assert max_active_pages == 2, f"并发上限未生效：{max_active_pages}"

                pages = await _get_pages(client, deck_id, headers)
                assert len(pages) == 12
                ready_pages = [page for page in pages if page["status"] == "ready"]
                failed_pages = [page for page in pages if page["status"] == "failed"]
                assert len(ready_pages) == 11
                assert len(failed_pages) == 1
                assert all(page["has_bundle"] for page in ready_pages)
                assert failed_pages[0]["has_bundle"] is False
                assert failed_pages[0]["title"] == "第 12 页"

                deck = (await client.get(f"/api/decks/{deck_id}", headers=headers)).json()
                assert deck["status"] == "partial"

                for page in ready_pages:
                    bundle = await client.get(
                        f"/api/decks/{deck_id}/pages/{page['id']}/bundle",
                        headers=headers,
                    )
                    assert bundle.status_code == 200, (page["id"], bundle.text)
                    assert bundle.json()["manifest"]["page_id"] == f"page_{page['id']}"

                events = (
                    await client.get(
                        f"/api/deck-jobs/{job_id}/events?after_id=0", headers=headers
                    )
                ).json()
                assert len(events) <= 200
                assert sum(1 for event in events if event["type"] == "page_ready") >= 11

                # 失败页重试成功：其它页版本不变，整册状态收敛为 ready
                versions = {page["id"]: page["current_version"] for page in pages}
                builder.fail_keywords = set()
                retry_response = await client.post(
                    f"/api/decks/{deck_id}/pages/{failed_pages[0]['id']}/rebuild",
                    json={"feedback": "修正纵向溢出"},
                    headers=headers,
                )
                assert retry_response.status_code == 200, retry_response.text
                retry_job = await _wait_job(
                    client, retry_response.json()["job_id"], headers
                )
                assert retry_job["status"] == "done", retry_job
                assert retry_job["total_pages"] == 1

                pages_after = await _get_pages(client, deck_id, headers)
                assert len(pages_after) == 12
                assert all(
                    page["status"] == "ready" and page["has_bundle"]
                    for page in pages_after
                )
                for page in pages_after:
                    if page["id"] in versions and page["id"] != failed_pages[0]["id"]:
                        assert page["current_version"] == versions[page["id"]]
                retried = next(
                    page for page in pages_after if page["id"] == failed_pages[0]["id"]
                )
                assert retried["current_version"] == 1
                detail = (await client.get(f"/api/decks/{deck_id}", headers=headers)).json()
                assert detail["status"] == "ready"

                assert (
                    await client.delete(f"/api/decks/{deck_id}", headers=headers)
                ).status_code == 204

    async def test_startup_healing_aggregates_deck_status_from_pages(monkeypatch) -> None:
        """重启自愈：保留旧 bundle，按页面可用性把 planning/building 收敛为 ready/partial/failed。"""
        assert "test" in settings.database_url, "P4 集成测试必须指向名称包含 test 的独立数据库"
        _install_fakes(monkeypatch)

        async def fake_build_outline(
            llm_call, workspace_name, workspace_description, material_index, **kwargs
        ):
            return _outline_for(list(material_index))

        monkeypatch.setattr(deck_builder, "build_outline", fake_build_outline)
        monkeypatch.setattr(deck_builder, "plan_pages", _two_page_plans)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                auth = await _register(client)
                headers = {"Authorization": f"Bearer {auth['token']}"}
                workspace_id, deck_id = await _create_workspace_and_deck(
                    client, headers, "P4 自愈测试"
                )
                job_id = (
                    await client.post(
                        f"/api/decks/{deck_id}/build", json={}, headers=headers
                    )
                ).json()["job_id"]
                job = await _wait_job(client, job_id, headers)
                assert job["status"] == "done", job

        # 模拟进程在 rebuild_all 中被终止：Deck 仍为 building，但全部旧页面可用
        async with SessionLocal() as db:
            deck = await db.get(ReviewDeck, deck_id)
            assert deck is not None
            deck.status = "building"
            empty_deck = ReviewDeck(
                workspace_id=workspace_id,
                title="未完成规划的复习页",
                status="planning",
                style={},
                outline={},
            )
            db.add(empty_deck)
            await db.commit()
            empty_deck_id = empty_deck.id

        async with app.router.lifespan_context(app):
            async with SessionLocal() as db:
                deck = await db.get(ReviewDeck, deck_id)
                assert deck is not None and deck.status == "ready"
                pages = (
                    (
                        await db.execute(
                            select(DeckPage)
                            .where(DeckPage.deck_id == deck_id)
                            .order_by(DeckPage.ordinal)
                        )
                    )
                    .scalars()
                    .all()
                )
                assert len(pages) == 2
                assert all(page.status == "ready" and page.bundle_key for page in pages)
                empty_deck = await db.get(ReviewDeck, empty_deck_id)
                assert empty_deck is not None and empty_deck.status == "failed"

        # 模拟一页无旧版本可用：Deck 应收敛为 partial，另一页保持可读
        async with SessionLocal() as db:
            deck = await db.get(ReviewDeck, deck_id)
            assert deck is not None
            deck.status = "building"
            first_page = await db.scalar(
                select(DeckPage)
                .where(DeckPage.deck_id == deck_id)
                .order_by(DeckPage.ordinal)
                .limit(1)
            )
            assert first_page is not None
            first_page.status = "failed"
            first_page.bundle_key = None
            await db.commit()

        async with app.router.lifespan_context(app):
            async with SessionLocal() as db:
                deck = await db.get(ReviewDeck, deck_id)
                assert deck is not None and deck.status == "partial"
                pages = (
                    (
                        await db.execute(
                            select(DeckPage)
                            .where(DeckPage.deck_id == deck_id)
                            .order_by(DeckPage.ordinal)
                        )
                    )
                    .scalars()
                    .all()
                )
                assert [page.status for page in pages] == ["failed", "ready"]
                assert pages[1].bundle_key is not None

    async def test_p4_cancel_keeps_ready_pages_and_cancels_builder(monkeypatch) -> None:
        assert "test" in settings.database_url, "P4 集成测试必须指向名称包含 test 的独立数据库"
        builder, _validator = _install_fakes(monkeypatch)
        builder.hang = True

        async def fake_build_outline(
            llm_call, workspace_name, workspace_description, material_index, **kwargs
        ):
            return _outline_for(list(material_index))

        monkeypatch.setattr(deck_builder, "build_outline", fake_build_outline)
        monkeypatch.setattr(deck_builder, "plan_pages", _two_page_plans)
        # 并发 1：第二页保持排队，取消时由收尾逻辑标 canceled
        monkeypatch.setattr(settings, "page_builder_concurrency", 1)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                auth = await _register(client)
                headers = {"Authorization": f"Bearer {auth['token']}"}
                _, deck_id = await _create_workspace_and_deck(client, headers, "P4 取消测试")

                job_id = (
                    await client.post(
                        f"/api/decks/{deck_id}/build", json={}, headers=headers
                    )
                ).json()["job_id"]

                job: dict = {}
                for _ in range(600):
                    job = (
                        await client.get(f"/api/deck-jobs/{job_id}", headers=headers)
                    ).json()
                    if job["status"] == "building" and builder.create_requests:
                        break
                    await asyncio.sleep(0.02)
                assert job["status"] == "building", job
                assert builder.create_requests

                cancel_response = await client.post(
                    f"/api/decks/{deck_id}/cancel", headers=headers
                )
                assert cancel_response.status_code == 200
                finished = await _wait_job(client, job_id, headers)
                assert finished["status"] == "canceled", finished
                assert finished["finished_at"] is not None
                assert builder.canceled, "取消时未调用 Builder cancel"

                detail = (await client.get(f"/api/decks/{deck_id}", headers=headers)).json()
                assert detail["status"] == "canceled"
                assert all(page["status"] == "canceled" for page in detail["pages"])
                assert all(page["has_bundle"] is False for page in detail["pages"])

                assert (
                    await client.delete(f"/api/decks/{deck_id}", headers=headers)
                ).status_code == 204

    async def test_p4_builder_unavailable_fails_closed(monkeypatch) -> None:
        assert "test" in settings.database_url, "P4 集成测试必须指向名称包含 test 的独立数据库"
        builder, _validator = _install_fakes(monkeypatch)

        async def fake_build_outline(
            llm_call, workspace_name, workspace_description, material_index, **kwargs
        ):
            return _outline_for(list(material_index))

        monkeypatch.setattr(deck_builder, "build_outline", fake_build_outline)
        monkeypatch.setattr(deck_builder, "plan_pages", _two_page_plans)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                auth = await _register(client)
                headers = {"Authorization": f"Bearer {auth['token']}"}
                _, deck_id = await _create_workspace_and_deck(client, headers, "P4 不可用测试")

                # 未配置 Builder：503，明确说明缺哪个服务
                monkeypatch.setattr(settings, "page_builder_url", "")
                missing = await client.post(
                    f"/api/decks/{deck_id}/build", json={}, headers=headers
                )
                assert missing.status_code == 503
                assert "页面构建服务" in missing.json()["detail"]
                monkeypatch.setattr(settings, "page_builder_url", "http://builder.test")

                # Builder 返回 503：页面全部 failed，不写 bundle，Deck failed
                builder.unavailable = True
                job_id = (
                    await client.post(
                        f"/api/decks/{deck_id}/build", json={}, headers=headers
                    )
                ).json()["job_id"]
                job = await _wait_job(client, job_id, headers)
                assert job["status"] == "failed", job
                assert job["ready_pages"] == 0
                assert job["failed_pages"] == 2
                assert "不可用" in (job["error"] or "")

                detail = (await client.get(f"/api/decks/{deck_id}", headers=headers)).json()
                assert detail["status"] == "failed"
                assert all(page["status"] == "failed" for page in detail["pages"])
                assert all(page["has_bundle"] is False for page in detail["pages"])
                page_id = detail["pages"][0]["id"]
                bundle = await client.get(
                    f"/api/decks/{deck_id}/pages/{page_id}/bundle", headers=headers
                )
                assert bundle.status_code == 404
                assert "尚未生成完成" in bundle.json()["detail"]

                assert (
                    await client.delete(f"/api/decks/{deck_id}", headers=headers)
                ).status_code == 204

    async def test_p6_page_chat_sse_context_persistence_and_limits(monkeypatch) -> None:
        assert "test" in settings.database_url, "P6 集成测试必须指向名称包含 test 的独立数据库"
        _install_fakes(monkeypatch)

        async def fake_build_outline(
            llm_call, workspace_name, workspace_description, material_index, **kwargs
        ):
            return _outline_for(list(material_index))

        monkeypatch.setattr(deck_builder, "build_outline", fake_build_outline)
        monkeypatch.setattr(deck_builder, "plan_pages", _two_page_plans)

        captured: dict = {}

        async def fake_stream(messages):
            captured["messages"] = messages
            yield "二分查找每次把区间折半，"
            yield "时间复杂度为 $O(\\log n)$。"

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                auth = await _register(client)
                headers = {"Authorization": f"Bearer {auth['token']}"}
                _, deck_id = await _create_workspace_and_deck(client, headers, "P6 助手测试")
                job_id = (
                    await client.post(f"/api/decks/{deck_id}/build", json={}, headers=headers)
                ).json()["job_id"]
                job = await _wait_job(client, job_id, headers)
                assert job["status"] == "done", job
                pages = await _get_pages(client, deck_id, headers)
                page_id = next(page["id"] for page in pages if page["status"] == "ready")

                monkeypatch.setattr(page_chat, "stream_answer", fake_stream)
                response = await client.post(
                    f"/api/decks/{deck_id}/pages/{page_id}/messages",
                    json={
                        "content": "复杂度是多少？",
                        "quote": "每次把搜索区间折半",
                        "block_text": "二分查找是一种在有序数组中查找的算法。",
                    },
                    headers=headers,
                )
                assert response.status_code == 200, response.text
                assert response.headers["content-type"].startswith("text/event-stream")
                events = _parse_sse(response.content.decode("utf-8"))
                names = [name for name, _ in events]
                assert names.count("delta") == 2 and names[-1] == "done", events
                streamed = "".join(payload["text"] for name, payload in events if name == "delta")
                assert "O(\\log n)" in streamed
                done_payload = events[-1][1]
                assert done_payload["message_id"] > 0
                assert isinstance(done_payload["refs"], list)

                system_prompt = captured["messages"][0]["content"]
                user_prompt = captured["messages"][-1]["content"]
                assert "【页面信息】" in system_prompt
                assert "【来源资料】" in system_prompt
                assert "复杂度是多少？" in user_prompt
                assert "每次把搜索区间折半" in user_prompt
                assert "二分查找是一种在有序数组中查找的算法。" in user_prompt

                history = await client.get(
                    f"/api/decks/{deck_id}/pages/{page_id}/messages", headers=headers
                )
                assert history.status_code == 200, history.text
                messages = history.json()
                assert [item["role"] for item in messages] == ["user", "assistant"]
                assert messages[1]["status"] == "done"
                assert "O(\\log n)" in messages[1]["content"]

                other = await _register(client)
                denied = await client.get(
                    f"/api/decks/{deck_id}/pages/{page_id}/messages",
                    headers={"Authorization": f"Bearer {other['token']}"},
                )
                assert denied.status_code == 404

                monkeypatch.setattr(settings, "llm_api_key", "")
                unconfigured = await client.post(
                    f"/api/decks/{deck_id}/pages/{page_id}/messages",
                    json={"content": "再问一次"},
                    headers=headers,
                )
                assert unconfigured.status_code == 503
                assert "LLM" in unconfigured.json()["detail"]
                monkeypatch.setattr(settings, "llm_api_key", "test-placeholder")

                async def broken_stream(messages):
                    yield "部分回答"
                    raise RuntimeError("上游超时")

                monkeypatch.setattr(page_chat, "stream_answer", broken_stream)
                broken = await client.post(
                    f"/api/decks/{deck_id}/pages/{page_id}/messages",
                    json={"content": "会失败的问题"},
                    headers=headers,
                )
                assert broken.status_code == 200, broken.text
                broken_events = _parse_sse(broken.content.decode("utf-8"))
                assert [name for name, _ in broken_events] == ["delta", "error"]
                assert "请稍后重试" in broken_events[-1][1]["detail"]

                all_messages = (
                    await client.get(
                        f"/api/decks/{deck_id}/pages/{page_id}/messages", headers=headers
                    )
                ).json()
                user_index = next(
                    index
                    for index, item in enumerate(all_messages)
                    if item["content"] == "会失败的问题"
                )
                failed = all_messages[user_index + 1]
                assert failed["role"] == "assistant"
                assert failed["status"] == "failed"
                assert "部分回答" in failed["content"]

                monkeypatch.setattr(page_chat.page_chat_limiter, "limit", 1)
                limited = await client.post(
                    f"/api/decks/{deck_id}/pages/{page_id}/messages",
                    json={"content": "触发限流"},
                    headers=headers,
                )
                assert limited.status_code == 429
                assert limited.headers["retry-after"]
                assert "20" in limited.json()["detail"]

                assert (
                    await client.delete(f"/api/decks/{deck_id}", headers=headers)
                ).status_code == 204
