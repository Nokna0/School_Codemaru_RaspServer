// 관리자(role='admin'): 로그인 로그, 보관함(소프트삭제) 관리, 팝업/광고/D-day 관리.
// 초기 관리자: 가입 후 SQL로 1명 수동 승격 — UPDATE users SET role='admin' WHERE username='...';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAdmin } from '../lib/auth.js';
import { hashCode, generateCode } from '../lib/codes.js';

export default async function adminRoutes(app) {
  // 로그인 로그. GET /api/admin/login-logs
  app.get('/admin/login-logs', { preHandler: requireAdmin }, async () => {
    const items = db.prepare(
      'SELECT id, user_id, username, ip, ua, success, created_at FROM admin_login_logs ORDER BY created_at DESC LIMIT 200',
    ).all();
    return { items };
  });

  // 보관함(소프트삭제된 글). GET /api/admin/archive
  app.get('/admin/archive', { preHandler: requireAdmin }, async () => {
    const items = db.prepare(
      `SELECT id, title, author_id, board, deleted_at, like_count, comment_count
         FROM posts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100`,
    ).all();
    return { items };
  });

  // 글 소프트삭제/복원. POST /api/admin/archive { postId, action:'delete'|'restore' }
  app.post('/admin/archive', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({
      postId: z.number().int(),
      action: z.enum(['delete', 'restore']),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const { postId, action } = body.data;
    const post = db.prepare('SELECT id FROM posts WHERE id=?').get(postId);
    if (!post) return reply.code(404).send({ error: 'not_found' });
    if (action === 'delete') {
      db.prepare("UPDATE posts SET deleted_at=datetime('now') WHERE id=?").run(postId);
    } else {
      db.prepare('UPDATE posts SET deleted_at=NULL WHERE id=?').run(postId);
    }
    return { ok: true };
  });

  // ---- 노출 콘텐츠 관리 ----
  // D-day 추가. POST /api/admin/dday { title, targetDate }
  app.post('/admin/dday', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1).max(100),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const info = db.prepare('INSERT INTO ddays (title, target_date) VALUES (?,?)')
      .run(body.data.title, body.data.targetDate);
    return { id: info.lastInsertRowid };
  });

  // 팝업 추가. POST /api/admin/popup { title, content?, imageUrl?, startsAt?, endsAt? }
  app.post('/admin/popup', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1).max(100),
      content: z.string().max(2000).optional(),
      imageUrl: z.string().max(500).optional(),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const d = body.data;
    const info = db.prepare(
      'INSERT INTO popups (title, content, image_url, starts_at, ends_at) VALUES (?,?,?,?,?)',
    ).run(d.title, d.content ?? null, d.imageUrl ?? null, d.startsAt ?? null, d.endsAt ?? null);
    return { id: info.lastInsertRowid };
  });

  // 학생 인증코드 발급(배치). POST /api/admin/signup-codes { count, label? }
  // 평문은 응답으로 1회만 반환(배포용), DB엔 해시만 저장.
  app.post('/admin/signup-codes', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({
      count: z.number().int().min(1).max(200),
      label: z.string().max(50).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const ins = db.prepare('INSERT OR IGNORE INTO signup_codes (code, label) VALUES (?,?)');
    const codes = [];
    const gen = db.transaction(() => {
      for (let i = 0; i < body.data.count; i++) {
        const plain = generateCode();
        const r = ins.run(hashCode(plain), body.data.label ?? null);
        if (r.changes) codes.push(plain); else i--; // 충돌 시 재시도
      }
    });
    gen();
    return { codes }; // ⚠️ 평문은 지금만 표시됨 — 안전히 배포 후 폐기
  });

  // 발급 코드 현황(평문 노출 없음). GET /api/admin/signup-codes
  app.get('/admin/signup-codes', { preHandler: requireAdmin }, async () => {
    const total = db.prepare('SELECT COUNT(*) c FROM signup_codes').get().c;
    const used = db.prepare('SELECT COUNT(*) c FROM signup_codes WHERE used_by IS NOT NULL').get().c;
    return { total, used, unused: total - used };
  });

  // 광고 추가. POST /api/admin/ad { slot, html?, imageUrl?, link?, weight? }
  app.post('/admin/ad', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({
      slot: z.string().min(1).max(50),
      html: z.string().max(4000).optional(),
      imageUrl: z.string().max(500).optional(),
      link: z.string().max(500).optional(),
      weight: z.number().int().min(1).max(100).default(1),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const d = body.data;
    const info = db.prepare(
      'INSERT INTO ads (slot, html, image_url, link, weight) VALUES (?,?,?,?,?)',
    ).run(d.slot, d.html ?? null, d.imageUrl ?? null, d.link ?? null, d.weight);
    return { id: info.lastInsertRowid };
  });
}
