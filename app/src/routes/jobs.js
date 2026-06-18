// 구인구직: 모집글 목록(관심분야 필터)/작성 + 내 관심분야 저장.
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, readUser } from '../lib/auth.js';
import { FIELDS, ACTIVITIES, FIELD_GROUPS } from '../lib/categories.js';

const AUTHOR = `CASE WHEN u.nickname IS NOT NULL OR u.username IS NOT NULL
                    THEN COALESCE(u.nickname, u.username) ELSE '(탈퇴)' END`;

export default async function jobsRoutes(app) {
  // 카테고리 메타(프론트 필터 UI용). GET /api/jobs/categories
  app.get('/jobs/categories', async () => ({ groups: FIELD_GROUPS, activities: ACTIVITIES }));

  // 목록(필터). GET /api/jobs?fields=물리,컴공&activity=스터디&status=open
  app.get('/jobs', async (req) => {
    const fields = String(req.query.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
    const activity = req.query.activity?.trim();
    const status = req.query.status === 'all' ? null : (req.query.status || 'open');

    const where = ['j.deleted_at IS NULL'];
    const params = [];
    if (status) { where.push('j.status=?'); params.push(status); }
    if (activity) { where.push('j.activity_type=?'); params.push(activity); }
    if (fields.length) {
      // fields JSON 배열에 요청 분야 중 하나라도 포함(OR)
      where.push('(' + fields.map(() => "j.fields LIKE ?").join(' OR ') + ')');
      fields.forEach((f) => params.push(`%"${f}"%`));
    }
    const rows = db.prepare(
      `SELECT j.id, j.title, j.fields, j.activity_type, j.status, j.view_count, j.created_at,
              ${AUTHOR} AS author_name
         FROM jobs j LEFT JOIN users u ON u.id = j.author_id
        WHERE ${where.join(' AND ')}
        ORDER BY j.created_at DESC LIMIT 50`,
    ).all(...params);
    return { items: rows.map((r) => ({ ...r, fields: r.fields ? JSON.parse(r.fields) : [] })) };
  });

  // 상세. GET /api/jobs/:id (+조회수)
  app.get('/jobs/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const job = db.prepare(
      `SELECT j.*, ${AUTHOR} AS author_name FROM jobs j LEFT JOIN users u ON u.id=j.author_id
        WHERE j.id=? AND j.deleted_at IS NULL`,
    ).get(id);
    if (!job) return reply.code(404).send({ error: 'not_found' });
    db.prepare('UPDATE jobs SET view_count=view_count+1 WHERE id=?').run(id);
    job.view_count += 1;
    job.fields = job.fields ? JSON.parse(job.fields) : [];
    return { job };
  });

  // 작성. POST /api/jobs
  app.post('/jobs', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1).max(120),
      content: z.string().min(1).max(20000),
      fields: z.array(z.enum(FIELDS)).max(8).default([]),
      activityType: z.enum(ACTIVITIES).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const info = db.prepare(
      `INSERT INTO jobs (author_id, title, content, fields, activity_type)
       VALUES (?,?,?,?,?)`,
    ).run(
      req.user.uid, body.data.title, body.data.content,
      JSON.stringify(body.data.fields), body.data.activityType ?? null,
    );
    return { id: info.lastInsertRowid };
  });

  // 모집 상태 토글(작성자). POST /api/jobs/:id/status {status}
  app.post('/jobs/:id/status', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const status = z.enum(['open', 'closed']).safeParse(req.body?.status);
    if (!status.success) return reply.code(400).send({ error: 'bad_params' });
    const job = db.prepare('SELECT author_id FROM jobs WHERE id=? AND deleted_at IS NULL').get(id);
    if (!job) return reply.code(404).send({ error: 'not_found' });
    if (job.author_id !== req.user.uid) return reply.code(403).send({ error: 'forbidden' });
    db.prepare('UPDATE jobs SET status=? WHERE id=?').run(status.data, id);
    return { status: status.data };
  });
}
