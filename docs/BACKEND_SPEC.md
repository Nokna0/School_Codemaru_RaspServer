# BACKEND_SPEC — 아키텍처 / 스택 / 배포

## 목표
원본 squarecj.com(Next.js + Supabase) 커뮤니티를 **자체호스팅 풀스택**으로 재구축한다.
대상 하드웨어는 **라즈베리파이 3B+(ARM64, RAM 1GB)** 이며, 기존 인프라(Docker +
Nginx + Cloudflare Tunnel, 도메인 codemaru.store)를 그대로 사용한다. Supabase는 사용하지
않는다(파이에 과중). 캡처된 프론트엔드(`reference-mirror/`)는 디자인,UX,동작 기준으로만 쓴다.

## 스택 (라즈베리파이에 가볍게)
- 런타임: Node.js 20 (ESM)
- 웹 프레임워크: Fastify
- DB: SQLite (`better-sqlite3`) — 단일 파일, 저메모리. Docker 볼륨 `square-data:/data` 에 보존
- 인증: 자체 JWT + httpOnly 쿠키(`sq_session`), 비밀번호 `bcryptjs`
- 실시간: WebSocket(`@fastify/websocket`) — 익명채팅 / 접속자 presence / 알림 push
- 파일 업로드: `@fastify/multipart` → 로컬 디스크(`/data/uploads`), Nginx/Fastify가 정적 서빙
- 외부 연동: NEIS 교육정보 개방 포털(급식/시간표), Node 내장 `fetch`
- 정적 프론트엔드: `app/public/` 를 Fastify가 서빙(SPA 폴백). 추후 Nginx 직접 서빙으로 최적화 가능

## 요청 흐름
```
사용자 → Cloudflare(HTTPS) → cloudflared 터널 → Nginx(:80, 리버스 프록시)
       → Fastify app(:3000)  ├─ /            정적 프론트엔드(public/)
                             ├─ /api/*        REST API
                             ├─ /ws           WebSocket(실시간)
                             └─ /uploads/*    업로드 파일
```
Nginx는 단순 리버스 프록시(현 구조 유지) + WebSocket 업그레이드 헤더만 추가.

## 디렉토리
```
squarecj/
├── CLAUDE.md                 # Claude Code 작업 지침(여기부터 읽기)
├── docker-compose.yml        # app + nginx + cloudflared
├── nginx/{Dockerfile,nginx.conf}
├── app/
│   ├── Dockerfile, package.json, .env.example
│   ├── src/
│   │   ├── server.js         # Fastify 부트스트랩(라우트/정적/WS 등록)
│   │   ├── db/{index.js,schema.sql}
│   │   ├── lib/{auth.js,neis.js}
│   │   ├── routes/           # 기능별 라우트 모듈(auth, posts 예시 제공)
│   │   └── realtime/ws.js    # 익명채팅/presence
│   └── public/               # 재구축할 정적 프론트엔드(폰트/아이콘/CSS 시드 제공)
├── docs/                     # 본 스펙 문서들
└── reference-mirror/         # 캡처한 원본 사이트(읽기 전용 참고)
```

## 빌드 / 배포 (기존 파이프라인 그대로)
```bash
# 로컬 x86 PC에서 ARM64 이미지 빌드 후 Docker Hub push
docker buildx build --platform linux/arm64 -t nokna/square-app:latest   --push ./app
docker buildx build --platform linux/arm64 -t nokna/square-nginx:latest --push ./nginx

# 라즈베리파이에서
cd ~/square && docker compose pull && docker compose up -d
```
환경변수는 루트 `.env`(JWT_SECRET, NEIS_*, SIGNUP_CODES, TUNNEL_TOKEN)에 둔다.

## 라즈베리파이 3B+ 주의사항
- 메모리 1GB: 무거운 ORM/번들러,Postgres,Supabase 지양. SQLite + 경량 의존성 유지.
- 네이티브 모듈(`better-sqlite3`)은 Docker 이미지 빌드 시 컴파일됨(Dockerfile에 빌드툴 포함).
- SSR 프레임워크(Next 등) 상주 지양. 정적 프론트 + 경량 API가 가장 가볍다.
- 동시 WebSocket 수가 많아질 수 있으니 채팅 메시지 길이,빈도 제한을 둔다.
