# Square app — Node.js (ARM64). 로컬 x86에서 buildx로 arm64 빌드 후 Docker Hub push.
FROM node:20-alpine AS deps
WORKDIR /app
# better-sqlite3 등 네이티브 모듈 컴파일 도구
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /data/uploads
EXPOSE 3000
CMD ["node", "src/server.js"]
