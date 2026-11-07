"""P6 页面助手纯函数测试：上下文预算、来源裁剪、历史裁剪与进程内限流。"""
from app.services.page_chat import (
    ChatContext,
    ChatSource,
    SlidingWindowRateLimiter,
    assemble_prompt,
)


def source(index: int, content_chars: int = 1200) -> ChatSource:
    return ChatSource(
        material_id=1,
        material_name=f"资料{index}",
        section_id=index,
        heading=f"章节{index}",
        content=f"第{index}段正文" + "内容" * content_chars,
        quote=f"引用{index}",
    )


def test_assemble_prompt_includes_sources_and_refs() -> None:
    context = ChatContext(
        deck_title="数据结构",
        page_title="二分查找",
        page_info="页面：二分查找\n知识点摘要：区间不变量",
        quote="循环不变式",
        block_text="所在段落上下文",
        history=[],
        sources=[source(1), source(2)],
    )
    built = assemble_prompt(context, "为什么 mid 要向下取整？")
    assert built.messages[0]["role"] == "system"
    assert "章节1" in built.messages[0]["content"]
    assert "【来源资料】" in built.messages[0]["content"]
    assert "<<<SOURCES_" in built.messages[0]["content"]
    assert "<<<END_SOURCES_" in built.messages[0]["content"]
    assert built.messages[-1]["role"] == "user"
    assert "为什么 mid 要向下取整" in built.messages[-1]["content"]
    assert "循环不变式" in built.messages[-1]["content"]
    assert len(built.refs) == 2
    assert built.stats["chars"] <= 14000


def test_assemble_prompt_trims_history_before_sources() -> None:
    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": "历史" * 1200}
        for index in range(10)
    ]
    context = ChatContext(
        deck_title="数据结构",
        page_title="二分查找",
        page_info="页面信息" * 200,
        quote="",
        block_text="",
        history=history,
        sources=[source(1, 1200), source(2, 1200)],
    )
    built = assemble_prompt(context, "问题")
    assert built.stats["history_trimmed"] > 0
    assert built.stats["chars"] <= 14000
    # 来源优先保留，问题固定保留
    assert built.refs
    assert "问题" in built.messages[-1]["content"]


def test_assemble_prompt_without_sources_still_answers_from_page() -> None:
    context = ChatContext(
        deck_title="数据结构",
        page_title="二分查找",
        page_info="页面摘要：本页讲解二分查找",
        quote="",
        block_text="",
        history=[],
        sources=[],
    )
    built = assemble_prompt(context, "这页讲了什么？")
    assert "（无可用来源段落）" in built.messages[0]["content"]
    assert built.refs == []


def test_assemble_prompt_hard_caps_oversized_inputs() -> None:
    """问题/页面信息也可能超预算；最终必须硬性裁剪到 14k 以内。"""
    context = ChatContext(
        deck_title="数据结构",
        page_title="二分查找",
        page_info="页面信息" * 3000,
        quote="选中文本" * 600,
        block_text="段落上下文" * 700,
        history=[
            {"role": "user" if index % 2 == 0 else "assistant", "content": "历史" * 1500}
            for index in range(10)
        ],
        sources=[source(1, 3000), source(2, 3000), source(3, 3000)],
    )
    built = assemble_prompt(context, "问题" * 4000)
    assert built.stats["chars"] <= 14000
    assert built.messages[-1]["content"]
    assert built.messages[-1]["role"] == "user"


async def test_rate_limiter_blocks_after_limit_and_recovers() -> None:
    now = [100.0]
    limiter = SlidingWindowRateLimiter(limit=2, window=60, clock=lambda: now[0])
    assert (await limiter.hit(1))[0] is True
    assert (await limiter.hit(1))[0] is True
    allowed, retry_after = await limiter.hit(1)
    assert allowed is False
    assert retry_after >= 1
    now[0] += 61
    assert (await limiter.hit(1))[0] is True


async def test_rate_limiter_is_per_user() -> None:
    limiter = SlidingWindowRateLimiter(limit=1, window=60, clock=lambda: 0.0)
    assert (await limiter.hit(1))[0] is True
    assert (await limiter.hit(2))[0] is True
    assert (await limiter.hit(1))[0] is False