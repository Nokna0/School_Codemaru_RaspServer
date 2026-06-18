// 경량 인메모리 요청 제한(파이 보호). 외부 의존성 없이 IP+버킷별 슬라이딩 윈도우.
const buckets = new Map(); // key -> number[] (timestamps)

export function allow(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// ---- 로그인 실패 카운터(계정별 무차별 대입 방어). IP 제한과 별개로 username 단위 잠금. ----
const fails = new Map(); // key -> number[] (실패 시각)

// 잠금 여부 확인(기록하지 않음). 윈도우 밖 실패는 정리.
export function isLockedOut(key, max, windowMs) {
  const now = Date.now();
  const arr = (fails.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length) fails.set(key, arr); else fails.delete(key);
  return arr.length >= max;
}
// 실패 1회 기록.
export function recordFail(key, windowMs) {
  const now = Date.now();
  const arr = (fails.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  fails.set(key, arr);
}
// 로그인 성공 시 해당 계정 실패 기록 초기화.
export function clearFails(key) { fails.delete(key); }

// 오래된 빈 버킷 주기적 정리(메모리 누수 방지)
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const live = arr.filter((t) => now - t < 600000);
    if (live.length) buckets.set(k, live); else buckets.delete(k);
  }
  for (const [k, arr] of fails) {
    const live = arr.filter((t) => now - t < 900000);
    if (live.length) fails.set(k, live); else fails.delete(k);
  }
}, 600000);
cleanup.unref?.();
