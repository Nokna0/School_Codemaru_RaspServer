import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fstatic from '@fastify/static';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import { db, initDb } from './db/index.js';
import { registerRealtime } from './realtime/ws.js';
import { allow } from './lib/ratelimit.js';

// 라우트 모듈 (docs/API_CONTRACT.md 순서대로 추가)
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import uploadRoutes from './routes/upload.js';
import mealRoutes from './routes/meal.js';
import timetableRoutes from './routes/timetable.js';
import jobsRoutes from './routes/jobs.js';
import meRoutes from './routes/me.js';
import notificationsRoutes from './routes/notifications.js';
import messagesRoutes from './routes/messages.js';
import statsRoutes from './routes/stats.js';
import contentRoutes from './routes/content.js';
import adminRoutes from './routes/admin.js';
import studentVerificationRoutes from './routes/student-verification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// 도커에선 compose가 UPLOAD_DIR=/data/uploads 를 주입(볼륨). 미설정 시 로컬 개발용 절대경로로 폴백.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = Fastify({ logger: true, trustProxy: true }); // nginx/cloudflare 뒤

await app.register(cookie, { secret: process.env.JWT_SECRET || 'dev-secret' });

// ---- 보안 헤더(helmet) ----
// CSP는 우리 무빌드 구조에 맞춤: 페이지마다 인라인 <script type="module">와 style="..." 속성을
// 쓰므로 script/style에 'unsafe-inline' 필요. 같은 출처 모듈/이미지/폰트/WS만 허용.
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"], // fetch + WebSocket(ws/wss 같은 출처)
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],   // 서비스워커
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null, // Cloudflare가 HTTPS 종단 — 강제 안 함
    },
  },
  crossOriginEmbedderPolicy: false, // 외부 임베드 깨짐 방지(보수적)
});

await app.register(websocket);
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

// ---- 요청 제한(rate limit): 쓰기/인증 요청을 IP별로 제한(파이 보호·무차별 방지) ----
const AUTH_PATHS = new Set(['/api/login', '/api/signup']);
app.addHook('onRequest', (req, reply, done) => {
  const m = req.method;
  if (m !== 'POST' && m !== 'PUT' && m !== 'DELETE') return done();
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) return done();
  const ip = req.ip || 'unknown';
  // 인증 엔드포인트는 더 엄격(무차별 대입 방지)
  if (AUTH_PATHS.has(url)) {
    if (!allow(`auth:${ip}`, 10, 60_000)) return reply.code(429).send({ error: 'too_many_requests' });
  }
  // 일반 쓰기 요청 한도
  if (!allow(`write:${ip}`, 80, 60_000)) return reply.code(429).send({ error: 'too_many_requests' });
  return done();
});

// ---- 에러 처리 일관화: zod 검증 → 400 {error:'validation'}, 그 외 statusCode 존중 ----
app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError || err?.name === 'ZodError') {
    return reply.code(400).send({ error: 'validation', details: err.issues });
  }
  const status = err.statusCode || 500;
  if (status >= 500) req.log.error(err);
  return reply.code(status).send({ error: status >= 500 ? 'internal' : (err.message || 'error') });
});

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
await app.register(uploadRoutes, { prefix: '/api' });
await app.register(mealRoutes, { prefix: '/api' });
await app.register(timetableRoutes, { prefix: '/api' });
await app.register(jobsRoutes, { prefix: '/api' });
await app.register(meRoutes, { prefix: '/api' });
await app.register(notificationsRoutes, { prefix: '/api' });
await app.register(messagesRoutes, { prefix: '/api' });
await app.register(statsRoutes, { prefix: '/api' });
await app.register(contentRoutes, { prefix: '/api' });
await app.register(adminRoutes, { prefix: '/api' });
await app.register(studentVerificationRoutes, { prefix: '/api' });

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
  // 깨끗한 URL(/login, /signup, /community/free ...)을 같은 이름의 .html 로 매핑.
  // 해당 파일이 있으면 그 페이지를, 없으면 index.html 로 폴백(클라이언트 라우팅).
  const clean = req.raw.url.split('?')[0].replace(/\/+$/, '').replace(/^\/+/, '');
  if (clean) {
    const candidate = path.join(PUBLIC_DIR, `${clean}.html`);
    if (candidate.startsWith(PUBLIC_DIR) && fs.existsSync(candidate)) {
      return reply.sendFile(`${clean}.html`);
    }
  }
  return reply.sendFile('index.html');
});

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`Square app listening on :${port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });

// ---- 우아한 종료: Docker stop(SIGTERM)/Ctrl-C(SIGINT) 시 연결 정리 + SQLite WAL 체크포인트 ----
// 미처리 시 진행 중 요청이 끊기고 WAL이 체크포인트 안 돼 다음 부팅이 느려질 수 있음.
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} 수신 — 종료 시작`);
  try {
    await app.close(); // 새 연결 차단 + 진행 중 요청 마무리 + WS 닫기
    db.pragma('wal_checkpoint(TRUNCATE)'); // WAL → 본 DB 반영 후 정리
    db.close();
    app.log.info('정상 종료 완료');
    process.exit(0);
  } catch (err) {
    app.log.error(err, '종료 중 오류');
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
