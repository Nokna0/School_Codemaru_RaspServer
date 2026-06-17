# INTEGRATION — 기존 저장소와 합치기

대상 저장소: `github.com/Nokna0/School_Codemaru_RaspServer` (branch `main`).

## 합치는 방법 (권장: app/ 통째 교체)

### 1) `app/` 폴더 통째 교체
저장소의 `app/`를 **이 폴더의 `app/`로 통째 교체**한다.
- 이 폴더 `app/`에는 새 백엔드 전부 + **올바른 `app/Dockerfile`(새 버전)**이 들어 있다.
- 교체하면 구 `app/server.js`(정적 서버)와 `app/public/{index.html,script.js,style.css}`
  (플레이스홀더)는 자연히 사라진다 — 어차피 `app/src/server.js`와 재구축 프론트가 대체.
- 즉 `app/` 안은 손볼 게 없다(Dockerfile 포함 완비).

### 2) 루트에 새 파일 추가
`CLAUDE.md`, `docs/` 를 저장소 **루트**에 추가한다(Claude Code가 읽는 지침,스펙).
`reference-mirror/`는 참고용 — 넣어도 되고 `.gitignore`로 빼도 된다.

### 3) 루트 설정 파일만 수정
`app/` 밖(루트)에 있는 설정은 교체로 해결되지 않으니 아래만 손본다.
(루트 `Dockerfile`=nginx 빌드용은 그대로 둔다.)

#### `docker-compose.yml` — app에 env + 영속 볼륨 추가
`app` 서비스에 추가(이미지명 `nokna/app`, `webnet`은 유지):
```yaml
  app:
    image: nokna/app:latest
    expose: ["3000"]
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/data/square.db
      - UPLOAD_DIR=/data/uploads
      - NEIS_API_KEY=${NEIS_API_KEY}
      - NEIS_ATPT_OFCDC_SC_CODE=${NEIS_ATPT_OFCDC_SC_CODE:-M10}
      - NEIS_SD_SCHUL_CODE=${NEIS_SD_SCHUL_CODE}
      - SIGNUP_CODES=${SIGNUP_CODES}
    volumes:
      - square-data:/data          # SQLite DB + 업로드 영구 보존 (없으면 재시작 시 소실!)
    networks: [webnet]
    restart: unless-stopped
```
파일 맨 아래에 볼륨 선언 추가:
```yaml
volumes:
  square-data:
```

#### `nginx/nginx.conf` — WebSocket 업그레이드 + 업로드 크기
```nginx
http {
    upstream app_server { server app:3000; }
    map $http_upgrade $connection_upgrade { default upgrade; '' close; }
    server {
        listen 80;
        server_name localhost;
        client_max_body_size 10m;
        location / {
            proxy_pass http://app_server;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 3600s;
        }
    }
}
```

#### `.gitignore` — 다음 항목 추가
```
node_modules/
.env
data/
*.db
*.db-*
```

## 4) `.env` 작성
`app/.env.example`를 복사해 루트(또는 compose가 읽는 위치)에 `.env`로 두고
`JWT_SECRET`, `NEIS_*`, `SIGNUP_CODES`, `TUNNEL_TOKEN`을 채운다.

## 빌드/배포 (기존 파이프라인 그대로)
```bash
docker buildx build --platform linux/arm64 -t nokna/app:latest   --push ./app
docker buildx build --platform linux/arm64 -t nokna/nginx:latest --push .   # 루트 Dockerfile=nginx
cd ~/<repo> && docker compose pull && docker compose up -d
```

> 위 2,3,4 단계는 Claude Code에게 "docs/INTEGRATION.md대로 처리해"라고 시키면 대신 해준다.
