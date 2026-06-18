// 내 정보 확장: 관심분야 조회/저장 (구인구직 기본 필터에 사용).
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { FIELDS } from '../lib/categories.js';

const profileSchema = z.object({
  nickname: z.string().min(1).max(20),
  grade: z.number().int().min(1).max(3),
  classNo: z.number().int().min(1).max(11),
});

export default async function meRoutes(app) {
  // PUT /api/me/profile { nickname, grade, classNo } → 진급/반편성·닉네임 변경
  app.put('/me/profile', { preHandler: requireAuth }, async (req, reply) => {
    const body = profileSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const { nickname, grade, classNo } = body.data;
    db.prepare('UPDATE users SET nickname=?, grade=?, class_no=? WHERE id=?')
      .run(nickname, grade, classNo, req.user.uid);
    return { nickname, grade, class_no: classNo };
  });

  // GET /api/me/interests → { interests: [...] }
  app.get('/me/interests', { preHandler: requireAuth }, async (req) => {
    const rows = db.prepare('SELECT interest FROM user_interests WHERE user_id=?').all(req.user.uid);
    return { interests: rows.map((r) => r.interest) };
  });

  // PUT /api/me/interests { interests:[...] } → 전체 교체
  app.put('/me/interests', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ interests: z.array(z.enum(FIELDS)).max(FIELDS.length) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const replace = db.transaction((uid, list) => {
      db.prepare('DELETE FROM user_interests WHERE user_id=?').run(uid);
      const ins = db.prepare('INSERT OR IGNORE INTO user_interests (user_id, interest) VALUES (?,?)');
      list.forEach((i) => ins.run(uid, i));
    });
    replace(req.user.uid, [...new Set(body.data.interests)]);
    return { interests: body.data.interests };
  });
}
