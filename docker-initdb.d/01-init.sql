-- 首次初始化数据库时由 postgres 镜像自动执行（仅当数据卷为空时）
-- 启用 pgvector 扩展，供 langchain-postgres PGVectorStore 使用
CREATE EXTENSION IF NOT EXISTS vector;
