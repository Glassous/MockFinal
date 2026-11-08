# backend/ 已弃用（Deprecated）

本目录是迁移前自托管服务器的 FastAPI + PostgreSQL + 阿里云 OSS 实现，**不再部署、不再接收新功能**。

当前生产形态是 Qoder Sites 全量 Serverless：

- 函数与路由：`functions/`（唯一 Edge Function `app`）
- 数据库 schema：`functions/migrations/`
- 前端：`frontend/`（构建产物 `frontend/dist`）
- 平台边界与常量：`docs/serverless/PLATFORM_LIMITS.md`

保留本目录仅用于：

1. 回滚参考：若 Serverless 迁移出现问题，可恢复到迁移前的自托管部署；
2. 契约对照：核对错误文案、响应字段与旧测试用例。

请勿在此新增功能或修改业务行为；如需变更接口契约，请同步 `functions/` 与 `frontend/`。
