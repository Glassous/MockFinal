"""P13 真实 14 页 E2E：整册重建历史 Deck，采集 job、逐页 bundle 与教学校验。

运行（宿主机后端 + 本地 Builder/Validator）：
    PYTHONPATH=. PYTHONIOENCODING=utf-8 python tests/fixtures/p13_e2e.py

环境变量：P13_API_URL（默认 http://127.0.0.1:8000）、P13_USERNAME/P13_PASSWORD、
P13_DECK_ID（默认 18）、P13_TIMEOUT_SECONDS（默认 2400）。
输出：docs/pageref/P13_RESULTS.json
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

API = os.environ.get("P13_API_URL", "http://127.0.0.1:8000")
USERNAME = os.environ.get("P13_USERNAME", "p5demo039180")
PASSWORD = os.environ.get("P13_PASSWORD", "Passw0rd!123")
DECK_ID = int(os.environ.get("P13_DECK_ID", "18"))
TIMEOUT = int(os.environ.get("P13_TIMEOUT_SECONDS", "2400"))
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "pageref" / "P13_RESULTS.json"

client = httpx.Client(base_url=API, timeout=60, trust_env=False)

login = client.post(
    "/api/auth/login", json={"username": USERNAME, "password": PASSWORD}
)
login.raise_for_status()
token = login.json()["token"]
headers = {"Authorization": f"Bearer {token}"}


def api_get(path: str) -> dict:
    last: Exception | None = None
    for attempt in range(4):
        try:
            # 每次请求使用独立连接；Windows 上长轮询的 keep-alive 连接可能被重置
            with httpx.Client(base_url=API, timeout=60, trust_env=False) as fresh:
                response = fresh.get(path, headers=headers)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code < 500:
                raise
            last = exc
        except httpx.TransportError as exc:
            last = exc
        time.sleep(1 + attempt)
    assert last is not None
    raise last


def database_url() -> str:
    url = os.environ.get("P13_DATABASE_URL", "")
    if not url:
        env_path = ROOT / "backend" / ".env"
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        except OSError:
            return ""
    return url.replace("+psycopg", "").replace("@db:5432", "@127.0.0.1:5433")


def load_usage(job_id: int) -> dict:
    url = database_url()
    if not url:
        return {}
    try:
        import psycopg
    except ImportError:
        return {}
    with psycopg.connect(url, connect_timeout=5) as conn, conn.cursor() as cur:
        cur.execute("SELECT usage FROM deck_build_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
    payload = row[0] if row and row[0] else {}
    return payload if isinstance(payload, dict) else {}


def load_builder_data() -> tuple[dict, list[dict]]:
    """按 Deck 页最新 build_id 从 Builder 快照恢复用量与构建元数据（任务未过期时可用）。"""
    url = database_url()
    if not url:
        return {}, []
    try:
        import psycopg
    except ImportError:
        return {}, []
    with psycopg.connect(url, connect_timeout=5) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, builder_build_id FROM deck_pages "
            "WHERE deck_id = %s AND builder_build_id IS NOT NULL",
            (DECK_ID,),
        )
        rows = cur.fetchall()
    base = os.environ.get("P13_BUILDER_URL", "http://127.0.0.1:9100").rstrip("/")
    token = os.environ.get("P13_BUILDER_TOKEN", "dev-builder")
    usage: dict = {}
    builds: list[dict] = []
    for page_id, build_id in rows:
        path = f"/v1/builds/{build_id}"
        timestamp = str(int(time.time()))
        signature = hmac.new(
            token.encode("utf-8"),
            f"{timestamp}.GET.{path}.".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        try:
            response = httpx.get(
                base + path,
                timeout=15,
                trust_env=False,
                headers={"X-MF-Timestamp": timestamp, "X-MF-Signature": signature},
            )
        except httpx.HTTPError:
            continue
        if response.status_code != 200:
            continue
        snapshot = response.json()
        builds.append(
            {
                "page_id": page_id,
                "build_id": build_id,
                "status": snapshot.get("status"),
                "attempts": int(snapshot.get("attempts") or 0),
                "created_at": snapshot.get("created_at"),
            }
        )
        raw = snapshot.get("usage")
        if not isinstance(raw, dict):
            continue
        match = re.search(r"_v(\d+)_", str(build_id))
        usage[str(build_id)] = {
            "page_id": page_id,
            "attempt": int(match.group(1)) if match else 1,
            "input_tokens": int(raw.get("input_tokens") or 0),
            "output_tokens": int(raw.get("output_tokens") or 0),
            "cache_read_tokens": int(raw.get("cache_read_tokens") or 0),
            "cache_write_tokens": int(raw.get("cache_write_tokens") or 0),
            "cost": float(raw.get("cost") or 0),
            "duration_ms": int(raw.get("duration_ms") or 0),
        }
    return usage, builds


def summarize_usage(usage: dict) -> dict:
    rows = [row for row in usage.values() if isinstance(row, dict)]
    def total(key: str) -> int:
        return sum(int(row.get(key) or 0) for row in rows)

    input_tokens = total("input_tokens")
    cache_read = total("cache_read_tokens")
    return {
        "attempts": len(rows),
        "pages": len({row.get("page_id") for row in rows if row.get("page_id")}),
        "input_tokens": input_tokens,
        "output_tokens": total("output_tokens"),
        "cache_read_tokens": cache_read,
        "cache_write_tokens": total("cache_write_tokens"),
        "duration_ms": total("duration_ms"),
        "cache_hit_ratio": round(cache_read / (input_tokens + cache_read), 4)
        if input_tokens + cache_read
        else 0.0,
        "per_page": sorted(
            [
                {
                    "page_id": row.get("page_id"),
                    "attempt": row.get("attempt"),
                    "input_tokens": int(row.get("input_tokens") or 0),
                    "output_tokens": int(row.get("output_tokens") or 0),
                    "cache_read_tokens": int(row.get("cache_read_tokens") or 0),
                    "duration_ms": int(row.get("duration_ms") or 0),
                }
                for row in rows
            ],
            key=lambda item: (item.get("page_id") or 0, item.get("attempt") or 0),
        ),
    }


def duration_from_job(job: dict) -> float | None:
    finished = job.get("finished_at")
    started_at = job.get("started_at") or job.get("created_at")
    if not finished or not started_at:
        return None
    try:
        begin = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(finished).replace("Z", "+00:00"))
    except ValueError:
        return None
    return round((end - begin).total_seconds(), 1)


def main() -> None:
    attach_id = os.environ.get("P13_JOB_ID")
    before = api_get(f"/api/decks/{DECK_ID}")
    started = time.monotonic()
    if attach_id:
        job_id = int(attach_id)
        job = api_get(f"/api/deck-jobs/{job_id}")
    else:
        job = {}
        created = client.post(
            f"/api/decks/{DECK_ID}/build", json={"rebuild_all": True}, headers=headers
        )
        created.raise_for_status()
        job_id = created.json()["job_id"]

    snapshots: list[dict] = []
    while job.get("status") not in ("done", "partial", "failed", "canceled"):
        job = api_get(f"/api/deck-jobs/{job_id}")
        snapshots.append(
            {
                "at_s": round(time.monotonic() - started, 1),
                "status": job["status"],
                "ready_pages": job["ready_pages"],
                "failed_pages": job["failed_pages"],
                "total_pages": job["total_pages"],
            }
        )
        if job["status"] in ("done", "partial", "failed", "canceled"):
            break
        if time.monotonic() - started > TIMEOUT:
            client.post(f"/api/decks/{DECK_ID}/cancel", headers=headers)
            raise SystemExit(f"E2E 超时（>{TIMEOUT}s）")
        time.sleep(5)

    duration = duration_from_job(job) or round(time.monotonic() - started, 1)
    after = api_get(f"/api/decks/{DECK_ID}")
    pages: list[dict] = []
    for summary in sorted(after["pages"], key=lambda item: item["ordinal"]):
        entry = {
            "id": summary["id"],
            "ordinal": summary["ordinal"],
            "title": summary["manifest_title"] or summary["title"],
            "status": summary["status"],
            "validation_status": summary["validation_status"],
            "validation_issue_count": summary["validation_issue_count"],
            "teaching_role": summary["teaching_role"],
            "teaching_score": summary["teaching_score"],
            "check_count": summary["check_count"],
            "estimated_minutes": summary["estimated_minutes"],
        }
        if summary["status"] == "ready" and summary["has_bundle"]:
            response = client.get(
                f"/api/decks/{DECK_ID}/pages/{summary['id']}/bundle", headers=headers
            )
            if response.status_code == 200:
                bundle = response.json()
                manifest = bundle.get("manifest") or {}
                teaching = manifest.get("teaching") or {}
                entry["bundle"] = {
                    "schema_version": bundle.get("schema_version"),
                    "runtime_version": bundle.get("runtime_version"),
                    "design_system": manifest.get("design_system"),
                    "page_id": manifest.get("page_id"),
                    "css_bytes": len((bundle.get("css") or "").encode("utf-8")),
                    "html_bytes": len((bundle.get("html") or "").encode("utf-8")),
                    "js_bytes": len((bundle.get("js") or "").encode("utf-8")),
                    "source_refs": len(manifest.get("source_refs") or []),
                    "teaching": {
                        "role": teaching.get("role"),
                        "objectives": len(teaching.get("objectives") or []),
                        "chain": len(teaching.get("chain") or []),
                        "checks": len(teaching.get("check") or []),
                    },
                }
            else:
                entry["bundle_error"] = response.status_code
        pages.append(entry)

    events: list[dict] = []
    after_id = 0
    while True:
        batch = api_get(f"/api/deck-jobs/{job_id}/events?after_id={after_id}")
        events.extend(batch)
        if len(batch) < 500:
            break
        after_id = int(batch[-1]["id"])
    event_retry_pages = {
        event["page_id"] for event in events if event.get("type") == "retry" and event.get("page_id")
    }
    event_rebuilt_pages = {
        event["page_id"]
        for event in events
        if event.get("type") == "page_ready" and event.get("page_id")
    }
    raw_usage = load_usage(job_id)
    usage_source = "db"
    builds: list[dict] = []
    if not raw_usage or len(event_rebuilt_pages) < 14:
        builder_usage, builds = load_builder_data()
        if not raw_usage:
            raw_usage = builder_usage
            usage_source = "builder_snapshots" if raw_usage else "none"
    usage = summarize_usage(raw_usage)

    # 后端事件镜像有 200 条上限，缺失时用 Builder 快照补齐本 job 的构建页
    job_started = str(job.get("started_at") or job.get("created_at") or "")
    build_pages = {
        build["page_id"]
        for build in builds
        if build.get("created_at") and (not job_started or str(build["created_at"]) >= job_started)
    }
    first_pass_source = "events"
    if len(event_rebuilt_pages) < 14 and build_pages:
        first_pass_source = "builder_snapshots"
    rebuilt_pages = sorted(event_rebuilt_pages | build_pages)
    retry_pages = sorted(
        event_retry_pages
        | {build["page_id"] for build in builds if int(build.get("attempts") or 0) > 1}
    )
    first_pass_pages = [page_id for page_id in rebuilt_pages if page_id not in retry_pages]

    ready_pages = [page for page in pages if page["status"] == "ready"]
    teaching_pages = [
        page
        for page in ready_pages
        if page.get("teaching_role") and page.get("bundle", {}).get("teaching", {}).get("role")
    ]
    schema_ok = all(
        page.get("bundle", {}).get("schema_version") == "1.1" for page in ready_pages
    )
    scores = [page["teaching_score"] for page in ready_pages if page["teaching_score"] is not None]
    page_ids = [
        page.get("bundle", {}).get("page_id") for page in ready_pages if page.get("bundle")
    ]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "api": API,
        "deck_id": DECK_ID,
        "title": before["title"],
        "job": {
            "id": job_id,
            "status": job["status"],
            "total_pages": job["total_pages"],
            "ready_pages": job["ready_pages"],
            "failed_pages": job["failed_pages"],
            "error": job["error"],
            "duration_s": round(duration, 1),
        },
        "before": {
            "status": before["status"],
            "total_pages": before["total_pages"],
            "ready_pages": before["ready_pages"],
            "failed_pages": before["failed_pages"],
        },
        "after": {
            "status": after["status"],
            "total_pages": after["total_pages"],
            "ready_pages": after["ready_pages"],
            "failed_pages": after["failed_pages"],
        },
        "pages": pages,
        "snapshots": snapshots,
        "usage": usage,
        "usage_source": usage_source,
        "events": {
            "total": len(events),
            "rebuilt_pages": rebuilt_pages,
            "retry_pages": retry_pages,
            "first_pass_pages": first_pass_pages,
            "first_pass_rate": round(len(first_pass_pages) / 14, 4),
            "first_pass_source": first_pass_source,
        },
        "checks": {
            "job_reported_all_ready": job["ready_pages"] == 14 and job["failed_pages"] == 0,
            "all_pages_rebuilt": len(rebuilt_pages) == 14,
            "all_pages_ready": len(ready_pages) == len(pages) == 14,
            "no_failed_pages": after["failed_pages"] == 0,
            "all_teaching": len(teaching_pages) == len(ready_pages),
            "all_schema_1_1": schema_ok,
            "min_teaching_score": min(scores) if scores else None,
            "teaching_score_gate": bool(scores) and min(scores) >= 70,
            "unique_page_ids": len(set(page_ids)) == len(page_ids),
            "css_under_4k": all(
                page.get("bundle", {}).get("css_bytes", 99999) <= 4096 for page in ready_pages
            ),
            "usage_observed": usage.get("pages") == 14 and usage.get("attempts", 0) >= 14,
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(OUT),
                "job": report["job"],
                "after": report["after"],
                "usage": {key: usage[key] for key in ("attempts", "pages", "input_tokens", "output_tokens", "cache_read_tokens", "cache_hit_ratio")},
                "first_pass": report["events"],
                "checks": report["checks"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
