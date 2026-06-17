# API_CONTRACT — REST + WebSocket

원본 번들에서 관측된 엔드포인트 23개를 기준으로 한 **재구축 계약**이다. 프론트/백을 함께
만들므로 이 계약을 정본으로 삼고 양쪽을 맞춘다. 원본의 정확한 응답 형태가 궁금하면
`reference-mirror/_next/static/chunks/` 의 청크에서 해당 경로 문자열을 검색해 사용처를 확인한다.

공통 규칙
- 응답: JSON. 인증: httpOnly 쿠키(`sq_session`). 보호 라우트는 미로그인 시 401.
- 목록은 `{ items, page, size }` 형태 권장. 에러는 `{ error: 'code' }` + 적절한 HTTP status.

## 인증 / 사용자
| 메서드 | 경로 | 인증 | 설명 | 요청 → 응답 |
|---|---|---|---|---|
| POST | `/api/signup` | - | 회원가입(아이디+비번+학년+반+인증코드) | `{username,password,grade,classNo,code,nickname?}` → `{id,username}` |
| POST | `/api/login` | - | 로그인 | `{username,password}` → `{id,username,role}` |
| POST | `/api/logout` | - | 로그아웃 | `{}` → `{ok}` |
| GET | `/api/me` | ✓ | 현재 사용자 | → `{id,username,nickname,grade,class_no,role,level,exp,verified}` |
| GET/PUT | `/api/me/interests` | ✓ | 관심분야 조회/저장 | PUT `{interests:[...]}` → `{interests:[...]}` |

> signup/login/logout/me 는 `app/src/routes/auth.js` 에 구현 예시 제공.

## 게시판 / 핫이슈
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/api/posts?board=free&page=1` | - | 글 목록 |
| POST | `/api/posts` | ✓ | 글 작성 `{board,title,content,isAnonymous,imageUrls?}` |
| GET | `/api/posts/:id` | - | 글 상세(+댓글, 조회수 증가) |
| GET | `/api/posts/best` | - | 베스트/핫이슈 |
| POST | `/api/posts/:id/like` | ✓ | 추천 토글 (신규) |
| POST | `/api/posts/:id/comments` | ✓ | 댓글 작성 (신규) |

> 목록/상세/베스트/작성은 `app/src/routes/posts.js` 에 예시 제공. 좋아요/댓글은 확장.

## 구인구직 (jobs)
| GET | `/api/jobs?fields=물리,컴공` | - | 모집글 목록(관심분야 필터) |
| POST | `/api/jobs` | ✓ | 모집글 작성 `{title,content,fields:[],activityType}` |

활동/분야 카테고리는 `docs/FEATURES.md`의 고정 목록 사용.

## 급식 / 시간표 (NEIS)
| GET | `/api/neis/meal?date=YYYY-MM-DD` | - | 조/중/석식 메뉴 + 평균 별점 |
| GET | `/api/neis/meal/rating?date=&type=` | - | 별점 통계 |
| POST | `/api/neis/meal/rating` | ✓ | 별점 등록 `{date,type,stars}` |
| GET | `/api/timetable?grade=1&classNo=1&week=YYYY-MM-DD` | - | 주간 시간표(교시×요일) |

NEIS 호출은 `app/src/lib/neis.js` 사용 → 결과를 `meals`/`timetables`에 캐시.

## 실시간 (원본 /api/chat, /api/broadcast → WebSocket로 대체)
- 엔드포인트: `GET /ws?room=global` (Upgrade)
- 서버→클라: `{t:'history',items}` / `{t:'chat',name,content,kind,ts}` / `{t:'presence',online}`
- 클라→서버: `{t:'chat',content,kind:'text'|'emoji'}`
- 구현 예시: `app/src/realtime/ws.js`. (관리자 공지 broadcast도 같은 채널로 push)

## 알림 / 쪽지
| GET | `/api/notifications` | ✓ | 내 알림 목록 |
| POST | `/api/notifications/read` | ✓ | 읽음 처리 `{ids?:[]}`(없으면 전체) |
| GET | `/api/messages/inbox` | ✓ | 받은 쪽지 |
| POST | `/api/messages` | ✓ | 쪽지 보내기 `{recipient,content}` (신규) |

## 업로드
| POST | `/api/upload` | ✓ | multipart 이미지 업로드 → `{urls:['/uploads/xxx.webp']}` |

저장: `/data/uploads`. 가능하면 리사이즈,webp 변환(파이 부하 고려해 가벼운 라이브러리 또는 원본 저장).

## 학생 인증
| GET | `/api/student-verification/lookup?code=` | - | 코드 유효성 조회 |
| POST | `/api/student-verification/claim` | ✓/- | 코드로 본인 인증 처리 |

`signup_codes` 테이블 사용. 원본은 `qr_code`,`hashed_token` 흔적 있음 → 코드 해시 저장 권장.

## 통계 / 분석 / 운영
| GET | `/api/stats/visitors` | - | 방문자 수(오늘/누적) |
| GET | `/api/stats/users` | - | 회원 수 |
| POST | `/api/analytics/visit` | - | 방문 기록 `{path}` (세션 쿠키 기준 중복 제거) |
| GET | `/api/popup` | - | 노출 중 팝업 |
| GET | `/api/ad?slot=` | - | 광고 |
| GET | `/api/dday` | - | D-day 목록 |

## 관리자 (role='admin')
| GET | `/api/admin/login-logs` | admin | 로그인 로그 |
| GET/POST | `/api/admin/archive` | admin | 보관(소프트삭제) 글 조회/처리 |

> 관리자 라우트는 `requireAdmin` 훅 사용(`app/src/lib/auth.js`).
