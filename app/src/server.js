import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initDb } from './db/index.js';
import { registerRealtime } from './realtime/ws.js';

// 라우트 모듈 (docs/API_CONTRACT.md 순서대로 추가)
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
// import jobsRoutes from './routes/jobs.js';
// import mealRoutes from './routes/meal.js';
// import timetableRoutes from './routes/timetable.js';
// import notificationsRoutes from './routes/notifications.js';
// import messagesRoutes from './routes/messages.js';
// import meRoutes from './routes/me.js';
// import statsRoutes from './routes/stats.js';
// import adminRoutes from './routes/admin.js';
// ... (popup, ad, dday, broadcast, upload, student-verification)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = Fastify({ logger: true, trustProxy: true }); // nginx/cloudflare 뒤

await app.register(cookie, { secret: process.env.JWT_SECRET || 'dev-secret' });
await app.register(websocket);
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

initDb();

// 헬스체크
app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

// 업로드 파일 정적 서빙
await app.register(fstatic, {
  root: UPLOAD_DIR, prefix: '/uploads/', decorateReply: false,
});

// API 라우트 등록 (prefix: /api)
await app.register(authRoutes, { prefix: '/api' });
await app.register(postsRoutes, { prefix: '/api' });
// await app.register(jobsRoutes, { prefix: '/api' });
// await app.register(mealRoutes, { prefix: '/api' });
// ... 나머지 라우트 등록

// 실시간 (익명채팅 / 접속자 presence / 알림 push)
registerRealtime(app);

// 프론트엔드 정적 파일 (public/) + SPA 폴백 (반드시 마지막)
await app.register(fstatic, {
  root: PUBLIC_DIR, prefix: '/', wildcard: false,
});
app.setNotFoundHandler((req, reply) => {
  if (req.raw.url.startsWith('/api') || req.raw.url.startsWith('/ws')) {
    return reply.code(404).send({ error: 'not_found' });
  }
  return reply.sendFile('index.html'); // 클라이언트 라우팅 폴백
});

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`Square app listening on :${port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
