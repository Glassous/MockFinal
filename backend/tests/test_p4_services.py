"""P4 客户端/存储纯函数测试：HMAC、错误映射、bundle key 与大小、缩略图 data URI、重试计数。

不依赖数据库与真实 Builder/Validator；HTTP 交互使用 httpx.MockTransport。
"""
import base64
import hashlib
import hmac
import json

import httpx
import pytest

from app.config import settings
from app.services import bundle_store
from app.services.deck_builder import (
    _feedback_from_report,
    _report_issue_message,
    next_page_attempt_action,
)
from app.services.page_builder_client import (
    PageBuilderClient,
    PageBuilderRequestError,
    PageBuilderUnavailableError,
    sign_headers,
)
from app.services.page_validator import (
    PageValidatorClient,
    PageValidatorError,
    PageValidatorUnavailableError,
    normalize_report,
)

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_1PX).decode("ascii")
JPEG_DATA_URI = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 8).decode(
    "ascii"
)

GOOD_BUNDLE = {
    "schema_version": "1.0",
    "runtime_version": "1.0.0",
    "manifest": {"page_id": "page_1", "title": "测试页", "kind": "concept"},
    "html": "<div class=\"mp-page\"></div>",
    "css": ".mp-page { color: #111; }",
    "js": "const root = 1;",
}


# ===== HMAC 签名 =====
def test_sign_headers_matches_internal_api_contract() -> None:
    headers = sign_headers(
        "unit-test-token", "POST", "/v1/builds", b'{"build_id":"bld_1"}', timestamp=1794030000
    )
    # 跨语言固定向量（builder/tests/hmac.test.mjs 使用同一向量）
    assert headers == {
        "X-MF-Timestamp": "1794030000",
        "X-MF-Signature": "a7f4b000af9a40d3e39580f2ed9f31c9d525a2704fdbccd7f67933b29654d500",
    }


def test_sign_headers_binds_method_and_path() -> None:
    body = b'{"build_id":"bld_1"}'
    first = sign_headers("secret-token", "POST", "/v1/builds", body, timestamp=1794030000)
    second = sign_headers("secret-token", "GET", "/v1/builds", body, timestamp=1794030000)
    third = sign_headers("secret-token", "POST", "/v1/builds/other", body, timestamp=1794030000)
    with_query = sign_headers(
        "secret-token", "GET", "/v1/builds/bld_1/events?after_seq=0", b"", timestamp=1794030000
    )
    without_query = sign_headers(
        "secret-token", "GET", "/v1/builds/bld_1/events", b"", timestamp=1794030000
    )
    assert first["X-MF-Signature"] != second["X-MF-Signature"]
    assert first["X-MF-Signature"] != third["X-MF-Signature"]
    assert with_query["X-MF-Signature"] != without_query["X-MF-Signature"]


def test_sign_headers_signs_empty_body_for_get() -> None:
    headers = sign_headers(
        "secret-token", "GET", "/v1/builds/bld_1", b"", timestamp=1794030000
    )
    expected = hmac.new(
        b"secret-token", b"1794030000.GET./v1/builds/bld_1.", hashlib.sha256
    ).hexdigest()
    assert headers["X-MF-Signature"] == expected


async def test_builder_client_signs_actual_request_body() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content
        return httpx.Response(202, json={"build_id": "bld_1", "status": "queued"})

    client = PageBuilderClient(
        base_url="http://builder.local",
        token="tok",
        transport=httpx.MockTransport(handler),
    )
    await client.create_build("bld_1", {"page_id": "page_1", "knowledge_point": {"title": "x"}})

    timestamp = captured["headers"]["x-mf-timestamp"]
    expected = hmac.new(
        b"tok",
        f"{timestamp}.POST./v1/builds.".encode("utf-8") + captured["body"],
        hashlib.sha256,
    ).hexdigest()
    assert captured["headers"]["x-mf-signature"] == expected
    assert captured["headers"]["content-type"] == "application/json"
    assert json.loads(captured["body"])["build_id"] == "bld_1"


async def test_builder_client_sends_session_metadata() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content
        return httpx.Response(202, json={"build_id": "bld_1", "status": "queued"})

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(handler)
    )
    await client.create_build(
        "bld_1",
        {"page_id": "page_1", "knowledge_point": {"title": "x"}},
        session={"key": "deck_1_lane_0", "lane": 0, "page_index": 1, "page_total": 3, "first": False},
    )
    payload = json.loads(captured["body"])
    assert payload["session"] == {
        "key": "deck_1_lane_0",
        "lane": 0,
        "page_index": 1,
        "page_total": 3,
        "first": False,
    }


async def test_builder_client_delete_session() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        return httpx.Response(202, json={"key": "deck_1_lane_0", "status": "closed"})

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(handler)
    )
    result = await client.delete_session("deck_1_lane_0")
    assert captured == {"method": "DELETE", "path": "/v1/sessions/deck_1_lane_0"}
    assert result["status"] == "closed"


async def test_builder_client_get_signs_empty_body() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content
        return httpx.Response(200, json={"build_id": "bld_1", "status": "running"})

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(handler)
    )
    await client.get_build("bld_1")
    timestamp = captured["headers"]["x-mf-timestamp"]
    expected = hmac.new(
        b"tok", f"{timestamp}.GET./v1/builds/bld_1.".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    assert captured["headers"]["x-mf-signature"] == expected
    assert captured["body"] == b""


async def test_builder_client_get_events_signs_query_path() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"events": [], "next_seq": 3, "finished": False})

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(handler)
    )
    await client.get_events("bld_1", after_seq=3)
    timestamp = captured["headers"]["x-mf-timestamp"]
    expected = hmac.new(
        b"tok",
        f"{timestamp}.GET./v1/builds/bld_1/events?after_seq=3.".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert captured["url"].endswith("/v1/builds/bld_1/events?after_seq=3")
    assert captured["headers"]["x-mf-signature"] == expected


# ===== Builder 错误映射 =====
@pytest.mark.parametrize("status_code", [503, 504])
async def test_builder_unavailable_status_maps_to_unavailable(status_code: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code, json={"detail": "构建队列已满，请稍后重试", "code": "OVERLOADED"}
        )

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(PageBuilderUnavailableError) as excinfo:
        await client.create_build("bld_1", {"page_id": "page_1"})
    assert "构建队列已满" in str(excinfo.value)
    assert excinfo.value.code == "OVERLOADED"


async def test_builder_business_error_uses_detail_and_code() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"detail": "page_brief 缺少知识", "code": "INVALID_REQUEST"})

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(PageBuilderRequestError) as excinfo:
        await client.create_build("bld_1", {"page_id": "page_1"})
    assert str(excinfo.value) == "page_brief 缺少知识"
    assert excinfo.value.code == "INVALID_REQUEST"
    assert excinfo.value.status == 400


async def test_builder_timeout_and_connection_errors_are_unavailable() -> None:
    def timeout_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("boom", request=request)

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(timeout_handler)
    )
    with pytest.raises(PageBuilderUnavailableError) as excinfo:
        await client.get_build("bld_1")
    assert "超时" in str(excinfo.value)

    def connect_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(connect_handler)
    )
    with pytest.raises(PageBuilderUnavailableError) as excinfo:
        await client.create_build("bld_1", {"page_id": "page_1"})
    assert "暂不可用" in str(excinfo.value)


async def test_builder_bundle_and_cancel_shapes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/bundle"):
            return httpx.Response(200, json={"build_id": "bld_1", "bundle": GOOD_BUNDLE})
        if request.url.path.endswith("/cancel"):
            return httpx.Response(202, json={"build_id": "bld_1", "status": "canceled"})
        return httpx.Response(200, json={"events": [], "next_seq": 3, "finished": False})

    client = PageBuilderClient(
        base_url="http://builder.local", token="tok", transport=httpx.MockTransport(handler)
    )
    payload = await client.get_bundle("bld_1")
    assert payload["bundle"]["schema_version"] == "1.0"
    snapshot = await client.cancel_build("bld_1")
    assert snapshot["status"] == "canceled"
    events = await client.get_events("bld_1", after_seq=2)
    assert events["next_seq"] == 3


# ===== Validator =====
def test_normalize_report_validates_structure() -> None:
    report = normalize_report(
        {
            "status": "warning",
            "issues": [
                {
                    "severity": "warning",
                    "code": "A11Y_WARNING",
                    "message": "缺少 aria-label",
                    "selector": "button",
                    "viewport": "1280x720",
                }
            ],
            "screenshots": [{"viewport": "1280x720", "data_uri": PNG_DATA_URI}],
            "duration_ms": 88,
        }
    )
    assert report["status"] == "warning"
    assert report["issues"][0]["code"] == "A11Y_WARNING"
    assert report["screenshots"][0]["data_uri"].startswith("data:image/png;base64,")
    assert report["duration_ms"] == 88

    with pytest.raises(PageValidatorError):
        normalize_report({"status": "unknown", "issues": []})
    with pytest.raises(PageValidatorError):
        normalize_report({"issues": []})
    with pytest.raises(PageValidatorError):
        normalize_report({"status": "passed", "issues": "bad"})


async def test_validator_failed_status_is_returned_not_raised() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer validator-token"
        body = json.loads(request.content)
        assert body["viewports"][0] == {"width": 1280, "height": 720}
        assert body["screenshot"] is True
        return httpx.Response(
            200,
            json={
                "status": "failed",
                "issues": [
                    {
                        "severity": "error",
                        "code": "ZERO_SCROLL_OVERFLOW",
                        "message": "1280x720 出现纵向溢出",
                        "viewport": "1280x720",
                    }
                ],
                "screenshots": [],
                "duration_ms": 12,
            },
        )

    client = PageValidatorClient(
        base_url="http://validator.local",
        token="validator-token",
        transport=httpx.MockTransport(handler),
    )
    report = await client.validate(GOOD_BUNDLE)
    assert report["status"] == "failed"
    assert report["issues"][0]["code"] == "ZERO_SCROLL_OVERFLOW"


async def test_validator_unavailable_maps_to_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "浏览器环境无法启动", "code": "BROWSER_UNAVAILABLE"})

    client = PageValidatorClient(
        base_url="http://validator.local",
        token="validator-token",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(PageValidatorUnavailableError) as excinfo:
        await client.validate(GOOD_BUNDLE)
    assert "浏览器环境无法启动" in str(excinfo.value)


# ===== bundle 存储 =====
def test_bundle_and_thumbnail_keys() -> None:
    assert (
        bundle_store.build_bundle_key(1, 2, 3, 4, 5)
        == "mockfinal/1/2/decks/3/pages/4/v5/bundle.json"
    )
    assert (
        bundle_store.build_thumbnail_key(1, 2, 3, 4, 5)
        == "mockfinal/1/2/decks/3/pages/4/v5/thumbnail.png"
    )


def test_validate_bundle_checks_fields_and_size() -> None:
    data = bundle_store.validate_bundle(GOOD_BUNDLE)
    assert data.startswith(b"{")

    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.validate_bundle({**GOOD_BUNDLE, "manifest": "bad"})
    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.validate_bundle({"schema_version": "1.0"})
    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.validate_bundle(GOOD_BUNDLE, max_bytes=10)
    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.validate_bundle(
            {**GOOD_BUNDLE, "manifest": {"bad": float("nan")}}
        )


async def test_save_bundle_uses_json_content_type_and_returns_key(monkeypatch) -> None:
    saved: dict = {}

    async def fake_save(key: str, data: bytes, content_type: str = "") -> None:
        saved.update({"key": key, "data": data, "content_type": content_type})

    monkeypatch.setattr(bundle_store.storage, "save", fake_save)
    key = await bundle_store.save_bundle(
        user_id=1,
        workspace_id=2,
        deck_id=3,
        page_id=4,
        version=1,
        bundle=GOOD_BUNDLE,
    )
    assert key == "mockfinal/1/2/decks/3/pages/4/v1/bundle.json"
    assert saved["content_type"] == "application/json"
    assert json.loads(saved["data"])["manifest"]["title"] == "测试页"


async def test_load_bundle_rejects_corrupted_json(monkeypatch) -> None:
    async def fake_read(key: str) -> bytes:
        return b"not-json"

    monkeypatch.setattr(bundle_store.storage, "read", fake_read)
    with pytest.raises(bundle_store.BundleStoreError):
        await bundle_store.load_bundle("mockfinal/x")


# ===== 缩略图 data URI =====
def test_decode_data_uri_accepts_png_and_jpeg() -> None:
    data, content_type = bundle_store.decode_data_uri(PNG_DATA_URI)
    assert data == PNG_1PX
    assert content_type == "image/png"
    assert bundle_store.detect_image_content_type(PNG_1PX) == "image/png"

    jpeg, jpeg_type = bundle_store.decode_data_uri(JPEG_DATA_URI)
    assert jpeg_type == "image/jpeg"
    assert bundle_store.detect_image_content_type(jpeg) == "image/jpeg"


def test_decode_data_uri_rejects_other_types_and_oversize() -> None:
    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.decode_data_uri("data:image/gif;base64,R0lGODlhAQABAAAAACw=")
    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.decode_data_uri("http://example.com/a.png")
    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.decode_data_uri("data:image/png;base64,不是base64")

    oversize = b"\x89PNG\r\n\x1a\n" + b"\x00" * (bundle_store.MAX_THUMBNAIL_BYTES + 1)
    oversize_uri = "data:image/png;base64," + base64.b64encode(oversize).decode("ascii")
    with pytest.raises(bundle_store.BundleStoreError):
        bundle_store.decode_data_uri(oversize_uri)


async def test_save_thumbnail_ignores_non_image_bytes(monkeypatch) -> None:
    calls: list[str] = []

    async def fake_save(key: str, data: bytes, content_type: str = "") -> None:
        calls.append(content_type)

    monkeypatch.setattr(bundle_store.storage, "save", fake_save)
    key = await bundle_store.save_thumbnail(
        user_id=1, workspace_id=2, deck_id=3, page_id=4, version=1, image=PNG_DATA_URI
    )
    assert key.endswith("/v1/thumbnail.png")
    assert calls == ["image/png"]

    with pytest.raises(bundle_store.BundleStoreError):
        await bundle_store.save_thumbnail(
            user_id=1, workspace_id=2, deck_id=3, page_id=4, version=1, image=b"plain-text"
        )


# ===== 重试计数与反馈摘要 =====
def test_next_page_attempt_action_counts_attempts() -> None:
    assert next_page_attempt_action(0, 2) == "retry"
    assert next_page_attempt_action(1, 2) == "retry"
    assert next_page_attempt_action(2, 2) == "fail"
    assert next_page_attempt_action(1, 1) == "fail"
    # 配置非法时按至少 1 次处理，避免无限重试
    assert next_page_attempt_action(1, 0) == "fail"


def test_feedback_from_report_is_bounded_and_actionable() -> None:
    report = {
        "status": "failed",
        "issues": [
            {
                "severity": "error",
                "code": "ZERO_SCROLL_OVERFLOW",
                "message": "内容溢出" * 400,
                "selector": ".mp-page",
                "viewport": "1280x720",
            }
            for _ in range(12)
        ],
        "screenshots": [],
        "duration_ms": 1,
    }
    feedback = _feedback_from_report(report)
    assert len(feedback) <= 2000
    assert "ZERO_SCROLL_OVERFLOW" in feedback
    assert "1280x720" in feedback
    assert "页面未通过最终校验" in _report_issue_message(report)


def test_settings_service_flags(monkeypatch) -> None:
    monkeypatch.setattr(settings, "page_builder_url", "http://builder")
    monkeypatch.setattr(settings, "page_builder_token", "token")
    monkeypatch.setattr(settings, "page_validator_url", "http://validator")
    monkeypatch.setattr(settings, "page_validator_token", "token")
    assert settings.page_builder_configured is True
    assert settings.page_validator_configured is True
    monkeypatch.setattr(settings, "page_builder_token", "")
    monkeypatch.setattr(settings, "page_validator_url", "")
    assert settings.page_builder_configured is False
    assert settings.page_validator_configured is False
