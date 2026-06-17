# ROADMAP — 단계별 구현 순서

각 단계 끝에 `docker compose up` 으로 동작을 확인하며 진행한다. 범위는 "전체 기능"이되,
의존도 순으로 쌓는다.

## 0단계 — 부팅 확인 (스캐폴드 검증)
- `cd app && npm install && npm run dev` 로 기동, `GET /api/health` 200 확인.
- SQLite 파일 생성,스키마 적용 확인. (`app/src/db/schema.sql`)
- 산출물: 로컬에서 도는 빈 서버.

## 1단계 — 인증 + 공통 레이아웃
- `routes/auth.js` 완성(이미 예시 제공): signup/login/logout/me. 인증코드 검증.
- 프론트: 헤더,사이드바 공통 레이아웃 + 로그인/회원가입 화면(`reference-mirror` 참고).
- 쿠키 세션,로그인 상태 표시.

## 2단계 — 자유게시판
- 글 목록/상세/작성(예시 제공) + 댓글,대댓글 + 추천(좋아요) + 조회수 + 익명 + 이미지 업로드(`/api/upload`).
- 프론트: 목록/상세/작성 화면.

## 3단계 — 급식,시간표 (NEIS)
- `.env`에 NEIS 키,학교코드 설정. `lib/neis.js`로 급식,시간표 조회 → DB 캐시.
- `/api/neis/meal`(+rating), `/api/timetable`. 프론트: 급식 별점, 시간표 표(학년/반/주차).

## 4단계 — 실시간 (익명채팅 + presence)
- `/ws` 연결, 메시지 송수신,이모지, 접속자 수. (예시 `realtime/ws.js` 확장)
- 프론트: 사이드바 채팅 위젯.

## 5단계 — 핫이슈/베스트 + 등급 시스템
- `hot_score` 산정(배치 또는 조회 시). `/api/posts/best`.
- exp/level 적립 규칙(`FEATURES.md` 8번) + 프로필 표시.

## 6단계 — 구인구직
- `/api/jobs` 목록(관심분야 필터)/작성, `/api/me/interests` 저장. 분야 카테고리 고정 목록.

## 7단계 — 알림 / 쪽지
- `/api/notifications`(+read), `/api/messages/inbox`(+보내기). 알림은 WS push 연동.

## 8단계 — 운영 / 관리자
- `/api/stats/*`, `/api/analytics/visit`, `/api/popup`, `/api/ad`, `/api/dday`.
- 관리자(role=admin): `/api/admin/login-logs`, `/api/admin/archive`(소프트삭제 관리), 신고 처리.
- 관리자 계정 부여 방법(초기 1명 수동 승격) 문서화.

## 9단계 — 마무리
- 입력 검증(zod),요청 제한(rate limit),에러 처리 일관화.
- 학생 인증(`/api/student-verification/*`) 정책 확정(코드 발급,해시 저장).
- ARM64 이미지 빌드,파이 배포 리허설(`BACKEND_SPEC.md`), 백업(SQLite 파일,uploads) 절차.

## 교차 관심사 (전 단계 공통)
- 보안: 비밀번호 해시, httpOnly 쿠키, 권한 체크, 업로드 검증(MIME/크기), XSS 방지(렌더링 시 escape).
- 성능(파이): N+1 쿼리 지양, 인덱스 활용, NEIS,핫스코어 캐시, WS 메시지 제한.
- 데이터: 마이그레이션 전략(`DATA_MODEL.md`), 시드 데이터(테스트 계정,더미 글).
