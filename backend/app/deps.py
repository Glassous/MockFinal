"""共享依赖：Bearer JWT 鉴权 → 当前用户。"""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import User
from .security import decode_token

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="未提供认证凭证")
    decoded = decode_token(credentials.credentials, purpose="access")
    if decoded is None:
        raise HTTPException(status_code=401, detail="登录状态无效或已过期，请重新登录")
    user_id, tv = decoded
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    # token_version 校验（#21）：改密后旧 access token 的 tv 落后，立即失效
    if user.token_version != tv:
        raise HTTPException(status_code=401, detail="登录状态已失效，请重新登录")
    return user
