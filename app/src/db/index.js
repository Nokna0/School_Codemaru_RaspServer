import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/square.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // 라즈베리파이 동시성/성능
db.pragma('foreign_keys = ON');

// 부팅 시 스키마 보장 (모든 테이블이 IF NOT EXISTS)
export function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // 검색 색인 마이그레이션: 기존 DB에 글은 있는데 FTS가 비어 있으면 1회 재색인.
  // (FTS 테이블을 새로 추가한 배포에서 기존 게시글을 검색 가능하게.)
  try {
    const ftsCount = db.prepare('SELECT count(*) c FROM posts_fts').get().c;
    const postCount = db.prepare('SELECT count(*) c FROM posts').get().c;
    if (ftsCount === 0 && postCount > 0) {
      db.exec("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')");
    }
  } catch { /* FTS 미지원 환경이면 무시(검색만 비활성) */ }
}
