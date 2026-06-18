// 이미지 업로드: multipart → 로컬 디스크(/data/uploads) 저장 → { urls: [...] }.
// 보안: 로그인 필요, MIME 화이트리스트, 크기 제한(multipart 등록 시 8MB), 무작위 파일명.
// 파이 부하 고려해 별도 이미지 처리 라이브러리 없이 원본 저장(확장자는 MIME 기준으로 강제).
import { requireAuth } from '../lib/auth.js';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export default async function uploadRoutes(app) {
  // POST /api/upload  (multipart, 필드명 자유, 여러 파일 허용)
  app.post('/upload', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.isMultipart()) return reply.code(415).send({ error: 'not_multipart' });

    const urls = [];
    const saved = []; // 실패 시 롤백용 절대경로
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        const ext = EXT_BY_MIME[part.mimetype];
        if (!ext) {
          // 허용되지 않은 MIME: 스트림 비우고 거부
          part.file.resume();
          return reply.code(400).send({ error: 'unsupported_type' });
        }
        const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
        const dest = path.join(UPLOAD_DIR, name);
        await pipeline(part.file, fs.createWriteStream(dest));
        // @fastify/multipart: 파일이 limits.fileSize 초과 시 part.file.truncated = true
        if (part.file.truncated) {
          fs.unlink(dest, () => {});
          return reply.code(413).send({ error: 'file_too_large' });
        }
        saved.push(dest);
        urls.push(`/uploads/${name}`);
      }
    } catch (err) {
      saved.forEach((p) => fs.unlink(p, () => {}));
      req.log.error(err, 'upload failed');
      return reply.code(500).send({ error: 'upload_failed' });
    }

    if (!urls.length) return reply.code(400).send({ error: 'no_file' });
    return { urls };
  });
}
