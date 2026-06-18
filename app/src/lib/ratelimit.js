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

// 오래된 빈 버킷 주기적 정리(메모리 누수 방지)
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const live = arr.filter((t) => now - t < 600000);
    if (live.length) buckets.set(k, live); else buckets.delete(k);
  }
}, 600000);
cleanup.unref?.();
