# syntax=docker/dockerfile:1
# Builder 镜像（P2 实现）：
# - Node 24 + TypeScript ESM，编译产物在 /app/dist
# - 只读 Harness 挂载到 /opt/mockfinal-pi（Skill / Prompt Template / Extension / 模板）
# - 页面代码不在 Builder 内执行：Pi 只写文件，check_page 交给 page-validator
#
# 安全边界由 docker-compose.pageref.yml 提供：只读根文件系统、/tmp 与 /tmp/builds tmpfs、
# cap_drop ALL、no-new-privileges、资源限制；镜像本身不写入任何密钥。

FROM node:24-slim AS build
WORKDIR /app
ENV NODE_ENV=development

# 依赖与编译配置：npm ci 依赖提交的 package-lock.json
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 容器内 Harness 目录；由 compose 提供只读根与 tmpfs
ENV PI_CODING_AGENT_DIR=/opt/mockfinal-pi/agent
ENV PORT=9100

# node:24-slim 内置 node 用户（uid 1000）；不得以 root 运行
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node pi-harness /opt/mockfinal-pi

USER node

# 仅容器内部端口，compose 不映射到宿主
EXPOSE 9100

# 构建目录固定为 /tmp/builds/{build_id}（tmpfs 由 compose 提供）
CMD ["node", "dist/server.js"]
