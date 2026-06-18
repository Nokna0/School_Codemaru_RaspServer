// 통계 / 방문 분석. 방문자 수는 세션 쿠키(sq_sid) 기준 중복 제거.
import { z } from 'zod';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { readUser } from '../lib/auth.js';

const SID = 'sq_sid';

export default async function statsRoutes(app) {
  // 방문 기록. POST /api/analytics/visit { path }
  app.post('/analytics/visit', async (req, reply) => {
    const path = z.string().max(300).safeParse(req.body?.path);
    let sid = req.cookies?.[SID];
    if (!sid) {
      sid = crypto.randomUUID();
      reply.setCookie(SID, sid, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
    }
    const me = readUser(req);
    // 같은 세션이 같은 날 같은 경로를 또 찍으면 스킵(중복 제거)
    const dup = db.prepare(
      "SELECT 1 FROM visits WHERE session_id=? AND path=? AND date(created_at)=date('now') LIMIT 1",
    ).get(sid, path.success ? path.data : null);
    if (!dup) {
      db.prepare('INSERT INTO visits (path, user_id, session_id) VALUES (?,?,?)')
        .run(path.success ? path.data : null, me?.uid ?? null, sid);
    }
    return { ok: true };
  });

  // 방문자 수(오늘/누적, 세션 기준). GET /api/stats/visitors
  app.get('/stats/visitors', async () => {
    const today = db.prepare(
      "SELECT COUNT(DISTINCT session_id) c FROM visits WHERE date(created_at)=date('now')",
    ).get().c;
    const total = db.prepare('SELECT COUNT(DISTINCT session_id) c FROM visits').get().c;
    return { today, total };
  });

  // 회원 수. GET /api/stats/users
  app.get('/stats/users', async () => {
    const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    return { count };
  });
}
