# syntax=docker/dockerfile:1
# MockFinal Page Validator
#
# 构建上下文必须是仓库根目录（compose overlay 已配置 context: . / dockerfile: validator/Dockerfile）：
# 镜像需要同时打包 validator/ 与 shared/（共享 runtime 与 shell 的唯一来源，PAGE_CONTRACT §12.3）。
#
# 基础镜像固定与 package-lock.json 中 @playwright/test 的版本对齐（1.65.0），
# 已用 `docker manifest inspect mcr.microsoft.com/playwright:v1.65.0-noble` 确认 tag 存在。
# 升级 Playwright 属于独立 build 任务，必须同时更新本文件与锁文件。
#
# 安全边界：非 root（官方镜像内置 pwuser）、不含任何业务密钥、
# 只监听容器内部端口 9200；只读根文件系统 / tmpfs / cap_drop 由 docker-compose.pageref.yml 提供。

FROM mcr.microsoft.com/playwright:v1.65.0-noble AS build
WORKDIR /app/validator
ENV NODE_ENV=development \
    npm_config_update_notifier=false
COPY validator/package.json validator/package-lock.json ./
RUN npm ci --no-audit --fund=false
COPY validator/tsconfig.json ./
COPY validator/src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.65.0-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PAGE_SHARED_DIR=/app/shared \
    HOME=/tmp
COPY --from=build --chown=pwuser:pwuser /app/validator/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/validator/dist ./dist
COPY --from=build --chown=pwuser:pwuser /app/validator/package.json ./package.json
COPY --chown=pwuser:pwuser shared ./shared

# 官方镜像内置非 root 用户；不得改回 root，也不得以 --no-sandbox 规避权限
USER pwuser

# 仅容器内部端口，compose 不映射到宿主
EXPOSE 9200

# VALIDATOR_TOKEN 只通过环境变量注入；缺失时启动失败并输出中文提示
CMD ["node", "dist/server.js"]
