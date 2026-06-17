// 실시간 기능: 익명 채팅 + 접속자 presence + (확장) 알림 push
// 원본은 Supabase Realtime(broadcast/presence/postgres_changes)을 사용했으나,
// 자체호스팅에서는 표준 WebSocket으로 대체한다.
//
// 클라이언트: new WebSocket(`wss://codemaru.store/ws?room=global`)
// 메시지 프로토콜(JSON):
//   << 서버->클라:  { t:'chat', name, content, kind, ts }
//                   { t:'presence', online }        (접속자 수)
//                   { t:'history', items:[...] }
//   >> 클라->서버:  { t:'chat', content, kind:'text'|'emoji' }
import { db } from '../db/index.js';

const rooms = new Map(); // room -> Set<socket>

function broadcast(room, obj) {
  const set = rooms.get(room);
  if (!set) return;
  const msg = JSON.stringify(obj);
  for (const ws of set) { try { ws.send(msg); } catch { /* noop */ } }
}
function presence(room) {
  broadcast(room, { t: 'presence', online: rooms.get(room)?.size || 0 });
}
function anonName() {
  return '익명' + Math.floor(1000 + Math.random() * 9000);
}

export function registerRealtime(app) {
  app.get('/ws', { websocket: true }, (conn, req) => {
    const room = (req.query?.room) || 'global';
    const ws = conn.socket ?? conn;   // @fastify/websocket v10: conn.socket, v11+: conn
    const name = anonName();

    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(ws);

    // 최근 대화 50개 전송
    const history = db.prepare(
      'SELECT anon_name AS name, content, kind, created_at AS ts FROM chat_messages WHERE room=? ORDER BY created_at DESC LIMIT 50',
    ).all(room).reverse();
    ws.send(JSON.stringify({ t: 'history', items: history }));
    presence(room);

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'chat' && typeof m.content === 'string' && m.content.length <= 500) {
        const kind = m.kind === 'emoji' ? 'emoji' : 'text';
        db.prepare('INSERT INTO chat_messages (room, anon_name, content, kind) VALUES (?,?,?,?)')
          .run(room, name, m.content, kind);
        broadcast(room, { t: 'chat', name, content: m.content, kind, ts: Date.now() });
      }
    });

    ws.on('close', () => {
      rooms.get(room)?.delete(ws);
      presence(room);
    });
  });
}
