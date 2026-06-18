// 급식 (NEIS): 날짜별 조/중/석식 + 식사별 5점 별점(1인 1식 1평점).
// 캐시: meals 테이블. 한 번 조회한 날짜는 DB에 저장해 NEIS 재호출을 줄인다.
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, readUser } from '../lib/auth.js';
import { fetchMeals, neisConfigured } from '../lib/neis.js';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const ymd = (d) => d.replace(/-/g, '');           // 'YYYY-MM-DD' → 'YYYYMMDD'
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// 빈 날짜(급식 없음)를 매번 재호출하지 않도록 프로세스 메모리에 표시
const fetchedDates = new Set();

async function ensureCached(date) {
  const has = db.prepare('SELECT 1 FROM meals WHERE date=? LIMIT 1').get(date);
  if (has || fetchedDates.has(date) || !neisConfigured()) return;
  try {
    const rows = await fetchMeals(ymd(date));
    const upsert = db.prepare(
      `INSERT INTO meals (date, meal_type, menu, calorie, origin, fetched_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(date, meal_type) DO UPDATE SET
         menu=excluded.menu, calorie=excluded.calorie, origin=excluded.origin, fetched_at=excluded.fetched_at`,
    );
    const tx = db.transaction((items) => items.forEach((r) =>
      upsert.run(date, r.type, r.menu, r.calorie, r.origin)));
    tx(rows);
  } catch (e) { /* NEIS 오류 시 빈 상태로 진행 */ }
  fetchedDates.add(date);
}

function ratingFor(date, type, uid) {
  const agg = db.prepare(
    'SELECT ROUND(AVG(stars),1) avg, COUNT(*) count FROM meal_ratings WHERE date=? AND meal_type=?',
  ).get(date, type);
  const mine = uid
    ? db.prepare('SELECT stars FROM meal_ratings WHERE date=? AND meal_type=? AND user_id=?').get(date, type, uid)
    : null;
  return { avg: agg.count ? agg.avg : null, count: agg.count, mine: mine?.stars ?? null };
}

export default async function mealRoutes(app) {
  // 날짜별 급식 + 별점. GET /api/neis/meal?date=YYYY-MM-DD
  app.get('/neis/meal', async (req, reply) => {
    const parsed = dateSchema.safeParse(req.query.date);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_date' });
    const date = parsed.data;
    await ensureCached(date);

    const me = readUser(req);
    const byType = {};
    db.prepare('SELECT meal_type, menu, calorie, origin FROM meals WHERE date=?').all(date)
      .forEach((r) => { byType[r.meal_type] = r; });

    const meals = MEAL_TYPES
      .filter((t) => byType[t])
      .map((t) => ({
        type: t,
        menu: byType[t].menu ? byType[t].menu.split('\n').filter(Boolean) : [],
        calorie: byType[t].calorie,
        origin: byType[t].origin,
        rating: ratingFor(date, t, me?.uid),
      }));

    return { date, meals, configured: neisConfigured() };
  });

  // 별점 통계. GET /api/neis/meal/rating?date=&type=
  app.get('/neis/meal/rating', async (req, reply) => {
    const q = z.object({ date: dateSchema, type: z.enum(MEAL_TYPES) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'bad_params' });
    const me = readUser(req);
    return ratingFor(q.data.date, q.data.type, me?.uid);
  });

  // 별점 등록/수정. POST /api/neis/meal/rating {date,type,stars}
  app.post('/neis/meal/rating', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({
      date: dateSchema, type: z.enum(MEAL_TYPES), stars: z.number().int().min(1).max(5),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_params' });
    const { date, type, stars } = body.data;
    db.prepare(
      `INSERT INTO meal_ratings (date, meal_type, user_id, stars)
       VALUES (?,?,?,?)
       ON CONFLICT(date, meal_type, user_id) DO UPDATE SET stars=excluded.stars`,
    ).run(date, type, req.user.uid, stars);
    return ratingFor(date, type, req.user.uid);
  });
}
