// 학생 인증코드: 평문은 저장하지 않고 해시(sha256+페퍼)만 DB(signup_codes.code)에 보관.
// 발급 시 평문을 1회 관리자에게 반환 → 배포. 검증 시 입력을 해시해 비교.
import crypto from 'node:crypto';

const PEPPER = process.env.JWT_SECRET || 'dev-secret';

export function hashCode(code) {
  return crypto.createHash('sha256').update(`${code}:${PEPPER}`).digest('hex');
}

// 사람이 입력하기 쉬운 코드 생성 (혼동 문자 제외). 예: SQ-7K9F-2МH4 형태
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0,O,1,I 제외
export function generateCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `SQ-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}
