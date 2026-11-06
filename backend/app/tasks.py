"""后台任务注册表（#6）。

fire-and-forget 的 asyncio.create_task 返回值若被丢弃，事件循环只持弱引用，
长生命周期任务（多次 LLM 调用、大量 await 让出点）可能在执行中途被 GC 回收。
这里用模块级 set 持有强引用，完成后自动移除，并对未捕获异常统一记日志。
workspaces（索引）与 generation（生成）两处共用。
"""
import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

logger = logging.getLogger(__name__)

_bg_tasks: set[asyncio.Task] = set()


def _on_done(task: asyncio.Task) -> None:
    _bg_tasks.discard(task)
    if not task.cancelled():
        exc = task.exception()
        if exc is not None:
            logger.error("后台任务未捕获异常：%r", exc)


def spawn(coro: Coroutine[Any, Any, Any]) -> None:
    """在事件循环中创建后台任务并持有强引用，避免被 GC 提前回收。"""
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_on_done)
