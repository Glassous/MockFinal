"""认证路由：注册 / 登录 / 安全问题找回密码 / 当前用户。

- 所有 bcrypt 调用（hash/verify）经 asyncio.to_thread 移出事件循环，避免阻塞（#7）
- register/reset 携带 token_version（tv）claim，改密后旧 access token 立即失效（#21）
- verify-answer 进程内简单限流：username+IP，5 次失败/15 分钟 → 429（#20）
- register 捕获 IntegrityError → 409（并发同名注册兜底）（#28）
"""
import asyncio
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    ResetTokenOut,
    SecurityQuestionOut,
    UserOut,
    VerifyAnswerRequest,
)
from ..security import (
    create_access_token,
    create_reset_token,
    decode_token,
    hash_answer,
    hash_password,
    verify_answer,
    verify_password,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ===== verify-answer 进程内限流（#20）=====
_VERIFY_WINDOW = 15 * 60  # 15 分钟
_VERIFY_MAX_FAILS = 5
_verify_failures: dict[str, list[float]] = {}
_verify_lock = asyncio.Lock()


def _rate_key(username: str, ip: str) -> str:
    return f"{username}@{ip}"


def _prune(stamps: list[float], now: float) -> list[float]:
    return [t for t in stamps if now - t < _VERIFY_WINDOW]


async def _check_verify_limit(key: str) -> None:
    """超出失败次数上限直接 429（中文提示）。"""
    now = time.monotonic()
    async with _verify_lock:
        stamps = _prune(_verify_failures.get(key, []), now)
        if stamps:
            _verify_failures[key] = stamps
        else:
            _verify_failures.pop(key, None)
        if len(stamps) >= _VERIFY_MAX_FAILS:
            raise HTTPException(status_code=429, detail="验证失败次数过多，请 15 分钟后再试")


async def _record_verify_fail(key: str) -> None:
    now = time.monotonic()
    async with _verify_lock:
        stamps = _prune(_verify_failures.get(key, []), now)
        stamps.append(now)
        _verify_failures[key] = stamps


async def _clear_verify_fails(key: str) -> None:
    async with _verify_lock:
        _verify_failures.pop(key, None)


@router.post("/register", response_model=AuthResponse, status_code=200)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    existing = await db.execute(select(User).where(User.username == username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="用户名已被注册")
    user = User(
        username=username,
        password_hash=await asyncio.to_thread(hash_password, body.password),
        security_question=body.security_question.strip(),
        security_answer_hash=await asyncio.to_thread(hash_answer, body.security_answer),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # 并发下同名注册绕过前置查询，靠唯一约束兜底（#28）
        await db.rollback()
        raise HTTPException(status_code=409, detail="用户名已被注册")
    await db.refresh(user)
    return AuthResponse(
        token=create_access_token(user.id, user.token_version),
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=AuthResponse, status_code=200)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username.strip()))
    user = result.scalar_one_or_none()
    password_ok = user is not None and await asyncio.to_thread(
        verify_password, body.password, user.password_hash
    )
    if user is None or not password_ok:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return AuthResponse(
        token=create_access_token(user.id, user.token_version),
        user=UserOut.model_validate(user),
    )


@router.get("/security-question", response_model=SecurityQuestionOut, status_code=200)
async def get_security_question(username: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == username.strip()))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return SecurityQuestionOut(question=user.security_question)


@router.post("/verify-answer", response_model=ResetTokenOut, status_code=200)
async def verify_security_answer(
    body: VerifyAnswerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    username = body.username.strip()
    ip = request.client.host if request.client else "unknown"
    key = _rate_key(username, ip)
    await _check_verify_limit(key)

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        # 用户不存在也计入失败，避免用户名枚举
        await _record_verify_fail(key)
        raise HTTPException(status_code=404, detail="用户不存在")
    answer_ok = await asyncio.to_thread(verify_answer, body.answer, user.security_answer_hash)
    if not answer_ok:
        await _record_verify_fail(key)
        raise HTTPException(status_code=400, detail="安全问题答案错误")
    await _clear_verify_fails(key)
    return ResetTokenOut(reset_token=create_reset_token(user.id, user.token_version))


@router.post("/reset-password", status_code=204)
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    decoded = decode_token(body.reset_token, purpose="reset")
    if decoded is None:
        raise HTTPException(status_code=400, detail="重置凭证无效或已过期，请重新验证安全问题")
    user_id, tv = decoded
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="用户不存在")
    # reset token 的 tv 必须与当前一致（#21）
    if user.token_version != tv:
        raise HTTPException(status_code=400, detail="重置凭证已失效，请重新验证安全问题")
    user.password_hash = await asyncio.to_thread(hash_password, body.new_password)
    user.token_version += 1  # 使所有旧 access token 立即失效（#21）
    await db.commit()
    return None


@router.get("/me", response_model=UserOut, status_code=200)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)
