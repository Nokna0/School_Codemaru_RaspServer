// 쪽지: 받은편지함 + 보내기. 수신 시 알림 생성(WS push 연동).
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { createNotification } from '../lib/notify.js';

export default async function messagesRoutes(app) {
  // GET /api/messages/inbox → 받은 쪽지(보낸이 닉네임 포함)
  app.get('/messages/inbox', { preHandler: requireAuth }, async (req) => {
    const items = db.prepare(
      `SELECT m.id, m.content, m.is_read, m.created_at,
              COALESCE(u.nickname, u.username, '(탈퇴)') AS sender_name, m.sender_id
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.recipient_id=? ORDER BY m.created_at DESC LIMIT 100`,
    ).all(req.user.uid);
    const unread = db.prepare('SELECT COUNT(*) c FROM messages WHERE recipient_id=? AND is_read=0').get(req.user.uid).c;
    return { items, unread };
  });

  // POST /api/messages { recipient(아이디), content }
  app.post('/messages', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({
      recipient: z.string().min(1),
      content: z.string().min(1).max(2000),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });

    const to = db.prepare('SELECT id, nickname, username FROM users WHERE username=?').get(body.data.recipient);
    if (!to) return reply.code(404).send({ error: 'recipient_not_found' });
    if (to.id === req.user.uid) return reply.code(400).send({ error: 'cannot_message_self' });

    const info = db.prepare(
      'INSERT INTO messages (sender_id, recipient_id, content) VALUES (?,?,?)',
    ).run(req.user.uid, to.id, body.data.content);

    const me = db.prepare('SELECT nickname, username FROM users WHERE id=?').get(req.user.uid);
    createNotification(to.id, {
      type: 'message',
      title: `${me.nickname || me.username}님의 쪽지`,
      body: body.data.content.slice(0, 60),
      link: '/messages',
    });
    return { id: info.lastInsertRowid };
  });

  // POST /api/messages/read { ids?:[] }
  app.post('/messages/read', { preHandler: requireAuth }, async (req) => {
    const body = z.object({ ids: z.array(z.number().int()).optional() }).safeParse(req.body || {});
    const ids = body.success ? body.data.ids : undefined;
    if (ids?.length) {
      const ph = ids.map(() => '?').join(',');
      db.prepare(`UPDATE messages SET is_read=1 WHERE recipient_id=? AND id IN (${ph})`).run(req.user.uid, ...ids);
    } else {
      db.prepare('UPDATE messages SET is_read=1 WHERE recipient_id=?').run(req.user.uid);
    }
    return { ok: true };
  });
}
