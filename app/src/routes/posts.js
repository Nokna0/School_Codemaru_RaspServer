// 게시판: 목록 / 상세 / 작성 / 베스트 + 좋아요(토글) + 댓글/대댓글.
// 익명 규칙: 표시는 "익명", 내부엔 author_id 보관(docs/FEATURES.md 2).
// exp/hot_score 적립은 5단계에서. 여기선 like_count/comment_count/view_count만 갱신.
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, readUser } from '../lib/auth.js';
import { awardExp } from '../lib/level.js';
import { createNotification } from '../lib/notify.js';

// 핫스코어(조회 시 실시간 계산): 참여도 ÷ 시간감쇠.
// (julianday 차이는 '일' 단위 → *24 로 '시간'. 글이 오래될수록 점수 하락.)
const HOT_SCORE = `(p.like_count*3.0 + p.comment_count*2.0 + p.view_count*0.2)
                   / power((julianday('now') - julianday(p.created_at)) * 24 + 2, 1.2)`;

// 작성자 표시 이름: 익명이면 anon_name('익명'), 아니면 닉네임/아이디.
const AUTHOR_NAME = `CASE WHEN %s.is_anonymous=1 THEN COALESCE(%s.anon_name,'익명')
                         ELSE COALESCE(u.nickname, u.username, '(탈퇴)') END`;

export default async function postsRoutes(app) {
  // 목록. GET /api/posts?board=free&page=1
  app.get('/posts', async (req) => {
    const { board = 'free', page = '1', size = '20' } = req.query;
    const limit = Math.min(Number(size) || 20, 50);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const rows = db.prepare(
      `SELECT p.id, p.board, p.title, p.is_anonymous, p.view_count, p.like_count,
              p.comment_count, p.created_at,
              ${AUTHOR_NAME.replace(/%s/g, 'p')} AS author_name
         FROM posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.board=? AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ).all(board, limit, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM posts WHERE board=? AND deleted_at IS NULL').get(board).c;
    return { items: rows, page: Number(page), size: limit, total };
  });

  // 베스트/핫이슈. GET /api/posts/best — 핫스코어 실시간 산정.
  app.get('/posts/best', async () => {
    const rows = db.prepare(
      `SELECT p.id, p.title, p.like_count, p.comment_count, p.view_count, p.created_at,
              ${AUTHOR_NAME.replace(/%s/g, 'p')} AS author_name,
              ${HOT_SCORE} AS hot
         FROM posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL AND (p.like_count > 0 OR p.comment_count > 0)
        ORDER BY hot DESC, p.created_at DESC LIMIT 20`,
    ).all();
    return { items: rows };
  });

  // 상세 (+조회수, +댓글, +내 좋아요 여부). GET /api/posts/:id
  app.get('/posts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const post = db.prepare(
      `SELECT p.*, ${AUTHOR_NAME.replace(/%s/g, 'p')} AS author_name
         FROM posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.id=? AND p.deleted_at IS NULL`,
    ).get(id);
    if (!post) return reply.code(404).send({ error: 'not_found' });
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id=?').run(id);
    post.view_count += 1;
    post.image_urls = post.image_urls ? JSON.parse(post.image_urls) : [];

    const comments = db.prepare(
      `SELECT c.id, c.parent_id, c.content, c.is_anonymous, c.like_count, c.created_at,
              ${AUTHOR_NAME.replace(/%s/g, 'c')} AS author_name
         FROM comments c LEFT JOIN users u ON u.id = c.author_id
        WHERE c.post_id=? AND c.deleted_at IS NULL
        ORDER BY c.created_at`,
    ).all(id);

    const me = readUser(req);
    const liked = me
      ? !!db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(id, me.uid)
      : false;
    return { post, comments, liked };
  });

  // 작성 (로그인 필요). POST /api/posts
  app.post('/posts', { preHandler: requireAuth }, async (req) => {
    const body = z.object({
      board: z.string().default('free'),
      title: z.string().min(1).max(120),
      content: z.string().min(1).max(20000),
      isAnonymous: z.boolean().default(false),
      imageUrls: z.array(z.string()).max(10).optional(),
    }).parse(req.body);
    const info = db.prepare(
      `INSERT INTO posts (author_id, board, title, content, is_anonymous, anon_name, image_urls)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      req.user.uid, body.board, body.title, body.content,
      body.isAnonymous ? 1 : 0, body.isAnonymous ? '익명' : null,
      body.imageUrls?.length ? JSON.stringify(body.imageUrls) : null,
    );
    awardExp(req.user.uid, 10); // 글 작성 +10
    return { id: info.lastInsertRowid };
  });

  // 추천 토글. POST /api/posts/:id/like → { liked, like_count }
  app.post('/posts/:id/like', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const post = db.prepare('SELECT id, author_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id);
    if (!post) return reply.code(404).send({ error: 'not_found' });

    const toggle = db.transaction((postId, userId) => {
      const exists = db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(postId, userId);
      if (exists) {
        db.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').run(postId, userId);
        db.prepare('UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id=?').run(postId);
        return false;
      }
      db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)').run(postId, userId);
      db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id=?').run(postId);
      return true;
    });
    const liked = toggle(id, req.user.uid);
    // 추천받음: 남의 글일 때만 작성자에게 +2(취소 시 -2, 토글 악용 방지)
    if (post.author_id && post.author_id !== req.user.uid) {
      awardExp(post.author_id, liked ? 2 : -2);
      if (liked) {
        createNotification(post.author_id, {
          type: 'like', title: '내 글에 추천이 달렸어요', link: `/community/free/view?id=${id}`,
        });
      }
    }
    const { like_count } = db.prepare('SELECT like_count FROM posts WHERE id=?').get(id);
    return { liked, like_count };
  });

  // 댓글/대댓글 작성. POST /api/posts/:id/comments
  app.post('/posts/:id/comments', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const body = z.object({
      content: z.string().min(1).max(1000),
      parentId: z.number().int().optional(),
      isAnonymous: z.boolean().default(false),
    }).parse(req.body);

    const post = db.prepare('SELECT id, author_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id);
    if (!post) return reply.code(404).send({ error: 'not_found' });
    if (body.parentId) {
      const parent = db.prepare('SELECT id FROM comments WHERE id=? AND post_id=? AND deleted_at IS NULL')
        .get(body.parentId, id);
      if (!parent) return reply.code(400).send({ error: 'invalid_parent' });
    }

    const insert = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO comments (post_id, author_id, parent_id, content, is_anonymous, anon_name)
         VALUES (?,?,?,?,?,?)`,
      ).run(
        id, req.user.uid, body.parentId ?? null, body.content,
        body.isAnonymous ? 1 : 0, body.isAnonymous ? '익명' : null,
      );
      db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id=?').run(id);
      return info.lastInsertRowid;
    });
    const cid = insert();
    awardExp(req.user.uid, 3); // 댓글 작성 +3
    if (post.author_id && post.author_id !== req.user.uid) {
      createNotification(post.author_id, {
        type: 'comment', title: '내 글에 댓글이 달렸어요',
        body: body.content.slice(0, 60), link: `/community/free/view?id=${id}`,
      });
    }
    return { id: cid };
  });
}
