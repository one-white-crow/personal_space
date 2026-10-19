# 构建上下文为 server/（见 docker-compose.yml 的 build.context）
# 分层设计：package.json 单独一层，仅依赖变化时才重装；代码改动只影响最后几层，
# 配合 CI 的 layer cache 实现「只重建改动部分」。

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY schema.sql ./schema.sql
RUN mkdir -p /data/uploads
EXPOSE 3000
CMD ["node", "src/index.js"]
