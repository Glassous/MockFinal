"""Pi Builder 内部 HTTP 客户端（P4）。

契约见 `docs/pageref/INTERNAL_API.md`：
- 鉴权：`X-MF-Timestamp`（Unix 秒）+ `X-MF-Signature` =
  hex(HMAC-SHA256(token, "{ts}.{method}.{path}.{raw_body}"))；
  GET 等无请求体的调用对空字符串签名；path 含查询串；
- 超时、连接错误、503/504 统一转 `PageBuilderUnavailableError`（中文、可行动），
  其余 4xx/5xx 解析 `{detail, code}` 后抛 `PageBuilderRequestError`；
- 日志只记录 build_id/状态码/错误码，绝不记录 token、完整 brief 或页面正文。

本模块不访问数据库；调用方负责并发与重试决策。
"""
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# Builder 已知状态（INTERNAL_API §3.2）；未知状态视为协议错误，避免把页面误标 ready
BUILD_STATUSES = ("queued", "running", "validating", "succeeded", "failed", "canceled")


class PageBuilderError(RuntimeError):
    """Builder 调用失败（中文文案可直接展示给用户）。"""

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


class PageBuilderUnavailableError(PageBuilderError):
    """Builder 不可用：超时、连接失败、503/504。调用方必须 fail-closed。"""


class PageBuilderRequestError(PageBuilderError):
    """Builder 返回了业务错误（4xx/5xx 且带 detail/code）。"""


def sign_headers(
    token: str,
    method: str,
    path: str,
    raw_body: bytes | str,
    *,
    timestamp: int | float | None = None,
) -> dict[str, str]:
    """计算 HMAC 请求头；绑定 method/path（path 含查询串）与最终发送的原始字节。"""
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    ts = str(int(timestamp if timestamp is not None else time.time()))
    canonical = f"{ts}.{method.upper()}.{path}.".encode("utf-8") + body
    digest = hmac.new(token.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    return {"X-MF-Timestamp": ts, "X-MF-Signature": digest}


def _error_detail(response: httpx.Response) -> tuple[str, str | None]:
    """从错误响应中提取中文 detail 与错误码；解析失败时给通用中文文案。"""
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        detail = payload.get("detail")
        code = payload.get("code")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()[:1000], str(code)[:64] if code else None
    return f"页面构建服务返回错误（HTTP {response.status_code}），请稍后重试", None


class PageBuilderClient:
    """Builder 的异步客户端；transport 可注入以便测试（httpx.MockTransport）。"""

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: int | float | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = (base_url if base_url is not None else settings.page_builder_url or "").rstrip("/")
        self.token = token if token is not None else (settings.page_builder_token or "")
        self.timeout = float(timeout if timeout is not None else settings.page_builder_timeout_seconds)
        self._transport = transport

    def _ensure_configured(self) -> None:
        if not self.base_url or not self.token:
            raise PageBuilderUnavailableError(
                "页面构建服务未配置（缺少 PAGE_BUILDER_URL / PAGE_BUILDER_TOKEN），请先在后端 .env 中配置"
            )

    async def _request(
        self, method: str, path: str, *, json_body: dict | None = None
    ) -> httpx.Response:
        self._ensure_configured()
        if json_body is None:
            raw_body = b""
        else:
            try:
                raw_body = json.dumps(
                    json_body, ensure_ascii=False, separators=(",", ":")
                ).encode("utf-8")
            except (TypeError, ValueError) as exc:
                raise PageBuilderError("构建请求包含无法序列化的内容，已取消发送") from exc

        headers = sign_headers(self.token, method, path, raw_body)
        if method.upper() != "GET":
            # Builder 对 POST 强制校验 application/json（含空请求体的 cancel）
            headers["Content-Type"] = "application/json"
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self._transport,
                trust_env=False,
            ) as client:
                response = await client.request(
                    method,
                    path,
                    content=raw_body if method.upper() != "GET" else None,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise PageBuilderUnavailableError(
                "页面构建服务响应超时，请稍后重试；若持续超时请检查构建服务负载"
            ) from exc
        except httpx.HTTPError as exc:
            raise PageBuilderUnavailableError(
                "页面构建服务暂不可用，请稍后重试或联系管理员"
            ) from exc

        if response.status_code in (503, 504):
            detail, code = _error_detail(response)
            raise PageBuilderUnavailableError(detail, code=code, status=response.status_code)
        if response.status_code >= 400:
            detail, code = _error_detail(response)
            raise PageBuilderRequestError(detail, code=code, status=response.status_code)
        return response

    @staticmethod
    def _json(response: httpx.Response) -> dict:
        try:
            payload = response.json()
        except ValueError as exc:
            raise PageBuilderError("页面构建服务返回了无法解析的响应，请稍后重试") from exc
        if not isinstance(payload, dict):
            raise PageBuilderError("页面构建服务返回了非预期的响应结构，请稍后重试")
        return payload

    async def create_build(
        self,
        build_id: str,
        brief: dict,
        feedback: str | None = None,
        timeout: int | float | None = None,
        session: dict | None = None,
    ) -> dict:
        """创建构建（允许 200/202）；同 build_id 重复创建由 Builder 幂等处理。"""
        body: dict[str, Any] = {"build_id": build_id, "page_brief": brief}
        if session is not None:
            body["session"] = session
        if feedback:
            body["feedback"] = str(feedback)[:2000]
        if timeout:
            body["deadline_seconds"] = int(timeout)
        response = await self._request("POST", "/v1/builds", json_body=body)
        payload = self._json(response)
        if not isinstance(payload.get("build_id"), str):
            raise PageBuilderError("页面构建服务未返回 build_id，请稍后重试")
        logger.info(
            "已创建 Builder 构建：build_id=%s status=%s http=%s session=%s",
            build_id,
            payload.get("status"),
            response.status_code,
            (session or {}).get("key", "-"),
        )
        return payload

    async def get_build(self, build_id: str) -> dict:
        response = await self._request("GET", f"/v1/builds/{build_id}")
        payload = self._json(response)
        status = payload.get("status")
        if status not in BUILD_STATUSES:
            raise PageBuilderError(
                f"页面构建服务返回了未知状态（{status}），请更新构建服务或稍后重试"
            )
        return payload

    async def get_events(self, build_id: str, after_seq: int = 0) -> dict:
        """增量事件；返回 {events, next_seq, finished}，events 元素形如 {seq,type,payload}。"""
        response = await self._request(
            "GET", f"/v1/builds/{build_id}/events?after_seq={max(0, int(after_seq))}"
        )
        payload = self._json(response)
        events = payload.get("events")
        if events is None:
            events = []
        if not isinstance(events, list):
            raise PageBuilderError("页面构建事件结构异常，请稍后重试")
        next_seq = payload.get("next_seq")
        try:
            next_seq_value = int(next_seq)
        except (TypeError, ValueError):
            next_seq_value = after_seq
        return {
            "events": [event for event in events if isinstance(event, dict)],
            "next_seq": max(after_seq, next_seq_value),
            "finished": bool(payload.get("finished")),
        }

    async def get_bundle(self, build_id: str) -> dict:
        """获取 bundle（仅 succeeded 可用）；返回 {build_id, bundle, validation}。"""
        response = await self._request("GET", f"/v1/builds/{build_id}/bundle")
        payload = self._json(response)
        if not isinstance(payload.get("bundle"), dict):
            raise PageBuilderError("页面构建服务未返回有效 bundle，请稍后重试")
        return payload

    async def cancel_build(self, build_id: str) -> dict:
        """取消构建（幂等）；404 表示任务已过期，视为已结束。"""
        try:
            response = await self._request("POST", f"/v1/builds/{build_id}/cancel")
        except PageBuilderRequestError as exc:
            if exc.status == 404:
                return {}
            raise
        return self._json(response)

    async def delete_session(self, key: str) -> dict:
        """清理 Deck 会话（幂等）；不存在时 Builder 返回 not_found。"""
        try:
            response = await self._request("DELETE", f"/v1/sessions/{key}")
        except PageBuilderRequestError as exc:
            if exc.status == 404:
                return {}
            raise
        return self._json(response)

    async def healthz(self) -> dict:
        """健康检查（无需鉴权）；不可用时抛 PageBuilderUnavailableError。"""
        if not self.base_url:
            raise PageBuilderUnavailableError("页面构建服务未配置")
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=10,
                transport=self._transport,
                trust_env=False,
            ) as client:
                response = await client.get("/healthz")
        except httpx.HTTPError as exc:
            raise PageBuilderUnavailableError("页面构建服务暂不可用") from exc
        if response.status_code != 200:
            raise PageBuilderUnavailableError("页面构建服务健康检查失败")
        return self._json(response)
