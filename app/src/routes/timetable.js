// 시간표 (NEIS hisTimetable): 학년×반, 주 단위(월~금) 교시별 과목.
// 캐시: timetables 테이블. 기본 1학년 1반.
import { z } from 'zod';
import { db } from '../db/index.js';
import { fetchTimetable, neisConfigured } from '../lib/neis.js';

const ymd = (d) => d.replace(/-/g, '');
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 해당 날짜가 속한 주의 월~금 'YYYY-MM-DD' 배열
function weekdays(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();                 // 0=일 ... 6=토
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); // 월요일로
  return Array.from({ length: 5 }, (_, i) => {
    const x = new Date(d); x.setDate(d.getDate() + i); return fmt(x);
  });
}

const fetched = new Set();

async function ensureCached(grade, classNo, days) {
  const from = days[0]; const to = days[4];
  const key = `${grade}-${classNo}-${from}`;
  const has = db.prepare(
    'SELECT 1 FROM timetables WHERE grade=? AND class_no=? AND date BETWEEN ? AND ? LIMIT 1',
  ).get(grade, classNo, from, to);
  if (has || fetched.has(key) || !neisConfigured()) return;
  try {
    const rows = await fetchTimetable(grade, classNo, ymd(from), ymd(to));
    const upsert = db.prepare(
      `INSERT INTO timetables (grade, class_no, date, period, subject, fetched_at)
       VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(grade, class_no, date, period) DO UPDATE SET
         subject=excluded.subject, fetched_at=excluded.fetched_at`,
    );
    const tx = db.transaction((items) => items.forEach((r) => {
      const dt = `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`;
      upsert.run(grade, classNo, dt, r.period, r.subject);
    }));
    tx(rows);
  } catch (e) { /* 빈 상태로 진행 */ }
  fetched.add(key);
}

export default async function timetableRoutes(app) {
  // GET /api/timetable?grade=1&classNo=1&week=YYYY-MM-DD
  app.get('/timetable', async (req, reply) => {
    const q = z.object({
      grade: z.coerce.number().int().min(1).max(3).default(1),
      classNo: z.coerce.number().int().min(1).max(11).default(1),
      week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'bad_params' });

    const { grade, classNo } = q.data;
    const base = q.data.week || fmt(new Date());
    const days = weekdays(base);
    await ensureCached(grade, classNo, days);

    const rows = db.prepare(
      `SELECT date, period, subject FROM timetables
        WHERE grade=? AND class_no=? AND date BETWEEN ? AND ?
        ORDER BY date, period`,
    ).all(grade, classNo, days[0], days[4]);

    const byDate = {};
    let maxPeriod = 7;
    rows.forEach((r) => {
      (byDate[r.date] ||= {})[r.period] = r.subject;
      if (r.period > maxPeriod) maxPeriod = r.period;
    });

    const daysOut = days.map((d) => ({ date: d, slots: byDate[d] || {} }));
    return {
      grade, classNo, week: { from: days[0], to: days[4] },
      maxPeriod, days: daysOut, configured: neisConfigured(),
    };
  });
}
