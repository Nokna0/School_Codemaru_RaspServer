// 등급(레벨/경험치) 시스템. FEATURES.md 8번.
// 적립 규칙: 글 +10, 댓글 +3, 추천받음 +2 (호출부에서 적용).
// 임계값(단순 증가형): 레벨 n 도달에 필요한 누적 exp = 25*n*(n-1)
//   L1=0, L2=50, L3=150, L4=300, L5=500 ... (간격이 50씩 증가)
import { db } from '../db/index.js';

export function threshold(level) {
  return 25 * level * (level - 1);
}

export function levelForExp(exp) {
  let lvl = 1;
  while (exp >= threshold(lvl + 1)) lvl++;
  return lvl;
}

// 레벨 진행 정보(프로필/헤더 표시용)
export function levelInfo(exp) {
  const level = levelForExp(exp);
  const base = threshold(level);
  const next = threshold(level + 1);
  return {
    level,
    exp,
    into_level: exp - base,       // 현재 레벨에서 쌓은 exp
    level_span: next - base,      // 다음 레벨까지 총 필요량
    next_exp: next,               // 다음 레벨 누적 임계값
  };
}

// exp 적립/차감 + 레벨 재계산. 반환 {exp, level} (대상 없으면 undefined)
export function awardExp(userId, amount) {
  if (!userId || !amount) return undefined;
  const row = db.prepare('SELECT exp FROM users WHERE id=?').get(userId);
  if (!row) return undefined;
  const exp = Math.max(0, row.exp + amount);
  const level = levelForExp(exp);
  db.prepare('UPDATE users SET exp=?, level=? WHERE id=?').run(exp, level, userId);
  return { exp, level };
}
