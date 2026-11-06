"""STS 临时凭证：前端直传 OSS 用（AssumeRole + 会话 Policy 最小权限）。

- SDK：alibabacloud_sts20150401（Client + AssumeRoleRequest）
- endpoint：sts.{region}.aliyuncs.com
- 会话 Policy 的 Version 必须是 "1"（阿里云语法，不是 AWS 的 2012-10-17），整体 ≤2048 字符
- 长期 AK 绝不出现在任何响应中，只下发临时三元组
"""
import asyncio
import json
from dataclasses import dataclass


class STSNotConfiguredError(RuntimeError):
    pass


@dataclass
class STSCredentials:
    access_key_id: str
    access_key_secret: str
    security_token: str
    expiration: str  # ISO8601


def _build_upload_policy(bucket: str, user_id: int, workspace_id: int) -> str:
    policy = {
        "Version": "1",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "oss:PutObject",
                    "oss:AbortMultipartUpload",
                    "oss:ListParts",
                ],
                "Resource": [
                    f"acs:oss:*:*:{bucket}/mockfinal/{user_id}/{workspace_id}/*",
                ],
            }
        ],
    }
    text = json.dumps(policy, separators=(",", ":"), ensure_ascii=False)
    if len(text) > 2048:
        raise ValueError("STS 会话 Policy 超过 2048 字符限制")
    return text


def _assume_role_sync(user_id: int, workspace_id: int) -> STSCredentials:
    from ..config import settings

    if not settings.sts_configured:
        raise STSNotConfiguredError("未配置 STS（缺少 OSS 配置或 STS_ROLE_ARN）")

    from alibabacloud_sts20150401 import models as sts_models
    from alibabacloud_sts20150401.client import Client as StsClient
    from alibabacloud_tea_openapi import models as open_api_models

    region = settings.sts_region or settings.oss_region
    config = open_api_models.Config(
        access_key_id=settings.alibaba_cloud_access_key_id,
        access_key_secret=settings.alibaba_cloud_access_key_secret,
        endpoint=f"sts.{region}.aliyuncs.com",
    )
    client = StsClient(config)
    request = sts_models.AssumeRoleRequest(
        role_arn=settings.sts_role_arn,
        role_session_name=f"user_{user_id}",
        duration_seconds=settings.sts_duration_seconds,
        policy=_build_upload_policy(settings.oss_bucket, user_id, workspace_id),
    )
    resp = client.assume_role(request)
    cred = resp.body.credentials
    return STSCredentials(
        access_key_id=cred.access_key_id,
        access_key_secret=cred.access_key_secret,
        security_token=cred.security_token,
        expiration=cred.expiration,
    )


async def assume_upload_role(user_id: int, workspace_id: int) -> STSCredentials:
    """异步封装（SDK 为同步实现）。"""
    return await asyncio.to_thread(_assume_role_sync, user_id, workspace_id)
