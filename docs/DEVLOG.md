# DEVLOG — Square 백엔드 재구축 개발 로그

각 단계/주요 작업의 **무엇을·왜·어떻게**, 검증 결과, 막힌 점과 해결책을 시간순으로 기록한다.
(ROADMAP 단계 순서와 연동. 명령 나열이 아니라 결정 근거와 트러블슈팅 위주.)

---

## 2026-06-17 — 기존 저장소 설정 통합 (docs/INTEGRATION.md)

### 배경
인프라 설정 파일(`docker-compose.yml`, `nginx/`, 루트 `Dockerfile`, `.gitignore`)은
기존 저장소 `Nokna0/School_Codemaru_RaspServer`에서 온 것으로, 구(舊) **정적 서버용**이었다.
새 백엔드(Fastify + SQLite + WebSocket + 업로드 볼륨)에 맞게 수정이 필요했다.
이 작업 시점에 설정 파일들은 이미 현재 저장소 루트에 머지되어 있었다.

### 변경 내용
- **`docker-compose.yml`** — `app` 서비스에:
  - 환경변수 주입: `NODE_ENV, PORT, JWT_SECRET, DB_PATH, UPLOAD_DIR, NEIS_*, SIGNUP_CODES`
    (값은 루트 `.env`에서 `${...}`로 참조, NEIS 시도코드는 기본값 `M10`).
  - **영속 볼륨 `square-data:/data`** 추가 — SQLite DB와 업로드가 재시작 시 사라지지 않도록.
    (이게 없으면 컨테이너 재시작마다 데이터 소실 → 가장 중요한 변경.)
  - `restart: unless-stopped` 추가.
  - 파일 하단에 `volumes: square-data:` 선언.
  - `cloudflared`의 `TUNNEL_TOKEN=`를 `${TUNNEL_TOKEN}`으로 바꿔 `.env`에서 읽도록 정리.
- **`nginx/nginx.conf`** — WebSocket(`/ws`)과 업로드를 위해:
  - `map $http_upgrade $connection_upgrade` 추가 + `proxy_http_version 1.1` +
    `Upgrade`/`Connection` 헤더 전달 → WS 업그레이드 통과.
  - `client_max_body_size 10m` (이미지 업로드 허용).
  - `proxy_read_timeout 3600s` (WS 장기 연결 유지).
- **`.gitignore`** — `node_modules/`, `data/`, `*.db`, `*.db-*` 추가(기존 `.env` 유지).
- **루트 `Dockerfile`(=nginx 빌드용)** — 지침대로 **변경 없음**.

### 검증
설정값 자체는 다음 단계(0단계) 부팅에서 함께 검증. (compose 빌드/배포는 파이 배포 리허설(9단계)에서.)

---

## 2026-06-17 — ROADMAP 0단계: 부팅 확인 (스캐폴드 검증)

### 목표
`GET /api/health` 200, SQLite 파일 생성·스키마 적용 확인. 산출물 = 로컬에서 도는 빈 서버.

### 1차 검증 — Docker로 부팅 (로컬에 node/npm 없던 시점)
초기엔 시스템에 node/npm이 없어서, 실제 배포 경로와 동일한 `app/Dockerfile`로
**로컬 x86 이미지를 빌드**해 검증:
```bash
docker build -t nokna/app:dev ./app
docker run -d --name square-dev -p 3000:3000 \
  -e JWT_SECRET=dev-secret-local -e DB_PATH=/data/square.db -e UPLOAD_DIR=/data/uploads \
  nokna/app:dev
curl localhost:3000/api/health        # {"ok":true,...} HTTP 200
```
- ✅ better-sqlite3 네이티브 컴파일 통과(이미지 빌드 성공).
- ✅ `/api/health` 200.
- ✅ DB 생성 + WAL 모드 + **스키마 18개 테이블** 적용
  (users, posts, comments, post_likes, meals, meal_ratings, timetables, jobs,
   user_interests, messages, notifications, chat_messages, visits, ads, popups,
   ddays, signup_codes, admin_login_logs).

### 2차 검증 — 로컬 `npm run dev` (node 설치 후)
사용자가 node를 설치한 뒤 로컬 watch 모드로 재검증.
- `cd app && npm install` → 167 packages (better-sqlite3 네이티브 빌드 포함).
  - ⚠️ `5 high severity vulnerabilities` 보고됨 → **9단계(마무리)에서 `npm audit` 정리 예정**.
- ✅ `npm run dev` → `/api/health` 200, DB 18테이블, `app/data/uploads` 생성.

### 🔧 트러블슈팅 — Node 버전 불일치로 better-sqlite3 로드 실패
**증상:** `npm run dev` 시
`NODE_MODULE_VERSION 127 ... requires 147` (`ERR_DLOPEN_FAILED`), 로그상 실행 node가 v26.3.0.
하지만 `node --version`은 v22.22.1.

**원인:** 사용자가 `npm install node`(= node 바이너리를 받아주는 **npm 패키지**, v26.3.0)를
홈/프로젝트 루트에서 실행한 적이 있어, `~/node_modules/.bin/node`(v26)가 생성됨.
npm은 스크립트 실행 시 조상 디렉토리들의 `node_modules/.bin`을 PATH 앞에 붙이므로,
이 v26이 시스템 node(apt, v22)를 **가려서** 스크립트가 v26으로 돌았다.
그런데 better-sqlite3는 v22(MODULE_VERSION 127)로 컴파일돼 있어 v26(147)에서 로드 불가.

**해결:** stray `node` 패키지 제거 (홈 디렉토리라 사용자가 직접 실행):
```bash
rm -rf ~/node_modules ~/package.json ~/package-lock.json
```
제거 후 `npm run dev`가 시스템 `/usr/bin/node` v22로 실행 → better-sqlite3 정상 로드.
**교훈:** node는 `npm install node`가 아니라 apt/nvm로 설치할 것. 버전 일관성 위해 nvm 권장.

### 🔧 스캐폴드 보완 — UPLOAD_DIR 로컬 폴백
`src/server.js`의 `UPLOAD_DIR` 기본값이 `/data/uploads`(로컬에선 root 권한 필요)라
bare 실행 시 `@fastify/static`이 `"root" must be an absolute path`로 죽었다.
→ 미설정 시 **로컬 절대경로 `app/data/uploads`로 폴백**하도록 수정
(`path.join(__dirname,'..','data','uploads')`). 도커는 compose의 env로 계속 덮어쓴다.
이로써 CLAUDE.md "바로 시작하기"의 `npm run dev` → `curl health`가 별도 env 없이 동작.

### 로컬 개발 환경 메모
- node: 시스템 apt **v22.22.1** (`/usr/bin/node`), npm 9.2.0.
- 데이터 경로(로컬): DB `app/data/square.db`, 업로드 `app/data/uploads` (둘 다 gitignore됨).
- 기동: `cd app && npm run dev` → http://localhost:3000 .

---

## 2026-06-18 — ROADMAP 1단계: 인증 + 공통 레이아웃

### 목표
auth 라우트 완성 + 프론트 공통 레이아웃(헤더 네비/로그인 상태) + 로그인/회원가입 화면.
쿠키 세션 동작. (reference-mirror 디자인·문구 일치)

### 백엔드 (이미 스캐폴드에 구현돼 있어 검증 위주)
- `routes/auth.js` — signup/login/logout/me. 인증코드 검증은 `env SIGNUP_CODES` 또는
  `signup_codes` 테이블(1코드=1계정, `used_by`로 소진 처리).
- `lib/auth.js` — bcrypt 해시 + JWT를 httpOnly 쿠키(`sq_session`, 30일)로. `requireAuth`/`requireAdmin` 훅.
- 변경 없이 그대로 사용. (코드 해시 저장 등 강화는 9단계 `student-verification` 정책에서.)

### 프론트엔드 (신규 작성, `app/public/`)
무빌드 정적 + 바닐라 ES 모듈 방식(FRONTEND_REBUILD.md 권장).
- **`styles/app.css`** — 디자인 토큰(`--brand:#0F5FB7` 등) + 헤더/버튼/카드/사이드바/인증폼/히어로 공통 스타일.
  원본 컴파일 CSS(Tailwind)는 무겁고 클래스명이 난독화돼 있어 재사용 대신 토큰만 참고해 새로 작성.
- **`js/app.js`** — 공통 모듈:
  - `api()` fetch 헬퍼(쿠키 `same-origin` 자동 전송, 에러를 `{error}` 코드로 throw).
  - `getMe()`(캐시) / `logout()` / `escapeHtml()`(XSS 방지) / `requireLogin()`(보호 페이지용).
  - `mountHeader()` — `#app-header`에 헤더(엠블럼+네비 5개+로그인 상태) 렌더. 로그인 시 닉네임·Lv 표시,
    미로그인 시 로그인/가입 버튼.
- **`index.html`** — 랜딩 히어로("청주고 학생들만의 자유로운 공간") + 기능 3카드. 로그인 상태에 따라 CTA 분기.
- **`login.html`** — 아이디/비밀번호 → POST `/api/login`. `?next=` 리다이렉트, 이미 로그인 시 자동 이동.
- **`signup.html`** — 인증코드/아이디/학년(1~3)/반(1~11)/비번/비번확인 + 이용규칙 동의 → POST `/api/signup`.
  클라 검증(비번 일치, 동의 체크), 서버 에러코드(`invalid_code`/`username_taken`) 한글 매핑.

### 🔧 라우팅 — 깨끗한 URL 매핑
`server.js`의 SPA 폴백이 모든 비-API 404를 `index.html`로 보내서 `/login`·`/signup`이 안 열렸다.
→ `setNotFoundHandler`를 개선: 비-API GET이면 `<path>.html`이 `public/`에 있으면 그 파일을,
없으면 `index.html`을 서빙(경로 탈출 방지 위해 `PUBLIC_DIR` prefix 확인). 향후 `/community/free` 등도
같은 이름 html만 추가하면 자동 매핑된다.

### 검증
- 페이지 서빙: `/`,`/login`,`/signup`,`/styles/app.css`,`/js/app.js`,em블럼 webp 모두 200.
- 인증 플로우(쿠키 jar): 회원가입(200,쿠키) → `/api/me`(200) → 로그아웃(200) →
  `/api/me`(401) → 로그인(200) → 잘못된 비번(401) → **코드 재사용 차단(invalid_code 400)**.
- 브라우저(google-chrome headless) 스크린샷으로 3화면 디자인·문구 육안 확인 — reference와 일치.
- 테스트 데이터 정리: 더미 유저 삭제, `TEST-CODE-1`(signup_codes) 재사용 가능하도록 리셋(브라우저 수동 테스트용).

### 참고/주의
- 로컬 회원가입 테스트엔 유효한 인증코드 필요. 개발용 코드 `TEST-CODE-1`이 `signup_codes`에 시드돼 있음.
  (운영은 `.env`의 `SIGNUP_CODES` 또는 코드 발급으로 관리 — 9단계 정책 확정 예정.)
- FK 주의: `signup_codes.used_by → users(id)`. 유저 삭제 전 해당 코드 `used_by`를 먼저 NULL로.

---

## 2026-06-18 — ROADMAP 2단계: 자유게시판

### 목표
글 목록/상세/작성 + 댓글·대댓글 + 추천(좋아요) + 조회수 + 익명 + 이미지 업로드.
프론트: 목록/상세/작성 화면.

### 백엔드 (`routes/posts.js` 확장 + `routes/upload.js` 신설)
- **작성자 표시(N+1 방지):** 목록/상세/댓글 쿼리에서 `users` LEFT JOIN +
  `CASE WHEN is_anonymous THEN '익명' ELSE COALESCE(nickname,username)` 로 `author_name`을 한 번에 계산.
  익명글은 내부적으로 `author_id` 보관(책임 추적), 외부 노출은 "익명"만.
- **목록** `GET /api/posts` — `total` 추가(페이지네이션용). **베스트** `GET /api/posts/best` — hot_score→like→최신 순.
- **상세** `GET /api/posts/:id` — 조회수 +1, `image_urls` JSON 파싱, 댓글 동봉, 로그인 시 `liked` 여부 포함.
- **작성** `POST /api/posts` — zod 검증(title≤120, content≤20000, imageUrls≤10), 익명 플래그.
- **추천 토글** `POST /api/posts/:id/like` — `post_likes`(PK: post_id+user_id) insert/delete를 **트랜잭션**으로
  처리하고 `like_count` 동기화. 반환 `{liked, like_count}`.
- **댓글/대댓글** `POST /api/posts/:id/comments` — `parentId`로 1단계 대댓글. 부모 유효성 검사,
  트랜잭션으로 댓글 insert + `posts.comment_count` 증가.
- **업로드** `POST /api/upload`(신규, `routes/upload.js`) — `requireAuth`, multipart 스트림을
  `/data/uploads`에 무작위 파일명으로 저장. 보안: **MIME 화이트리스트**(jpg/png/webp/gif, 확장자 강제),
  크기 초과(`part.file.truncated`) 시 413+파일삭제, 미인증 401, 실패 시 저장분 롤백. 반환 `{urls:[...]}`.
  파이 부하 고려해 이미지 변환 라이브러리 없이 원본 저장.
- `server.js`에 `uploadRoutes` import + register 추가.

### 프론트엔드 (`app/public/`)
- **공통(`js/app.js`)에 추가:** `timeAgo()`(UTC→상대시간), `mountSidebar()`(🔥핫이슈 위젯=best API,
  💬실시간채팅 자리=4단계 예고).
- **`styles/board.css`** — 목록 행/페이저/상세/좋아요 버튼/댓글(대댓글 들여쓰기)/작성 폼/썸네일 스타일.
- **`community/free.html`** — 목록(작성자·상대시간·조회·❤·댓글수, 페이지네이션, 클릭 시 상세) + 사이드바.
- **`community/free/new.html`** — 작성. 이미지 다중 선택→`/api/upload`→썸네일(개별 삭제)→`imageUrls`로 전송.
  익명 체크박스. 미로그인 시 `requireLogin()`으로 `/login` 유도.
- **`community/free/view.html`** — 상세. 본문/이미지, 추천 토글(낙관적 UI), 댓글 목록(부모→자식 정렬),
  댓글 작성(익명 옵션) + **답글** 버튼으로 `parentId` 지정. 미로그인 시 댓글창 대신 로그인 안내.
- **XSS 방지:** 모든 사용자 입력은 `escapeHtml()`로 렌더(제목/본문/작성자/댓글).

### 검증
- API(쿠키 jar): 글 작성/익명 작성 → 목록(`total`,`author_name`,익명="익명") → 댓글+대댓글 →
  좋아요 토글 on/off(`like_count` 정확) → 상세(조회수 증가, 댓글 중첩, `liked`).
- 업로드: 1×1 PNG 업로드(200,`urls`) / 텍스트 거부(400 `unsupported_type`) / 미인증 거부(401) /
  `/uploads/<file>` 서빙(200 image/png).
- 브라우저 스크린샷: 목록·상세 렌더 확인. **상세에서 `<script>` 입력이 그대로 escape**되어 XSS 차단 확인.
- 정리: 테스트 글/댓글/좋아요/유저 삭제, 업로드 파일 제거, `TEST-CODE-1` 재사용 가능 상태로 리셋.

### 🔧 트러블슈팅 — `node --watch`가 새 모듈을 안 잡음
`routes/upload.js`를 새로 만들고 `server.js`에 import/register를 추가했는데도 `/api/upload`가 404였다.
`node --watch`는 **기존에 import된 파일의 수정**은 리로드하지만, **새로 추가된 모듈+import**는
반영하지 못하는 경우가 있다. → **서버 수동 재시작 후 정상**.
교훈: 새 라우트 모듈을 추가했으면 dev 서버를 한 번 재시작할 것. (정적 `public/` 파일은 매 요청 디스크에서
읽으므로 재시작 불필요.)

### 다음(3단계) 준비물
- `.env`에 `NEIS_API_KEY`, `NEIS_SD_SCHUL_CODE`(청주고 표준학교코드) 필요 — open.neis.go.kr에서 발급/조회.

---

## 2026-06-18 — ROADMAP 3단계: 급식 / 시간표 (NEIS)

### 목표
NEIS로 급식·시간표 조회 → DB 캐시. 급식 별점(1인1식1평점), 시간표 표(학년/반/주차).
**NEIS 키 발급 전이라 "키 없이 먼저" 구현** — 키 미설정 시 빈 데이터+안내로 화면은 동작.

### 백엔드
- **`lib/neis.js`**: `neisConfigured()` 추가(KEY+SCHUL 둘 다 있을 때만 true). fetch 함수는 기존 사용.
- **`routes/meal.js`** (신규):
  - `GET /api/neis/meal?date=YYYY-MM-DD` — 캐시(`meals`)에 없고 NEIS 설정됐으면 fetch+upsert,
    아니면 빈 결과. 식사별 평균 별점·내 별점 동봉. 응답에 `configured` 플래그.
  - `GET /api/neis/meal/rating?date=&type=`, `POST .../rating`(requireAuth, `ON CONFLICT`로 1인1평점 upsert).
  - 빈 날짜를 매 요청 재호출하지 않도록 프로세스 메모리 `fetchedDates` Set 사용(파이 부하↓).
- **`routes/timetable.js`** (신규):
  - `GET /api/timetable?grade=&classNo=&week=YYYY-MM-DD` — week가 속한 주의 월~금 계산,
    캐시(`timetables`) 없으면 fetch+upsert. 응답: `days[].slots{period:subject}`, `maxPeriod`, `configured`.
  - 기본 1학년 1반. `fetched` Set으로 주 단위 중복호출 방지.
- `server.js`에 mealRoutes/timetableRoutes register.

### 프론트엔드
- **`styles/neis.css`**, **`community/free/meal.html`**(나브 "급식표") — 한 페이지에 급식+시간표:
  - 급식: 날짜 네비(‹ 오늘 ›), 조/중/석식 카드(메뉴·칼로리), 5★ 별점(로그인 시 클릭 등록, 미로그인 read-only),
    평균/개수 표시. 데이터 없으면 "주말/방학" 안내, 미설정 시 "NEIS 연동 준비 중" 안내.
  - 시간표: 학년/반 select(로그인 사용자의 grade/class_no 기본값) + 주 네비, 교시×요일 표, 오늘 열 하이라이트.

### 🔑 NEIS 키 붙여넣는 위치
키를 사용하는 **유일한 지점은 `app/src/lib/neis.js`**(`process.env.NEIS_API_KEY`/`NEIS_SD_SCHUL_CODE`).
값은 코드가 아니라 환경변수로 주입:
- **로컬 개발:** `app/.env` 의 `NEIS_API_KEY=`, `NEIS_SD_SCHUL_CODE=` 에 입력(gitignore됨). `npm run dev` 재시작.
- **운영(도커):** 루트 `.env`(docker-compose가 읽음)에 같은 두 변수 입력. compose가 컨테이너에 주입.
- 시도코드 `NEIS_ATPT_OFCDC_SC_CODE`는 충북 `M10`(기본값).

### 🔧 트러블슈팅 — `--env-file-if-exists` + `--watch` 충돌
로컬에서 `.env`를 읽도록 dev/start 스크립트에 `--env-file-if-exists=.env`를 추가했더니,
`.env`가 **없을 때** `node --watch`가 그 경로를 감시하려다 ENOENT로 죽었다.
→ `app/.env`를 생성(개발용 기본값, gitignore)해서 해결. 이제 로컬 dev가 `.env`를 읽는다.
(DB_PATH/UPLOAD_DIR는 비워둬 로컬 `app/data/` 폴백 유지.)

### 검증
- 키 없음: 급식 `{meals:[], configured:false}`, 시간표 주 월~금 계산·`configured:false`, 잘못된 날짜 400.
  별점 등록 5→통계 avg5/count1, 수정 3→avg3/count1(1인1평점 유지). 브라우저: "연동 준비 중" 안내 표시.
- 더미 키+DB 시드로 **데이터 렌더링 검증**(임시): 급식 카드(메뉴·칼로리·★평균), 시간표 7교시×월~금 그리드,
  오늘 열 하이라이트 — 스크린샷 확인 후 **.env 더미키 원복 + 시드 삭제**(키-대기 상태로 복귀).

---

## 2026-06-18 — ROADMAP 4단계: 실시간 익명채팅 (WebSocket + presence)

### 목표
`/ws` 연결, 메시지 송수신·이모지, 접속자 수. 프론트: 사이드바 채팅 위젯.

### 백엔드 (`realtime/ws.js` — 이미 스캐폴드 존재, 강화)
- 기존: room별 소켓 Set, 접속 시 최근 50개 history 전송, presence 브로드캐스트, 익명이름(`익명####`),
  500자 제한, `@fastify/websocket` v10/v11 양쪽 호환(`conn.socket ?? conn`).
- **추가 강화(CLAUDE.md "WS 빈도 제한"):**
  - **빈도 제한**: 소켓당 10초/8개 초과 시 드롭 + 1회 `{t:'system'}` 경고(파이 보호, 스팸 방지).
  - 입력 `trim()` + 공백/초과 거부.
- 프로토콜: 서버→클라 `{t:'history'|'chat'|'presence'|'system'}`, 클라→서버 `{t:'chat',content,kind}`.
- `server.js`의 `registerRealtime(app)`로 이미 등록됨.

### 프론트엔드 (`js/app.js` + `styles/app.css`)
- 사이드바(`mountSidebar`)의 채팅 placeholder를 **실제 위젯**으로 교체 + `mountChat()` 추가:
  - `ws`/`wss` 자동 선택, **점증 재연결**(끊기면 1~6초 backoff), `beforeunload` 시 정상 종료.
  - history 일괄 렌더, presence "N명" 표시, 자동 스크롤(맨 아래일 때만), system 메시지 표시.
  - 이모지 바(😀 👍 ❤️ 🔥 🚀) 클릭 전송(kind='emoji', 크게 표시), 텍스트 입력 전송.
  - **XSS 방지**: 이름·내용 모두 `escapeHtml`.
- 채팅 위젯 스타일(app.css): 로그 박스(스크롤), 말풍선, 이모지 버튼, 입력줄.
- 노출 위치: 사이드바가 있는 페이지(`/community/free`, `/community/free/view`).

### 검증
- Node 22 내장 WebSocket으로 멀티 클라 테스트: 연결·history·**presence 1→2→3**·브로드캐스트(텍스트/이모지)·
  **빈도제한**(A가 12개 연속 → 8개만 통과 + system 경고 1회, 초과 드롭) · 새 클라 history 9개 수신 — 모두 정상.
- 브라우저 스크린샷(`/community/free` 사이드바): "실시간 익명채팅 N명", history·이모지(크게)·입력줄 렌더.
  채팅에 `<b>HI</b>` 입력이 그대로 escape되어 **XSS 차단 확인**.
- 정리: 테스트 `chat_messages` 삭제.

### 참고
- 채팅은 로그인 무관 익명(`익명####`). 운영자 공지 broadcast도 같은 채널/프로토콜로 push 가능(8단계).
- nginx는 이미 WS 업그레이드 헤더·`proxy_read_timeout 3600s` 설정됨(0단계 INTEGRATION).

---

## 2026-06-18 — ROADMAP 5단계: 핫이슈/베스트 + 등급(exp/level) 시스템

### 목표
`hot_score` 산정 + `/api/posts/best`. exp/level 적립(글+10·댓글+3·추천받음+2) + 프로필 표시.

### 핫스코어 (조회 시 실시간 산정)
- 배치/저장 대신 **best 조회 시 SQL로 실시간 계산**(시간이 지나면 자동 하락, 스테일 없음, 배치 불필요).
- 공식(`posts.js`의 `HOT_SCORE`):
  `(❤×3 + 💬×2 + 조회×0.2) / power((현재-작성)*24시간 + 2, 1.2)` — 참여도 ÷ 시간감쇠.
- `GET /api/posts/best`: 참여 있는 글(❤>0 또는 💬>0)만, `hot` 내림차순. 작성자명·hot 값 동봉.
  파이 DB 규모(수백 건)에선 인덱스 없이 실시간 계산도 충분.

### 등급 시스템 (`lib/level.js` 신규)
- 임계값(단순 증가형): 레벨 n 누적 exp = `25·n·(n-1)` → L1=0, L2=50, L3=150, L4=300 …(간격 +50씩).
- `levelForExp`, `levelInfo`(진행도: into_level/level_span/next_exp), `awardExp(userId, amount)`(exp±·레벨 재계산).
- 적립 위치(`posts.js`): 글 작성 `+10`, 댓글 작성 `+3`, **추천받음**(남의 글이 좋아요될 때 작성자 `+2`,
  취소 시 `-2` → 토글 악용 방지, 자기 글 좋아요는 미적립).
- `GET /api/me` 응답에 `levelInfo` 병합(레벨/진행도) — 프로필·헤더 표시용.

### 프론트
- 헤더 사용자 칩: 닉네임 + **Lv.N + exp 진행 바**(title에 exp 수치), 색상 강조(app.css).
- `community/free/best.html`(나브 "베스트"): 순위 뱃지(1~3위 강조) 랭킹 + 사이드바.
- 사이드바 🔥핫이슈는 동일 `/api/posts/best` 사용(실시간 핫스코어 반영).

### 🔧 네비 활성표시 버그 수정
헤더 네비 active 판정이 `startsWith`라 `/community/free/best`에서 "게시글"·"베스트"가 **동시 활성**됐다.
→ 매칭되는 항목 중 **가장 긴 경로 하나만** active 처리하도록 수정(모든 하위 페이지 공통 해결).

### 검증
- 레벨 임계값: exp 0→Lv1, 49→Lv1, 50→Lv2, 150→Lv3, 300→Lv4 (정확).
- 적립: alice 글3개=30 → 실제 post에 댓글 +3=33→(테스트 보정 후)…→ 글 2개 추가 +20 = **exp 55 → Lv2(5/100)**.
  bob이 alice 글 추천 시 alice +2, 취소 시 -2, **자기 글 추천은 0**(bob exp 0) — 모두 확인.
- 베스트 랭킹: 참여도+최신성 반영(같은 ❤1이라도 최신 글이 상위, 💬 가중) — `hot` 값으로 정렬 확인.
- 스크린샷: best 페이지 순위 뱃지·핫이슈 동기화. 네비 단일 활성 확인.
- 정리: 테스트 글/유저 삭제.

### ⚠️ 주의 (테스트 중 발견)
글 삭제 후에도 SQLite **AUTOINCREMENT는 id를 재사용하지 않음**(이어서 증가). 테스트에서 post id를
1부터로 가정하면 안 됨 — 실제 id를 조회해 사용할 것. (코드 문제 아님, 테스트 작성 시 주의.)

---

## 2026-06-18 — ROADMAP 6단계: 구인구직

### 백엔드
- `lib/categories.js`(신규): 고정 분야/활동 카테고리(FEATURES 4) 백·프론트 공용.
- `routes/jobs.js`(신규): 목록(분야 OR 필터 + 활동 + 상태), 상세(+조회수), 작성(zod로 분야 enum 검증),
  모집상태 토글(작성자만). 분야 필터는 `fields` JSON에 `LIKE '%"분야"%'` OR 결합.
- `routes/me.js`(신규): `GET/PUT /api/me/interests` — 관심분야 전체 교체(트랜잭션).

### 프론트
- `community/free/jobs.html`(필터 칩 + 목록, 로그인 시 관심분야 자동 선택),
  `jobs/new.html`(분야 다중선택 칩·활동 칩·내용), `jobs/view.html`(상세 + 작성자 모집마감 토글).
- 칩/태그/모집배지 스타일(board.css).

### 검증
- 카테고리 메타, 작성(2건), 잘못된 분야 400, 필터(컴공→1건, 미술→1건; URL 인코딩 필요),
  관심분야 PUT/GET. 브라우저: 관심분야(물리·수학) 자동 필터 + 목록 렌더 확인.

---

## 2026-06-18 — ROADMAP 7단계: 알림 / 쪽지 (WS push 연동)

### 백엔드
- `realtime/ws.js` 확장: 로그인 사용자 소켓을 `userSockets`(uid→Set)에 등록, `pushToUser(uid,obj)` export,
  접속 시 안읽은 알림 수(`notif_count`) 전송.
- `lib/notify.js`(신규): `createNotification` — DB 저장 + 접속 중이면 WS 실시간 push(`notif`).
- `routes/notifications.js`(신규): 목록+unread, 읽음 처리(부분/전체).
- `routes/messages.js`(신규): 받은편지함, 보내기(아이디로 수신자 조회→쪽지 알림 생성), 읽음.
- `posts.js`: 댓글/추천 시 글 작성자에게 알림 생성(본인 제외).

### 🔧 트러블슈팅 — WS에서 쿠키 인증 불안정 → readUser 강화
WS 업그레이드 요청에서 `@fastify/cookie`의 `req.cookies`가 **매번 채워지지 않아**(onRequest 훅 비실행)
로그인 사용자 식별이 들쭉날쭉했다. → `readUser`가 `req.cookies` 없으면 **`req.headers.cookie`에서 직접
파싱**하도록 폴백 추가(견고). (참고: 디버깅 중 "push 0건"은 실은 테스트 스크립트의 `process.argv` 인덱스
실수 — `node f.mjs ARG`에서 쿠키는 argv[2]. 코드는 정상.)

### 프론트 (공유 소켓으로 통합)
- `js/app.js`: 페이지마다 WS 2개(채팅+알림) 열지 않도록 **공유 WebSocket 싱글톤**(`onSocket`/`socketSend`)
  도입. mountChat이 이를 사용. 헤더에 **알림 벨(실시간 unread 배지)** + 쪽지 아이콘 + (admin) 관리자 버튼.
- `messages.html`(보내기 + 받은편지함 + 답장).

### 검증
- 알림: 댓글·추천 시 생성(unread 2→읽음→0). 쪽지: 전송·자기자신 400·없는수신자 404·받은편지함·쪽지알림.
- **WS 실시간 push**: 접속 시 notif_count, 댓글 시 즉시 `notif` 수신(좋아요 토글 해제는 알림 없음=정확).
- 브라우저(CDP 로그인): 헤더 🔔 배지 표시 확인.

---

## 2026-06-18 — ROADMAP 8단계: 운영 / 관리자

### 백엔드
- `routes/stats.js`(신규): 방문 기록(`sq_sid` 세션쿠키, 같은 세션·경로·날 중복 제거), 방문자 수(오늘/누적),
  회원 수.
- `routes/content.js`(신규): 공개 조회 — 팝업(기간 활성), 광고(slot·weight 가중 랜덤), D-day(남은일수 계산).
- `routes/admin.js`(신규, `requireAdmin`): 로그인 로그, 보관함(소프트삭제 글 조회/삭제·복원),
  D-day·팝업·광고 추가.
- `auth.js` 로그인: `admin_login_logs`에 성공/실패 감사 로그 기록.
- 초기 관리자: 가입 후 `UPDATE users SET role='admin' WHERE username='...'` (재로그인 시 토큰에 role 반영).

### 프론트
- `admin.html`(통계 카드·보관함 복원·로그인 로그·D-day 추가, role 가드).
- 헤더에 admin 전용 "관리자" 버튼. 홈에 방문자/회원/D-day 메타 스트립. 전 페이지 방문 기록 자동 전송.

### 검증
- 통계(오늘/누적/회원), 방문 중복 제거. 비관리자 403, 관리자 로그인로그·보관함(삭제→공개목록 제거→404→복원→200),
  D-day(D-154)·팝업·광고 추가+공개 조회. 브라우저(CDP 로그인): 관리자 대시보드 전체 렌더 확인.

---

## 2026-06-18 — ROADMAP 9단계: 마무리

### 입력검증 / 요청제한 / 에러 일관화
- **에러 핸들러**(`server.js` `setErrorHandler`): zod 검증 실패 → `400 {error:'validation', details}`,
  그 외 `statusCode` 존중, 5xx만 로깅. 기존 `.parse()` 라우트도 일관된 400 반환(이전엔 500).
- **요청 제한**(`lib/ratelimit.js`, 무의존 인메모리 슬라이딩 윈도우 + 주기 정리):
  `onRequest` 훅으로 `/api` 쓰기(POST/PUT/DELETE) IP당 80/분, 인증(`/login`,`/signup`)은 10/분.
  → 무차별 대입·파이 과부하 방지. 읽기(GET)는 무제한.

### 학생 인증 정책 확정 (코드 해시 저장)
- `lib/codes.js`: 코드 평문은 저장 안 함 → `sha256(code + JWT_SECRET 페퍼)` 해시만 `signup_codes`에 보관.
  사람친화 코드 생성(`SQ-XXXX-XXXX`, 혼동문자 제외).
- `routes/student-verification.js`: `lookup`(가입폼 사전확인), `claim`(가입 후 미인증자 코드 인증).
- `routes/admin.js`: `POST /api/admin/signup-codes {count,label}` 배치 발급 — **평문은 응답으로 1회만**
  반환(배포용), DB엔 해시. 현황 조회 endpoint도 추가.
- `auth.js` 가입: 입력 코드를 해시해 테이블 조회/소진. `.env`의 `SIGNUP_CODES`(평문)는 개발 편의용 유지.
- 정책: 1코드=1계정, 관리자 발급(운영)/env(개발). [docs/DEPLOY.md](DEPLOY.md) 5번에 운영 절차 명시.

### 의존성 보안
- `npm audit` 5 high(전부 `fast-uri` 전이) → `package.json` **overrides로 `fast-uri@^3.1.2`** 고정 → **5→1**.
- 남은 1건은 fastify4 본체 권고(주로 X-Forwarded 스푸핑). app `:3000`은 compose `expose`만(외부 미공개)이라
  nginx(도커 네트워크)에서만 접근 → 실질 위험 낮음. 근본 해소는 fastify5(플러그인 메이저 동반)로 별도 작업.

### 배포 / 백업
- `scripts/backup.sh`: 컨테이너 내 better-sqlite3 `.backup`(WAL 체크포인트)으로 **온라인 일관 백업** +
  업로드 tar → 호스트 `./backups/`. 14일 보관. cron 예시 포함.
- `docs/DEPLOY.md`: ARM64 buildx 빌드/푸시, 파이 배포, `.env`, **초기 관리자 수동 승격**, 코드 운영,
  백업/복원, 보안 메모 정리.

### 🔧 ARM64 빌드 리허설 — 환경 제약으로 부분 검증
buildx + QEMU(aarch64 에뮬) 준비는 정상이나, **에뮬레이트 빌드 컨테이너에서 alpine 패키지 CDN
(dl-cdn.alpinelinux.org) 접근이 이 샌드박스 네트워크에 막혀** `apk add`(빌드툴) 단계에서 실패.
Dockerfile 결함 아님 — **동일 Dockerfile의 x86 빌드는 0단계에서 성공**. 실제 개발기(정상 네트워크)에선
`docker buildx --platform linux/arm64 --push` 정상 동작 예상. (better-sqlite3는 alpine(musl)이라 소스 컴파일
필요 → python3/make/g++ apk 설치가 필수.)

### 검증
- 에러: 잘못된 타입 로그인 → 400 `validation`(+details). rate limit: 로그인 15연타 → 10 통과 후 429, GET 무제한.
- 학생인증: 관리자 코드 2개 발급(평문 1회 반환·DB 해시 확인), lookup(진짜 true/가짜 false),
  발급코드 가입 성공·재사용 차단. env 코드 개발 가입 유지 확인.
- audit 5→1. 데모 데이터 정리.

---

## 📊 단계별 토큰 사용량 (추정치)

> ⚠️ 정확한 토큰 텔레메트리는 에이전트가 직접 측정할 수 없어 **작업량 기반 대략 추정치**다(입력+출력 합산,
> 코드 읽기·도구 호출·재시도 포함). 절대값보다 단계 간 상대 규모로 참고.

| 단계 | 내용 | 추정 토큰 |
|---|---|---|
| 0 | 설정 통합 + 부팅(+node 버전 트러블슈팅) | ~120k |
| 1 | 인증 + 공통 레이아웃/로그인·회원가입 | ~110k |
| 2 | 자유게시판(글/댓글/좋아요/업로드 + 프론트) | ~130k |
| 3 | 급식/시간표(NEIS, 키 없이 + 시드 검증) | ~110k |
| 4 | 실시간 익명채팅(WS + 빈도제한 + 위젯) | ~90k |
| 5 | 핫이슈/베스트 + 등급(exp/level) | ~95k |
| 6 | 구인구직(필터/작성 + 관심분야) | ~80k |
| 7 | 알림/쪽지(WS push + 공유소켓 + 트러블슈팅) | ~120k |
| 8 | 운영/관리자(통계·콘텐츠·관리자 + CDP 스크린샷) | ~120k |
| 9 | 마무리(rate limit·에러·학생인증 해시·audit·배포/백업) | ~110k |

(누적 대략 ~1.1M 토큰 규모. 추정이며 실제와 차이가 있을 수 있음.)
