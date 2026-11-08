"""Page Validator 内部 HTTP 客户端（P4 最终门禁）。

契约见 `docs/pageref/INTERNAL_API.md` §4：
- `POST /v1/validate`，Bearer token；
- 超时、连接失败、503/504 统一转 `PageValidatorUnavailableError`（中文，fail-closed）；
- 报告结构 `{status, issues, screenshots, duration_ms}` 必须完整合法，否则视为协议错误；
- `status=failed` 不是异常：由编排方决定重试或落失败，主 API 不信任 Builder 的自检报告。

本模块不访问数据库，也不持久化 bundle/截图。
"""
import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# Plan §7.6 / INTERNAL_API §4.1：桌面验收三档视口
DEFAULT_VIEWPORTS: tuple[tuple[int, int], ...] = ((1280, 720), (1440, 900), (1920, 1080))

REPORT_STATUSES = ("passed", "warning", "failed")


class PageValidatorError(RuntimeError):
    """Validator 调用失败或报告结构非法（中文文案）。"""


class PageValidatorUnavailableError(PageValidatorError):
    """Validator 不可用：超时、连接失败、503/504。调用方必须 fail-closed。"""


def normalize_viewports(
    viewports: list[dict] | list[tuple[int, int]] | None = None
) -> list[dict[str, int]]:
    """把视口归一化为 [{'width','height'}]；默认三档桌面视口。"""
    if not viewports:
        return [{"width": width, "height": height} for width, height in DEFAULT_VIEWPORTS]
    normalized: list[dict[str, int]] = []
    for item in viewports:
        if isinstance(item, dict):
            width, height = item.get("width"), item.get("height")
        else:
            width, height = item
        try:
            normalized.append({"width": int(width), "height": int(height)})
        except (TypeError, ValueError) as exc:
            raise PageValidatorError("校验视口参数不合法，宽高必须是整数") from exc
    return normalized


def normalize_report(payload: Any) -> dict:
    """校验报告结构并返回规范化结果；结构不合法时抛 PageValidatorError。

    报告是外部输入：只保留已知字段，避免把任意 payload 写入页面 validation。
    """
    if not isinstance(payload, dict):
        raise PageValidatorError("页面校验服务返回了非预期的报告结构，请稍后重试")
    status = payload.get("status")
    if status not in REPORT_STATUSES:
        raise PageValidatorError("页面校验报告缺少合法的 status（passed/warning/failed）")
    raw_issues = payload.get("issues")
    if raw_issues is None:
        raw_issues = []
    if not isinstance(raw_issues, list):
        raise PageValidatorError("页面校验报告的 issues 必须是数组")
    issues: list[dict] = []
    for issue in raw_issues:
        if not isinstance(issue, dict):
            continue
        issues.append(
            {
                "severity": str(issue.get("severity") or "error")[:16],
                "code": str(issue.get("code") or "UNKNOWN")[:64],
                "message": str(issue.get("message") or "")[:1000],
                "selector": str(issue.get("selector"))[:255] if issue.get("selector") else None,
                "viewport": str(issue.get("viewport"))[:32] if issue.get("viewport") else None,
            }
        )
    raw_screenshots = payload.get("screenshots")
    if raw_screenshots is None:
        raw_screenshots = []
    if not isinstance(raw_screenshots, list):
        raise PageValidatorError("页面校验报告的 screenshots 必须是数组")
    screenshots: list[dict] = []
    for shot in raw_screenshots:
        if not isinstance(shot, dict):
            continue
        data_uri = shot.get("data_uri")
        if not isinstance(data_uri, str) or not data_uri:
            continue
        screenshots.append(
            {
                "viewport": str(shot.get("viewport") or "")[:32],
                "data_uri": data_uri,
            }
        )
    duration = payload.get("duration_ms")
    try:
        duration_ms = int(duration)
    except (TypeError, ValueError):
        duration_ms = 0
    # INTERNAL_API §4.1：任一 error 级问题即失败；不信任外部报告的 passed 结论
    if status != "failed" and any(issue["severity"] == "error" for issue in issues):
        status = "failed"
    raw_teaching = payload.get("teaching")
    teaching: dict | None = None
    if isinstance(raw_teaching, dict):
        try:
            score = int(raw_teaching.get("score"))
        except (TypeError, ValueError):
            score = -1
        warnings = raw_teaching.get("warnings")
        if 0 <= score <= 100:
            teaching = {
                "score": score,
                "warnings": [str(item)[:300] for item in warnings][:10]
                if isinstance(warnings, list)
                else [],
            }
    return {
        "status": status,
        "issues": issues,
        "screenshots": screenshots,
        "duration_ms": max(0, duration_ms),
        "teaching": teaching,
    }


def _error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("detail"), str):
        detail = payload["detail"].strip()
        if detail:
            return detail[:1000]
    return f"页面校验服务返回错误（HTTP {response.status_code}），请稍后重试"


class PageValidatorClient:
    """Validator 的异步客户端；transport 可注入以便测试（httpx.MockTransport）。"""

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: int | float | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = (
            base_url if base_url is not None else settings.page_validator_url or ""
        ).rstrip("/")
        self.token = token if token is not None else (settings.page_validator_token or "")
        self.timeout = float(
            timeout if timeout is not None else settings.page_validator_timeout_seconds
        )
        self._transport = transport

    async def validate(
        self,
        bundle: dict,
        viewports: list[dict] | list[tuple[int, int]] | None = None,
        screenshot: bool = True,
    ) -> dict:
        """调用最终门禁；status=failed 正常返回（包含 issues 与截图）。"""
        if not self.base_url or not self.token:
            raise PageValidatorUnavailableError(
                "页面校验服务未配置（缺少 PAGE_VALIDATOR_URL / PAGE_VALIDATOR_TOKEN），"
                "页面无法放行（fail-closed），请先在后端 .env 中配置"
            )
        body = {
            "bundle": bundle,
            "viewports": normalize_viewports(viewports),
            "screenshot": bool(screenshot),
        }
        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self._transport,
                trust_env=False,
            ) as client:
                response = await client.post("/v1/validate", json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise PageValidatorUnavailableError(
                "页面校验服务响应超时，页面未放行；请稍后重试或检查校验服务负载"
            ) from exc
        except httpx.HTTPError as exc:
            raise PageValidatorUnavailableError(
                "页面校验服务暂不可用，页面未放行（fail-closed），请稍后重试"
            ) from exc

        if response.status_code in (503, 504):
            raise PageValidatorUnavailableError(_error_detail(response))
        if response.status_code >= 400:
            raise PageValidatorError(_error_detail(response))
        try:
            payload = response.json()
        except ValueError as exc:
            raise PageValidatorError("页面校验服务返回了无法解析的报告，请稍后重试") from exc
        report = normalize_report(payload)
        logger.info(
            "页面最终校验完成：status=%s issues=%d screenshots=%d duration_ms=%d",
            report["status"],
            len(report["issues"]),
            len(report["screenshots"]),
            report["duration_ms"],
        )
        return report
