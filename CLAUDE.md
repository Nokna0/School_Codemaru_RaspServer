# CLAUDE.md — Square 백엔드 재구축 작업 지침

## 이 저장소는 무엇인가
원본 커뮤니티 사이트 **squarecj.com**(청주고 Square, Next.js + Supabase)을, 사용자의
**라즈베리파이 3B+** 자체호스팅 환경(Docker + Nginx + Cloudflare Tunnel, 도메인
`codemaru.store`)에서 돌아가도록 **풀스택으로 재구축**하는 프로젝트다.

- `reference-mirror/` = 캡처한 **원본 사이트(읽기 전용 참고)**. 디자인,마크업,동작의 기준.
  편집,서빙하지 말 것. 컴파일된 번들이므로 그대로 재사용 불가.
- `app/` = 우리가 만드는 **새 백엔드 + 정적 프론트엔드**.
- `docs/` = 스펙(아래 "먼저 읽기").

## 핵심 결정 (바꾸지 말 것)
- **Supabase 사용 안 함.** 파이 1GB RAM에 과중. 자체 구현으로 대체:
  - DB: **SQLite**(`better-sqlite3`) · 인증: **자체 JWT + httpOnly 쿠키** + `bcryptjs`
  - 실시간: **WebSocket**(`@fastify/websocket`) · 업로드: 로컬 디스크(`/data/uploads`)
  - 외부 연동: **NEIS**(급식/시간표)
- 프레임워크: **Fastify**(Node 20, ESM). 무거운 SSR 프레임워크,ORM 지양.
- 기존 배포 파이프라인 유지: x86에서 `buildx`로 ARM64 빌드 → Docker Hub → 파이가 pull.

## 먼저 읽기 (docs/)
1. `BACKEND_SPEC.md` — 아키텍처,스택,배포,디렉토리.
2. `FEATURES.md` — 기능 명세(캡처 화면 기반).
3. `API_CONTRACT.md` — REST/WS 엔드포인트 계약(원본 23개 기준).
4. `DATA_MODEL.md` — SQLite 스키마(`app/src/db/schema.sql`).
5. `FRONTEND_REBUILD.md` — 정적 프론트 재구축,에셋 재사용.
6. `ROADMAP.md` — **단계별 구현 순서. 여기 0단계부터 시작.**
7. `INTEGRATION.md` — 기존 GitHub 저장소(설정 파일 보유)와 합치는 법 + 저장소 설정 수정점.

## 인프라 설정 위치 (중요)
`docker-compose.yml`, `nginx/`, 루트 `Dockerfile`, `app/Dockerfile`, `.gitignore`는 이 폴더에
두지 않는다 — **기존 저장소 `Nokna0/School_Codemaru_RaspServer`에 있는 것을 사용**한다.
단, 그 파일들은 구(舊) 정적 서버용이라 새 백엔드(의존성 설치, `src/server.js`, SQLite 볼륨,
WebSocket)에 맞게 **수정이 필요**하다. 정확한 변경점은 `docs/INTEGRATION.md` 참고.

## 바로 시작하기
```bash
cd app
npm install
npm run dev          # node --watch src/server.js
curl localhost:3000/api/health   # {ok:true} 확인
```
- 이미 도는 스캐폴드: `server.js`(부팅/정적/WS 등록), `db/`(SQLite+schema),
  `lib/auth.js`(JWT), `lib/neis.js`(NEIS), `routes/auth.js`,`routes/posts.js`(예시), `realtime/ws.js`.
- `ROADMAP.md` 순서대로 라우트 모듈을 추가하고 `server.js`에 register 한다(주석에 등록 위치 표시됨).

## 작업 규칙
- 새 기능 = `app/src/routes/<feature>.js` 모듈(Fastify 플러그인) + 필요한 스키마.
  스키마 변경은 `schema.sql`에 반영(모두 `IF NOT EXISTS`) + 마이그레이션 주의(`DATA_MODEL.md`).
- 모든 입력은 `zod`로 검증. 보호 라우트는 `requireAuth`/`requireAdmin` 훅 사용.
- 원본 동작이 모호하면 `reference-mirror`의 청크,HTML에서 경로,필드명을 검색해 확인.
- 비밀,키는 코드에 박지 말 것 → `.env`(`app/.env.example` 참고). 원본 번들의 옛 Supabase
  주소,키는 무시(폐기).
- 파이 성능 고려: 인덱스 활용, N+1 지양, NEIS,핫스코어 캐시, WS 메시지 길이,빈도 제한.
- 보안: 비밀번호 해시, 권한 체크, 업로드 MIME/크기 검증, 렌더링 시 XSS escape, 익명글도 author 내부 보관.

## 완료 기준(단계별)
각 단계 종료 시 `docker compose up`(또는 `npm run dev`)으로 해당 화면,API가 실제 동작해야 한다.
프론트엔드 화면은 `reference-mirror`의 모양,문구와 일치하도록 맞춘다.
