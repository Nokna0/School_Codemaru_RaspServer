/* Square 서비스워커 — PWA 오프라인 셸 + 정적 캐시.
 * 자산에 버전 해시가 없으므로 staleness 방지를 위해 기본 전략은 network-first.
 *  - /api, /ws, 비-GET, 교차출처: 캐시 우회(항상 네트워크).
 *  - 아이콘/폰트(거의 불변): cache-first.
 *  - 그 외(HTML/JS/CSS): network-first → 오프라인 시 캐시 폴백.
 * CACHE 버전을 올리면 활성화 시 옛 캐시를 정리한다.
 */
const CACHE = 'square-v1';
const IMMUTABLE = /^\/(icons|fonts)\//;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;           // 교차출처 무시
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return; // 동적 데이터

  // 거의 불변 자산: cache-first(있으면 즉시, 없으면 받아서 캐시).
  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
        return res;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // 그 외: network-first(온라인이면 항상 최신), 실패 시 캐시 폴백.
  e.respondWith((async () => {
    try {
      const res = await fetch(request);
      if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
      return res;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      // 내비게이션 요청이면 홈으로 폴백(오프라인 셸).
      if (request.mode === 'navigate') {
        const home = await caches.match('/');
        if (home) return home;
      }
      return Response.error();
    }
  })());
});
