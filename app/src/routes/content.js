// 노출 콘텐츠(공개 읽기): 팝업 / 광고 / D-day.
import { db } from '../db/index.js';

export default async function contentRoutes(app) {
  // 노출 중 팝업(현재 시간 기준 활성). GET /api/popup
  app.get('/popup', async () => {
    const row = db.prepare(
      `SELECT id, title, content, image_url FROM popups
        WHERE active=1
          AND (starts_at IS NULL OR starts_at <= datetime('now'))
          AND (ends_at   IS NULL OR ends_at   >= datetime('now'))
        ORDER BY created_at DESC LIMIT 1`,
    ).get();
    return { popup: row || null };
  });

  // 광고. GET /api/ad?slot=
  app.get('/ad', async (req) => {
    const slot = req.query.slot;
    const rows = db.prepare(
      `SELECT id, slot, html, image_url, link, weight FROM ads
        WHERE active=1 ${slot ? 'AND slot=?' : ''} ORDER BY created_at DESC`,
    ).all(...(slot ? [slot] : []));
    if (!rows.length) return { ad: null };
    // weight 가중 랜덤
    const total = rows.reduce((s, r) => s + (r.weight || 1), 0);
    let pick = Math.random() * total;
    const ad = rows.find((r) => (pick -= (r.weight || 1)) < 0) || rows[0];
    return { ad };
  });

  // D-day 목록(활성, 남은 일수 계산). GET /api/dday
  app.get('/dday', async () => {
    const rows = db.prepare(
      "SELECT id, title, target_date FROM ddays WHERE active=1 ORDER BY target_date",
    ).all();
    const items = rows.map((r) => {
      const diff = Math.ceil(
        (new Date(`${r.target_date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000,
      );
      return { ...r, d_day: diff };
    });
    return { items };
  });
}
