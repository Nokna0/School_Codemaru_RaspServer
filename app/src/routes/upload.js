// 이미지 업로드: multipart → (sharp로 리사이즈·재인코딩) → 로컬 디스크 저장 → { urls: [...] }.
// 보안: 로그인 필요, MIME 화이트리스트, 크기 제한(multipart 등록 시 8MB), 무작위 파일명.
// 파이 절약: 긴 변 1600px로 축소 + 메타데이터 제거 + 적정 품질 재인코딩(디스크·대역폭↓).
import { requireAuth } from '../lib/auth.js';
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
const MAX_DIM = 1600; // 긴 변 상한(px)

// sharp는 네이티브 모듈 — 빌드/플랫폼 문제로 로드 실패할 수 있으므로 1회만 시도 후 캐시.
// 실패하면 null → 원본 그대로 저장(기능 degrade, 업로드 자체는 계속 동작).
let sharpMod;
let sharpTried = false;
async function getSharp() {
  if (sharpTried) return sharpMod;
  sharpTried = true;
  try {
    sharpMod = (await import('sharp')).default;
    sharpMod.concurrency(1); // 파이 RAM 보호
  } catch {
    sharpMod = null;
  }
  return sharpMod;
}

// 이미지 버퍼를 리사이즈·재인코딩. 실패 시 원본 버퍼/확장자 반환.
async function processImage(buf, ext, log) {
  if (ext === 'gif') return { out: buf, ext }; // 애니메이션 보존 위해 gif는 손대지 않음
  const sharp = await getSharp();
  if (!sharp) return { out: buf, ext };
  try {
    let img = sharp(buf, { failOn: 'none' }).rotate(); // EXIF 회전 반영 후 메타 제거
    const meta = await img.metadata();
    if ((meta.width || 0) > MAX_DIM || (meta.height || 0) > MAX_DIM) {
      img = img.resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true });
    }
    if (ext === 'png') return { out: await img.png({ compressionLevel: 9 }).toBuffer(), ext: 'png' };
    if (ext === 'webp') return { out: await img.webp({ quality: 82 }).toBuffer(), ext: 'webp' };
    return { out: await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), ext: 'jpg' };
  } catch (err) {
    log?.warn(err, 'sharp 처리 실패 — 원본 저장');
    return { out: buf, ext };
  }
}

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
          part.file.resume(); // 허용되지 않은 MIME: 스트림 비우고 거부
          throw { code: 400, error: 'unsupported_type' };
        }
        // 버퍼로 수집(≤8MB). 초과 시 @fastify/multipart가 throwFileSizeLimit로 예외.
        let buf;
        try {
          buf = await part.toBuffer();
        } catch (e) {
          if (e?.code === 'FST_REQ_FILE_TOO_LARGE') throw { code: 413, error: 'file_too_large' };
          throw e;
        }
        const { out, ext: finalExt } = await processImage(buf, ext, req.log);
        const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${finalExt}`;
        const dest = path.join(UPLOAD_DIR, name);
        await fs.promises.writeFile(dest, out);
        saved.push(dest);
        urls.push(`/uploads/${name}`);
      }
    } catch (err) {
      saved.forEach((p) => fs.unlink(p, () => {}));
      if (err && typeof err.code === 'number') return reply.code(err.code).send({ error: err.error });
      req.log.error(err, 'upload failed');
      return reply.code(500).send({ error: 'upload_failed' });
    }

    if (!urls.length) return reply.code(400).send({ error: 'no_file' });
    return { urls };
  });
}
