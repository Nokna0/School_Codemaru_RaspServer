// 알림 생성 헬퍼: DB 저장 + (접속 중이면) WebSocket 실시간 push.
import { db } from '../db/index.js';
import { pushToUser } from '../realtime/ws.js';

// type: 'comment'|'like'|'message'|'system'
export function createNotification(userId, { type, title, body, link }) {
  if (!userId) return;
  const info = db.prepare(
    `INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)`,
  ).run(userId, type, title ?? null, body ?? null, link ?? null);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(userId).c;
  pushToUser(userId, {
    t: 'notif',
    notification: { id: info.lastInsertRowid, type, title, body, link },
    unread,
  });
  return info.lastInsertRowid;
}
