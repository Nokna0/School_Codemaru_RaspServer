# DATA_MODEL — SQLite 스키마

전체 DDL은 `app/src/db/schema.sql` 에 있고 부팅 시 자동 적용된다(모두 `IF NOT EXISTS`).
원본 번들에서 관측된 필드(`class_no`, `view_count`, `image_urls`, `verified`,
`verification_type`, `created_at`, `user_id` 등)와 캡처된 화면을 근거로 설계했다.
프론트/백을 함께 만들므로 컬럼은 자유롭게 조정 가능하다.

## 핵심 테이블 요약

| 테이블 | 용도 | 주요 컬럼 |
|---|---|---|
| `users` | 회원 | username(아이디), password_hash, grade(1~3), class_no(1~11), role, level/exp(등급), verified |
| `signup_codes` | 학생 인증코드 | code, used_by, used_at |
| `posts` | 게시글(자유게시판 등) | board, title, content, image_urls(JSON), is_anonymous, view/like/comment_count, hot_score, deleted_at |
| `comments` | 댓글/대댓글 | post_id, parent_id, content, is_anonymous |
| `post_likes` | 추천 | (post_id,user_id) |
| `jobs` | 구인구직 | title, content, fields(JSON), activity_type, status |
| `user_interests` | 관심분야 저장 | (user_id, interest) |
| `chat_messages` | 실시간 익명채팅 로그 | room, anon_name, content, kind(text/emoji) |
| `meals` | 급식(NEIS 캐시) | (date, meal_type), menu, calorie, origin |
| `meal_ratings` | 급식 별점 | (date,meal_type,user_id), stars(1~5) |
| `timetables` | 시간표(NEIS 캐시) | (grade,class_no,date,period), subject |
| `notifications` | 알림 | user_id, type, is_read |
| `messages` | 쪽지(inbox) | sender_id, recipient_id, is_read |
| `visits` | 방문 분석 | path, user_id, session_id, created_at |
| `popups` | 팝업 공지 | active, starts_at, ends_at |
| `ads` | 광고 슬롯 | slot, html/image, active, weight |
| `ddays` | D-day | title, target_date |
| `admin_login_logs` | 관리자 로그인 로그 | username, ip, success |

## 설계 메모
- **익명성**: `is_anonymous`가 true면 글/댓글에 작성자를 노출하지 않는다. 단, `author_id`는
  내부적으로 보관(신고,제재 대응). 표시용 `anon_name`을 둔다. (회원가입 안전서약 반영)
- **등급 시스템**: `users.level`/`exp`. 글/댓글/추천 등 활동으로 exp 증가 → 레벨 산정 규칙은
  `docs/FEATURES.md`에서 정의(초기엔 단순 임계값 테이블로).
- **핫이슈/베스트**: `posts.hot_score`를 (추천,댓글,조회,시간감쇠)로 주기적 계산하거나 조회 시 산식 적용.
- **NEIS 캐시**: 급식/시간표는 외부 API를 매번 호출하지 말고 DB에 캐시 후 만료 시 갱신.
- **소프트 삭제**: `deleted_at`으로 관리자 보관함(/api/admin/archive) 구현. 하드 삭제는 지양.
- **마이그레이션**: 컬럼 추가 등 변경 시 `schema.sql`에 `ALTER TABLE ... IF NOT EXISTS` 대안이
  없으므로, 간단한 버전 테이블(`schema_version`)이나 startup 마이그레이션 스크립트를 도입할 것.
