# DEPLOY — 빌드 / 배포 / 운영 (라즈베리파이)

대상: `Nokna0/School_Codemaru_RaspServer` (파이3B+, Docker + Nginx + Cloudflare Tunnel, `codemaru.store`).
기존 파이프라인: x86에서 `buildx`로 ARM64 빌드 → Docker Hub → 파이가 pull.

## 1. 이미지 빌드 & 푸시 (x86 개발기)
```bash
# 앱(Node/Fastify) — ARM64
docker buildx build --platform linux/arm64 -t nokna/app:latest --push ./app
# nginx(루트 Dockerfile) — ARM64
docker buildx build --platform linux/arm64 -t nokna/nginx:latest --push .
```
> 최초 1회: `docker buildx create --use` 로 빌더 생성. `--push`는 Docker Hub 로그인 필요(`docker login`).

## 2. 배포 (라즈베리파이)
```bash
cd ~/School_Codemaru_RaspServer
# .env 준비(아래 3번) 후
docker compose pull
docker compose up -d
docker compose logs -f app   # 부팅 확인
curl -s localhost/api/health # {"ok":true} (nginx 경유)
```

## 3. 환경변수 (.env — 저장소 루트, gitignore됨)
docker-compose가 읽어 컨테이너에 주입. `app/.env.example` 참고.
```
JWT_SECRET=<openssl rand -hex 32 로 생성한 긴 무작위 값>
NEIS_API_KEY=<open.neis.go.kr 발급키>
NEIS_ATPT_OFCDC_SC_CODE=M10
NEIS_SD_SCHUL_CODE=<청주고 표준학교코드>
SIGNUP_CODES=            # 운영에선 보통 비움(코드는 관리자 발급=해시 저장). 개발 편의용.
TUNNEL_TOKEN=<Cloudflare Tunnel 토큰>
```
> `DB_PATH=/data/square.db`, `UPLOAD_DIR=/data/uploads`는 compose에 이미 지정됨(영속 볼륨 `square-data`).

## 4. 초기 관리자 부여 (가입 후 1명 수동 승격)
```bash
# 해당 사용자가 정상 가입한 뒤:
docker compose exec app node -e "require('better-sqlite3')(process.env.DB_PATH).prepare(\"UPDATE users SET role='admin' WHERE username=?\").run('너의아이디')"
# 승격 후 로그아웃→재로그인 해야 토큰(JWT)에 role=admin 이 반영됨.
```
이후 관리자 화면 `/admin` 에서 인증코드 발급/보관함/통계 사용.

## 5. 학생 인증코드 운영
- 관리자 `/admin` 또는 `POST /api/admin/signup-codes {count,label}` 로 **배치 발급**.
- 응답의 **평문 코드는 그때 1회만** 표시 → 학생에게 배포. DB엔 해시(sha256+JWT_SECRET 페퍼)만 저장.
- 1코드 = 1계정(가입 시 소진). 개발 중엔 `.env`의 `SIGNUP_CODES`(평문)로 대체 가능.

## 6. 백업 / 복원
```bash
bash scripts/backup.sh        # ./backups/square-<ts>.db , uploads-<ts>.tar.gz 생성(온라인 일관 백업)
# (cron 예) 매일 03:00:  0 3 * * * cd ~/School_Codemaru_RaspServer && bash scripts/backup.sh >> backup.log 2>&1
```
복원(컨테이너 정지 후):
```bash
docker compose stop app
docker cp backups/square-<ts>.db $(docker compose ps -q app):/data/square.db   # 또는 볼륨에 직접 복사
# uploads 복원: 볼륨의 /data 에서 tar 풀기
docker compose start app
```

## 7. 보안 / 운영 메모
- 앱 포트 `3000`은 compose에서 `expose`만(외부 미공개) → nginx(도커 네트워크)에서만 접근. 외부 직접 접속 불가.
- nginx: WS 업그레이드 헤더, `client_max_body_size 10m`, `proxy_read_timeout 3600s`, gzip + `/icons`·`/uploads` 장기캐시.
- 요청 제한: 인증 10/분·쓰기 80/분(IP별) + 로그인 계정별 잠금(10분 내 7회 실패→429). 업로드 8MB·이미지 MIME 화이트리스트.
- 보안 헤더: `@fastify/helmet`로 CSP/HSTS/X-Frame-Options 등 적용(서버에서 자동).
- 의존성: `fast-uri`는 overrides로 패치(3.1.2). 남은 fastify4 권고는 외부 미노출 토폴로지로 위험 낮음 →
  추후 fastify5 업그레이드 시 해소(플러그인 메이저 동반 필요, 별도 작업).

---

## 8. 강화 라운드 반영 배포 (2026-06-18) — ⚠️ compose 변경 포함

이번 라운드(helmet/CSP·검색·이미지 리사이즈·PWA·헬스체크·graceful shutdown)는 **이미지뿐 아니라
`docker-compose.yml`도 바뀜**(healthcheck·autoheal·`depends_on: service_healthy`). 파이의 compose를
아래처럼 갱신한 뒤 배포한다. **새 .env 변수는 없음.**

### 8-1. 바뀐 app 서비스 + 신규 autoheal (파이 docker-compose.yml에 반영)
```yaml
  app:
    # ... 기존 image/expose/environment/volumes/networks 그대로 ...
    restart: unless-stopped
    healthcheck:                  # slim 이미지엔 curl/wget 없어 node 내장 fetch 사용
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    labels:
      - autoheal=true

  autoheal:                       # unhealthy 컨테이너 자동 재시작(plain compose 보완)
    image: willfarrell/autoheal:latest
    environment:
      - AUTOHEAL_CONTAINER_LABEL=autoheal
      - AUTOHEAL_INTERVAL=30
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
```
그리고 nginx 서비스의 `depends_on`을 long-form으로:
```yaml
  nginx:
    depends_on:
      app:
        condition: service_healthy
```

### 8-2. 배포 & 확인
```bash
cd ~/School_Codemaru_RaspServer
docker compose pull
docker compose up -d
docker compose ps              # app (healthy) + autoheal Up 확인 (start_period 20s 후)
curl -s localhost/api/health   # {"ok":true}
```
- **스키마**: 부팅 시 `posts_fts`+트리거 자동 생성, 기존 글 1회 재색인(자동 마이그레이션) — 수동 작업 없음.
- **데이터 보존**: DB·업로드는 볼륨 `square-data`. `pull`/`up`/이미지 교체로 안 지워짐(단 `down -v` 금지).
- **배포 후 눈으로**: 게시판 검색창, 업로드 후 이미지 자동 축소, 모바일 "홈 화면에 추가"(PWA).
- 새 네이티브 의존성 `sharp`는 app 이미지에 포함(ARM64 prebuilt). 로드 실패해도 업로드는 원본 저장으로 degrade.
