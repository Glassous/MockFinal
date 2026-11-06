"""密码哈希（bcrypt）与 JWT 签发/校验。"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

# bcrypt 输入上限 72 字节
_BCRYPT_LIMIT = 72


def _truncate(data: bytes) -> bytes:
    return data[:_BCRYPT_LIMIT]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_truncate(password.encode("utf-8")), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_truncate(password.encode("utf-8")), password_hash.encode())
    except ValueError:
        return False


def normalize_answer(answer: str) -> str:
    """安全问题答案：strip + lower 后再哈希。"""
    return answer.strip().lower()


def hash_answer(answer: str) -> str:
    return hash_password(normalize_answer(answer))


def verify_answer(answer: str, answer_hash: str) -> bool:
    return verify_password(normalize_answer(answer), answer_hash)


def create_access_token(user_id: int, token_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "tv": int(token_version),
        "purpose": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_reset_token(user_id: int, token_version: int = 0) -> str:
    """找回密码用短期 token（契约：10 分钟，purpose=reset）。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "tv": int(token_version),
        "purpose": "reset",
        "iat": now,
        "exp": now + timedelta(minutes=settings.reset_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, purpose: str) -> tuple[int, int] | None:
    """校验 token，返回 (user_id, token_version)；无效/过期/purpose 不匹配返回 None。"""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != purpose:
        return None
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    # 旧 token 可能无 tv claim，默认 0
    try:
        tv = int(payload.get("tv", 0))
    except (TypeError, ValueError):
        tv = 0
    return user_id, tv
