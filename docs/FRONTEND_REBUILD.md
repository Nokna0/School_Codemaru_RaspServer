# FRONTEND_REBUILD — 프론트엔드 재구축 가이드

원본 프론트엔드는 컴파일된 Next.js 번들이라 그대로 유지,편집할 수 없다. 대신 **디자인,마크업,
동작 기준**으로 삼아 `app/public/` 에 가벼운 정적 프론트엔드를 새로 만든다(Fastify가 서빙).

## 재사용 가능한 에셋 (이미 `app/public/` 에 복사됨)
- `public/fonts/*.woff2` — 원본 웹폰트 10종.
- `public/styles/*.css` — 원본 컴파일 CSS 2개(Tailwind 기반 + 커스텀). 디자인 토큰,색상 추출에 활용.
- `public/icons/*` — favicon, 앱 아이콘(192/512), apple-touch-icon, 청주고 엠블럼(webp).
- `public/manifest.webmanifest` — PWA 매니페스트. 테마색 `#0F5FB7`.

## 마크업,디자인 참고 위치
- 페이지별 SSR HTML: `reference-mirror/index.html`, `login.html`, `signup.html`,
  `community/free*.html` (메인/구인구직/급식/베스트/최신). 레이아웃,문구,컴포넌트 구조를 그대로 참고.
- 색/간격/폰트: `reference-mirror/_next/static/chunks/*.css` 및 위 styles CSS.

## 기술 선택 (파이에 가볍게)
- 권장: **무빌드 정적 + 바닐라 JS(ES 모듈)** 또는 가벼운 라이브러리(Preact/htm, Alpine.js).
  Next.js/대형 SPA 번들은 파이 상주,빌드 부담이 크니 지양.
- 라우팅: 정적 HTML 페이지 + fetch로 데이터 채우기, 또는 단순 클라이언트 라우터. 서버는 SPA 폴백 제공.
- 데이터: 위 `API_CONTRACT.md`의 `/api/*` 호출. 실시간은 `/ws` WebSocket.
- 인증: 쿠키 자동 전송(같은 도메인). 로그인 상태는 `/api/me`로 확인.

## 페이지 목록(원본 라우트 대응)
| 화면 | 경로 | 데이터 소스 |
|---|---|---|
| 홈/메인 | `/` | posts(최신), best, meal(오늘), timetable(기본 1-1), 채팅 |
| 로그인 | `/login` | POST /api/login |
| 회원가입 | `/signup` | POST /api/signup (+ 인증코드 lookup) |
| 자유게시판 | `/community/free` | /api/posts |
| 전체글 | `/community/free/all` | /api/posts |
| 베스트 | `/community/free/best` | /api/posts/best |
| 구인구직 | `/community/free/jobs` | /api/jobs (+ /api/me/interests) |
| 글쓰기 | `/community/free/jobs/new` 등 | POST /api/posts \| /api/jobs |
| 급식 | `/community/free/meal` | /api/neis/meal(+rating) |
| 최신 | `/community/free/new` | /api/posts |

## 진행 방식
1. 공통 레이아웃(헤더 네비: 메인/게시글/구인구직/급식표/베스트, 사이드바: 핫이슈,실시간채팅) 구성.
2. 홈 → 게시판 → 급식 → 시간표 → 채팅 순으로 화면을 붙이며 백엔드 라우트와 연결.
3. 정적 자산 경로는 절대경로(`/styles/...`, `/fonts/...`, `/icons/...`)로 통일.
