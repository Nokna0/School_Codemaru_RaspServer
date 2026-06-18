# Square app — Node.js (ARM64). 로컬 x86에서 buildx로 arm64 빌드 후 Docker Hub push.
# glibc(debian) 베이스: better-sqlite3가 사전빌드 바이너리를 받아 컴파일 불필요 → apk/apt 패키지 설치 없음.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# better-sqlite3 등은 linux/arm64 prebuilt 자동 다운로드(네이티브 컴파일 회피)
RUN npm install --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /data/uploads
EXPOSE 3000
CMD ["node", "src/server.js"]
