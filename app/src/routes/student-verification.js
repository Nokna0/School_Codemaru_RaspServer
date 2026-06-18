// 학생 인증코드 조회/사용. 코드는 해시로 저장(lib/codes.js).
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { hashCode } from '../lib/codes.js';

export default async function studentVerificationRoutes(app) {
  // 코드 유효성 조회(회원가입 폼 사전 확인). GET /api/student-verification/lookup?code=
  app.get('/student-verification/lookup', async (req) => {
    const code = z.string().min(1).safeParse(req.query.code);
    if (!code.success) return { valid: false };
    // 개발용 env 코드(평문) 또는 해시 테이블 코드(미사용)
    const envCodes = (process.env.SIGNUP_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (envCodes.includes(code.data)) return { valid: true };
    const row = db.prepare('SELECT 1 FROM signup_codes WHERE code=? AND used_by IS NULL').get(hashCode(code.data));
    return { valid: !!row };
  });

  // 이미 가입했으나 미인증인 사용자가 코드로 본인 인증. POST /api/student-verification/claim { code }
  app.post('/student-verification/claim', { preHandler: requireAuth }, async (req, reply) => {
    const code = z.string().min(1).safeParse(req.body?.code);
    if (!code.success) return reply.code(400).send({ error: 'bad_params' });
    const me = db.prepare('SELECT id, verified FROM users WHERE id=?').get(req.user.uid);
    if (me.verified) return { verified: true };

    const envCodes = (process.env.SIGNUP_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
    const hashed = hashCode(code.data);
    const row = db.prepare('SELECT code FROM signup_codes WHERE code=? AND used_by IS NULL').get(hashed);
    if (!envCodes.includes(code.data) && !row) return reply.code(400).send({ error: 'invalid_code' });

    const claim = db.transaction(() => {
      db.prepare('UPDATE users SET verified=1 WHERE id=?').run(req.user.uid);
      if (row) {
        db.prepare("UPDATE signup_codes SET used_by=?, used_at=datetime('now') WHERE code=?")
          .run(req.user.uid, hashed);
      }
    });
    claim();
    return { verified: true };
  });
}
