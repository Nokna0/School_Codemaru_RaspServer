-- Square 데이터 모델 (SQLite). 모두 IF NOT EXISTS 라 매 부팅 시 안전하게 실행됨.
-- 자세한 설명은 docs/DATA_MODEL.md 참고.
PRAGMA foreign_keys = ON;

-- ===== 사용자 / 인증 =====
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,            -- 로그인 아이디
  password_hash TEXT    NOT NULL,
  nickname      TEXT,
  grade         INTEGER,                            -- 학년 1~3
  class_no      INTEGER,                            -- 반 1~11
  role          TEXT    NOT NULL DEFAULT 'student', -- 'student' | 'admin'
  level         INTEGER NOT NULL DEFAULT 1,         -- 등급 시스템
  exp           INTEGER NOT NULL DEFAULT 0,
  verified      INTEGER NOT NULL DEFAULT 0,         -- 학생 인증 완료 여부
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

-- 회원가입용 학생 인증코드 (1코드=1계정 권장)
CREATE TABLE IF NOT EXISTS signup_codes (
  code       TEXT PRIMARY KEY,
  label      TEXT,
  used_by    INTEGER REFERENCES users(id),
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== 게시판 (자유게시판 등) =====
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id     INTEGER REFERENCES users(id),
  board         TEXT    NOT NULL DEFAULT 'free',    -- 'free' 등
  title         TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  image_urls    TEXT,                               -- JSON 배열
  is_anonymous  INTEGER NOT NULL DEFAULT 0,
  anon_name     TEXT,
  view_count    INTEGER NOT NULL DEFAULT 0,
  like_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  hot_score     REAL    NOT NULL DEFAULT 0,         -- 핫이슈/베스트 정렬용
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT,
  deleted_at    TEXT                                -- 소프트 삭제(관리자 보관함)
);
CREATE INDEX IF NOT EXISTS idx_posts_board_created ON posts(board, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_hot ON posts(hot_score DESC);

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      INTEGER NOT NULL REFERENCES posts(id),
  author_id    INTEGER REFERENCES users(id),
  parent_id    INTEGER REFERENCES comments(id),
  content      TEXT    NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  anon_name    TEXT,
  like_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

-- ===== 구인구직 (jobs) =====
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id     INTEGER REFERENCES users(id),
  title         TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  fields        TEXT,                               -- JSON 배열: 물리/화학/수학/컴공/AI...
  activity_type TEXT,                               -- 스터디/프로젝트/봉사/대회 등
  status        TEXT    NOT NULL DEFAULT 'open',    -- 'open' | 'closed'
  view_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  interest TEXT    NOT NULL,
  PRIMARY KEY (user_id, interest)
);

-- ===== 실시간 익명채팅 =====
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room       TEXT    NOT NULL DEFAULT 'global',
  anon_name  TEXT,
  content    TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'text',       -- 'text' | 'emoji'
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_room_created ON chat_messages(room, created_at DESC);

-- ===== 급식 (NEIS 캐시) + 평점 =====
CREATE TABLE IF NOT EXISTS meals (
  date       TEXT NOT NULL,                         -- 'YYYY-MM-DD'
  meal_type  TEXT NOT NULL,                         -- 'breakfast'|'lunch'|'dinner'
  menu       TEXT,                                  -- 줄바꿈 구분 메뉴
  calorie    TEXT,
  origin     TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, meal_type)
);
CREATE TABLE IF NOT EXISTS meal_ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  meal_type  TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  stars      INTEGER NOT NULL,                      -- 1~5
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (date, meal_type, user_id)
);

-- ===== 시간표 (NEIS 캐시) =====
CREATE TABLE IF NOT EXISTS timetables (
  grade      INTEGER NOT NULL,
  class_no   INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  period     INTEGER NOT NULL,
  subject    TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (grade, class_no, date, period)
);

-- ===== 알림 / 쪽지 =====
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT    NOT NULL,                      -- 'comment'|'like'|'message'|'system'...
  title      TEXT,
  body       TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id    INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  content      TEXT    NOT NULL,
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, created_at DESC);

-- ===== 통계 / 운영 =====
CREATE TABLE IF NOT EXISTS visits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT,
  user_id    INTEGER REFERENCES users(id),
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);

CREATE TABLE IF NOT EXISTS popups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  content    TEXT,
  image_url  TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  starts_at  TEXT,
  ends_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slot       TEXT,                                  -- 광고 위치 식별자
  html       TEXT,
  image_url  TEXT,
  link       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  weight     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ddays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  target_date TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_login_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  username   TEXT,
  ip         TEXT,
  ua         TEXT,
  success    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== 게시판 전문검색(FTS5) =====
-- 한글은 토큰 경계가 모호해 trigram 토크나이저로 부분문자열 검색 지원(3글자↑).
-- external-content(content='posts')로 본문 중복저장 없이 posts.id를 rowid로 사용.
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, content, content='posts', content_rowid='id', tokenize='trigram'
);
-- posts 변경을 FTS에 동기화하는 트리거(insert/delete/update).
CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
  INSERT INTO posts_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
