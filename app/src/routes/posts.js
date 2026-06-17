// 게시판: 목록 / 작성 / 상세 / 베스트. (댓글/좋아요는 별도 라우트로 확장 가능)
// 인증/익명 규칙은 docs/FEATURES.md 참고.
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, readUser } from '../lib/auth.js';

export default async function postsRoutes(app) {
  // 목록 (페이지네이션). GET /api/posts?board=free&page=1
  app.get('/posts', async (req) => {
    const { board = 'free', page = '1', size = '20' } = req.query;
    const limit = Math.min(Number(size) || 20, 50);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const rows = db.prepare(
      `SELECT id, board, title, is_anonymous, anon_name, author_id,
              view_count, like_count, comment_count, created_at
         FROM posts
        WHERE board=? AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(board, limit, offset);
    return { items: rows, page: Number(page), size: limit };
  });

  // 베스트/핫이슈. GET /api/posts/best
  app.get('/posts/best', async () => {
    const rows = db.prepare(
      `SELECT id, title, like_count, comment_count, view_count, created_at
         FROM posts WHERE deleted_at IS NULL
        ORDER BY hot_score DESC, like_count DESC LIMIT 20`,
    ).all();
    return { items: rows };
  });

  // 상세 (+조회수). GET /api/posts/:id
  app.get('/posts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const post = db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL').get(id);
    if (!post) return reply.code(404).send({ error: 'not_found' });
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id=?').run(id);
    const comments = db.prepare(
      'SELECT id, author_id, parent_id, content, is_anonymous, anon_name, like_count, created_at FROM comments WHERE post_id=? AND deleted_at IS NULL ORDER BY created_at',
    ).all(id);
    return { post, comments };
  });

  // 작성 (로그인 필요). POST /api/posts
  app.post('/posts', { preHandler: requireAuth }, async (req) => {
    const body = z.object({
      board: z.string().default('free'),
      title: z.string().min(1).max(120),
      content: z.string().min(1),
      isAnonymous: z.boolean().default(false),
      imageUrls: z.array(z.string()).optional(),
    }).parse(req.body);
    const info = db.prepare(
      `INSERT INTO posts (author_id, board, title, content, is_anonymous, anon_name, image_urls)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      req.user.uid, body.board, body.title, body.content,
      body.isAnonymous ? 1 : 0, body.isAnonymous ? '익명' : null,
      body.imageUrls ? JSON.stringify(body.imageUrls) : null,
    );
    return { id: info.lastInsertRowid };
  });
}
