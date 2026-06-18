// JWT(쿠키 기반) 인증 헬퍼. 원본의 Supabase Auth를 자체 구현으로 대체.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const SECRET = process.env.JWT_SECRET || 'dev-secret';
const COOKIE = 'sq_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30일

export async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: MAX_AGE },
  );
}

export function setSession(reply, user) {
  reply.setCookie(COOKIE, signToken(user), {
    path: '/', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // cloudflare가 HTTPS 종단
    maxAge: MAX_AGE,
  });
}
export function clearSession(reply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

export function readUser(req) {
  // req.cookies(@fastify/cookie) 우선. WS 업그레이드 등 훅이 안 도는 경우 헤더에서 직접 파싱.
  let tok = req.cookies?.[COOKIE];
  if (!tok && req.headers?.cookie) {
    const m = req.headers.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    if (m) tok = decodeURIComponent(m[1]);
  }
  if (!tok) return null;
  try { return jwt.verify(tok, SECRET); } catch { return null; }
}

// preHandler 훅: 로그인 필요
export function requireAuth(req, reply, done) {
  const u = readUser(req);
  if (!u) { reply.code(401).send({ error: 'unauthorized' }); return; }
  req.user = u;
  done();
}

// preHandler 훅: 관리자 필요
export function requireAdmin(req, reply, done) {
  const u = readUser(req);
  if (!u || u.role !== 'admin') { reply.code(403).send({ error: 'forbidden' }); return; }
  req.user = u;
  done();
}
