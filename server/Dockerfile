FROM node:22-alpine AS deps
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/schema.sql ./schema.sql
RUN mkdir -p /data/uploads
EXPOSE 3000
CMD ["node", "src/index.js"]
