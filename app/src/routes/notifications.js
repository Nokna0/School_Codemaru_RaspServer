// 알림: 내 알림 목록 + 읽음 처리.
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';

export default async function notificationsRoutes(app) {
  // GET /api/notifications → { items, unread }
  app.get('/notifications', { preHandler: requireAuth }, async (req) => {
    const items = db.prepare(
      `SELECT id, type, title, body, link, is_read, created_at
         FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`,
    ).all(req.user.uid);
    const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.uid).c;
    return { items, unread };
  });

  // POST /api/notifications/read { ids?:[] } (없으면 전체 읽음)
  app.post('/notifications/read', { preHandler: requireAuth }, async (req) => {
    const body = z.object({ ids: z.array(z.number().int()).optional() }).safeParse(req.body || {});
    const ids = body.success ? body.data.ids : undefined;
    if (ids?.length) {
      const ph = ids.map(() => '?').join(',');
      db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=? AND id IN (${ph})`)
        .run(req.user.uid, ...ids);
    } else {
      db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.uid);
    }
    return { ok: true };
  });
}
