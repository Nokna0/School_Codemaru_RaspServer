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
import { readUser } from '../lib/auth.js';

const rooms = new Map();       // room -> Set<socket> (익명 채팅)
const userSockets = new Map(); // uid  -> Set<socket> (로그인 사용자, 알림 push)

function broadcast(room, obj) {
  const set = rooms.get(room);
  if (!set) return;
  const msg = JSON.stringify(obj);
  for (const ws of set) { try { ws.send(msg); } catch { /* noop */ } }
}

// 특정 사용자의 모든 접속 소켓으로 push (알림 등). 다른 모듈에서 사용.
export function pushToUser(uid, obj) {
  const set = userSockets.get(uid);
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

    // 로그인 사용자면 알림 push용 채널에도 등록(쿠키 기반)
    const me = readUser(req);
    if (me?.uid) {
      if (!userSockets.has(me.uid)) userSockets.set(me.uid, new Set());
      userSockets.get(me.uid).add(ws);
      // 접속 시 안읽은 알림 수 전송
      const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(me.uid).c;
      ws.send(JSON.stringify({ t: 'notif_count', unread }));
    }

    // 최근 대화 50개 전송
    const history = db.prepare(
      'SELECT anon_name AS name, content, kind, created_at AS ts FROM chat_messages WHERE room=? ORDER BY created_at DESC LIMIT 50',
    ).all(room).reverse();
    ws.send(JSON.stringify({ t: 'history', items: history }));
    presence(room);

    // 빈도 제한(파이 보호): 10초당 8개 초과 시 드롭 + 1회 경고
    const RATE = { max: 8, windowMs: 10000 };
    let hits = []; let warned = false;

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t !== 'chat' || typeof m.content !== 'string') return;
      const content = m.content.trim();
      if (!content || content.length > 500) return;

      const now = Date.now();
      hits = hits.filter((t) => now - t < RATE.windowMs);
      if (hits.length >= RATE.max) {
        if (!warned) { warned = true; ws.send(JSON.stringify({ t: 'system', content: '너무 빠르게 보내고 있어요. 잠시 후 다시 시도해주세요.' })); }
        return;
      }
      hits.push(now); warned = false;

      const kind = m.kind === 'emoji' ? 'emoji' : 'text';
      db.prepare('INSERT INTO chat_messages (room, anon_name, content, kind) VALUES (?,?,?,?)')
        .run(room, name, content, kind);
      broadcast(room, { t: 'chat', name, content, kind, ts: Date.now() });
    });

    ws.on('close', () => {
      rooms.get(room)?.delete(ws);
      if (me?.uid) {
        const set = userSockets.get(me.uid);
        set?.delete(ws);
        if (set && set.size === 0) userSockets.delete(me.uid);
      }
      presence(room);
    });
  });
}
