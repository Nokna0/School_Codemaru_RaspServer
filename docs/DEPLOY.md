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
- nginx: WS 업그레이드 헤더, `client_max_body_size 10m`, `proxy_read_timeout 3600s` 설정됨.
- 요청 제한: 인증 10/분·쓰기 80/분(IP별, 인메모리). 업로드 8MB·이미지 MIME 화이트리스트.
- 의존성: `fast-uri`는 overrides로 패치(3.1.2). 남은 fastify4 권고는 외부 미노출 토폴로지로 위험 낮음 →
  추후 fastify5 업그레이드 시 해소(플러그인 메이저 동반 필요, 별도 작업).
