// 인증: 회원가입 / 로그인 / 로그아웃 / 현재 사용자
// 원본 동작: 아이디(username) + 비밀번호, 회원가입 시 학생 인증코드 + 학년(1~3) + 반(1~11).
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  hashPassword, verifyPassword, setSession, clearSession, readUser,
} from '../lib/auth.js';
import { levelInfo } from '../lib/level.js';
import { hashCode } from '../lib/codes.js';
import { isLockedOut, recordFail, clearFails } from '../lib/ratelimit.js';

// 계정별 로그인 잠금: 10분 내 실패 7회면 잠금(서버 재시작 시 초기화).
const LOGIN_MAX_FAIL = 7;
const LOGIN_WINDOW_MS = 10 * 60_000;

const signupSchema = z.object({
  username: z.string().min(2).max(20),
  password: z.string().min(6).max(100),
  grade: z.number().int().min(1).max(3),
  classNo: z.number().int().min(1).max(11),
  code: z.string().min(1),       // 학생 인증코드
  nickname: z.string().max(20).optional(),
});

export default async function authRoutes(app) {
  // 회원가입
  app.post('/signup', async (req, reply) => {
    const body = signupSchema.parse(req.body);

    // 인증코드 검증: env(SIGNUP_CODES, 평문·개발용) 또는 signup_codes 테이블(해시 저장)
    const envCodes = (process.env.SIGNUP_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
    const hashedCode = hashCode(body.code);
    const rowCode = db.prepare('SELECT * FROM signup_codes WHERE code=? AND used_by IS NULL').get(hashedCode);
    const validByEnv = envCodes.includes(body.code);
    if (!rowCode && !validByEnv) return reply.code(400).send({ error: 'invalid_code' });

    const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(body.username);
    if (exists) return reply.code(409).send({ error: 'username_taken' });

    const hash = await hashPassword(body.password);
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, nickname, grade, class_no, verified)
       VALUES (?,?,?,?,?,1)`,
    ).run(body.username, hash, body.nickname ?? body.username, body.grade, body.classNo);

    if (rowCode) {
      db.prepare('UPDATE signup_codes SET used_by=?, used_at=datetime(\'now\') WHERE code=?')
        .run(info.lastInsertRowid, hashedCode);
    }
    const user = db.prepare('SELECT id, username, role FROM users WHERE id=?').get(info.lastInsertRowid);
    setSession(reply, user);
    return { id: user.id, username: user.username };
  });

  // 로그인
  app.post('/login', async (req, reply) => {
    const { username, password } = z.object({
      username: z.string(), password: z.string(),
    }).parse(req.body);
    // 계정별 무차별 대입 방어: 실패 누적 시 잠금(IP 제한과 별개).
    const lockKey = `login:${username}`;
    if (isLockedOut(lockKey, LOGIN_MAX_FAIL, LOGIN_WINDOW_MS)) {
      return reply.code(429).send({ error: 'too_many_attempts' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const ok = user && await verifyPassword(password, user.password_hash);
    // 로그인 감사 로그(성공/실패). 운영자 모니터링용.
    db.prepare('INSERT INTO admin_login_logs (user_id, username, ip, ua, success) VALUES (?,?,?,?,?)')
      .run(user?.id ?? null, username, req.ip, req.headers['user-agent'] ?? null, ok ? 1 : 0);
    if (!ok) {
      recordFail(lockKey, LOGIN_WINDOW_MS);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    clearFails(lockKey);
    db.prepare('UPDATE users SET last_seen_at=datetime(\'now\') WHERE id=?').run(user.id);
    setSession(reply, user);
    return { id: user.id, username: user.username, role: user.role };
  });

  // 로그아웃
  app.post('/logout', async (req, reply) => { clearSession(reply); return { ok: true }; });

  // 현재 사용자 (원본 /api/me 와 호환)
  app.get('/me', async (req, reply) => {
    const sess = readUser(req);
    if (!sess) return reply.code(401).send({ error: 'unauthorized' });
    const u = db.prepare(
      'SELECT id, username, nickname, grade, class_no, role, level, exp, verified FROM users WHERE id=?',
    ).get(sess.uid);
    if (!u) return reply.code(404).send({ error: 'not_found' });
    return { ...u, ...levelInfo(u.exp) }; // level/into_level/level_span/next_exp 포함
  });
}
