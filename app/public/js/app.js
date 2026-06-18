// Square 공통 프론트 스크립트 (무빌드 ES 모듈)
// - API 호출 헬퍼(쿠키 자동 전송)
// - 공통 헤더(네비 + 로그인 상태) 렌더
// - 로그인 상태 조회/로그아웃

const NAV = [
  { href: '/', label: '메인' },
  { href: '/community/free', label: '게시글' },
  { href: '/community/free/jobs', label: '구인구직' },
  { href: '/community/free/meal', label: '급식표' },
  { href: '/community/free/best', label: '베스트' },
];

// ---- API ----
export async function api(path, { method = 'GET', body, headers } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// 현재 로그인 사용자 (없으면 null). 캐시.
let _mePromise;
export function getMe({ force = false } = {}) {
  if (force || !_mePromise) {
    _mePromise = api('/api/me').catch((e) => (e.status === 401 ? null : Promise.reject(e)));
  }
  return _mePromise;
}

export async function logout() {
  await api('/api/logout', { method: 'POST', body: {} });
  _mePromise = undefined;
  location.href = '/';
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// SQLite는 UTC 'YYYY-MM-DD HH:MM:SS'로 저장 → 상대시간 표기.
export function timeAgo(s) {
  if (!s) return '';
  const then = new Date(s.replace(' ', 'T') + 'Z').getTime();
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}일 전`;
  return new Date(then).toLocaleDateString('ko-KR');
}

// 사이드바 위젯(핫이슈 + 실시간채팅 자리). #app-sidebar 가 있으면 채운다.
export async function mountSidebar() {
  const host = document.getElementById('app-sidebar');
  if (!host) return;
  host.innerHTML = `
    <aside class="sidebar">
      <div class="card"><div class="card__body">
        <h2 class="card__title">🔥 핫이슈</h2>
        <ul class="widget-list" id="hot-list"><li>불러오는 중…</li></ul>
      </div></div>
      <div class="card chat-widget"><div class="card__body">
        <h2 class="card__title">💬 실시간 익명채팅 <span class="chat-online" id="chat-online">·</span></h2>
        <div class="chat-log" id="chat-log"></div>
        <div class="chat-emojis" id="chat-emojis"></div>
        <form class="chat-form" id="chat-form">
          <input id="chat-input" maxlength="500" placeholder="메시지 입력" autocomplete="off">
          <button class="btn btn--primary" type="submit">전송</button>
        </form>
      </div></div>
    </aside>`;
  try {
    const { items } = await api('/api/posts/best');
    const list = document.getElementById('hot-list');
    list.innerHTML = items.length
      ? items.slice(0, 7).map((p) => `<li><a href="/community/free/view?id=${p.id}">${escapeHtml(p.title)}</a>
          <small style="color:var(--text-muted)"> ❤${p.like_count} · 💬${p.comment_count}</small></li>`).join('')
      : '<li style="color:var(--text-muted)">아직 글이 없어요</li>';
  } catch { /* 무시 */ }
  mountChat();
}

// ---- 공유 WebSocket (채팅 + 알림 push를 한 연결로) ----
let _ws; let _wsRetry = 0; let _wsClosed = false;
const _wsSubs = new Set();
function ensureSocket() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  _ws = new WebSocket(`${proto}://${location.host}/ws?room=global`);
  _ws.onopen = () => { _wsRetry = 0; };
  _ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    _wsSubs.forEach((fn) => { try { fn(m); } catch { /* noop */ } });
  };
  _ws.onclose = () => {
    _wsSubs.forEach((fn) => { try { fn({ t: 'closed' }); } catch { /* noop */ } });
    if (_wsClosed) return;
    _wsRetry = Math.min(_wsRetry + 1, 6);
    setTimeout(ensureSocket, _wsRetry * 1000);
  };
  _ws.onerror = () => { try { _ws.close(); } catch { /* noop */ } };
}
export function onSocket(fn) { _wsSubs.add(fn); ensureSocket(); return () => _wsSubs.delete(fn); }
export function socketSend(obj) {
  if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify(obj));
}
window.addEventListener('beforeunload', () => { _wsClosed = true; try { _ws?.close(); } catch { /* noop */ } });

// 실시간 익명채팅. 사이드바 위젯에서 호출.
const EMOJIS = ['😀', '👍', '❤️', '🔥', '🚀'];
export function mountChat() {
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const online = document.getElementById('chat-online');
  const emojiBar = document.getElementById('chat-emojis');
  if (!log || !form) return;

  emojiBar.innerHTML = EMOJIS.map((e) => `<button type="button" class="emoji-btn">${e}</button>`).join('');
  emojiBar.querySelectorAll('.emoji-btn').forEach((b) =>
    b.addEventListener('click', () => send(b.textContent, 'emoji')));

  function addLine({ t, name, content, kind }) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    const div = document.createElement('div');
    if (t === 'system') { div.className = 'chat-sys'; div.textContent = content; }
    else {
      div.className = 'chat-msg' + (kind === 'emoji' ? ' emoji' : '');
      div.innerHTML = `<span class="chat-name">${escapeHtml(name)}</span><span class="chat-text">${escapeHtml(content)}</span>`;
    }
    log.appendChild(div);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  onSocket((m) => {
    if (m.t === 'history') { log.innerHTML = ''; m.items.forEach((x) => addLine({ t: 'chat', ...x })); log.scrollTop = log.scrollHeight; }
    else if (m.t === 'chat' || m.t === 'system') addLine(m);
    else if (m.t === 'presence') online.textContent = `${m.online}명`;
    else if (m.t === 'closed') online.textContent = '연결 끊김';
  });

  function send(content, kind = 'text') {
    const text = (content ?? '').trim();
    if (!text) return;
    socketSend({ t: 'chat', content: text, kind });
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value, 'text'); input.value = ''; });
}

// ---- 공통 헤더 ----
// <div id="app-header"></div> 가 있으면 채운다.
export async function mountHeader() {
  const host = document.getElementById('app-header');
  if (!host) return;
  const cur = location.pathname;
  // 가장 구체적인(가장 긴) 매칭 항목 하나만 활성화 (상위 경로 중복 활성 방지)
  let activeHref = '';
  NAV.forEach((n) => {
    const match = n.href === '/' ? cur === '/' : cur.startsWith(n.href);
    if (match && n.href.length > activeHref.length) activeHref = n.href;
  });
  const navHtml = NAV.map((n) =>
    `<a href="${n.href}"${n.href === activeHref ? ' class="active"' : ''}>${n.label}</a>`,
  ).join('');

  host.innerHTML = `
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="/">
          <img src="/icons/cheongju-emblem-480.webp" alt="청주고 엠블럼">
          <span>청고 Square</span>
        </a>
        <nav class="nav">${navHtml}</nav>
        <div class="header-auth" id="header-auth"></div>
      </div>
    </header>`;

  // 방문 기록(중복은 서버가 세션 기준 제거). 실패 무시.
  api('/api/analytics/visit', { method: 'POST', body: { path: location.pathname } }).catch(() => {});

  const me = await getMe();
  const authBox = document.getElementById('header-auth');
  if (me) {
    const span = me.level_span || 1;
    const pct = Math.min(100, Math.round(((me.into_level || 0) / span) * 100));
    authBox.innerHTML = `
      ${me.role === 'admin' ? '<a class="btn btn--ghost" href="/admin">관리자</a>' : ''}
      <a class="icon-btn" href="/messages" title="쪽지">✉️</a>
      <div class="notif-wrap">
        <button class="icon-btn" id="notif-bell" title="알림">🔔<span class="notif-badge hidden" id="notif-badge">0</span></button>
        <div class="notif-dropdown hidden" id="notif-dropdown"></div>
      </div>
      <span class="user-chip" title="경험치 ${me.into_level ?? 0}/${span} (총 ${me.exp ?? 0})">
        ${escapeHtml(me.nickname || me.username)}
        <small>Lv.${me.level ?? 1}</small>
        <span class="exp-bar"><span class="exp-bar__fill" style="width:${pct}%"></span></span>
      </span>
      <button class="btn btn--ghost" id="btn-logout">로그아웃</button>`;
    document.getElementById('btn-logout').addEventListener('click', () => logout());
    mountNotifications();
  } else {
    authBox.innerHTML = `
      <a class="btn btn--ghost" href="/login">로그인</a>
      <a class="btn btn--primary" href="/signup">가입하기</a>`;
  }
  return me;
}

// 알림 벨: 초기 unread 로드 + 실시간(WS) 갱신 + 드롭다운.
function mountNotifications() {
  const bell = document.getElementById('notif-bell');
  const badge = document.getElementById('notif-badge');
  const dropdown = document.getElementById('notif-dropdown');
  if (!bell) return;

  const setBadge = (n) => {
    badge.textContent = n > 99 ? '99+' : n;
    badge.classList.toggle('hidden', !n);
  };

  async function openDropdown() {
    dropdown.classList.remove('hidden');
    dropdown.innerHTML = '<div class="notif-empty">불러오는 중…</div>';
    try {
      const { items } = await api('/api/notifications');
      dropdown.innerHTML = items.length
        ? items.map((n) => `<a class="notif-item${n.is_read ? '' : ' unread'}" href="${n.link || '#'}">
            <div class="notif-item__title">${escapeHtml(n.title || n.type)}</div>
            ${n.body ? `<div class="notif-item__body">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-item__time">${timeAgo(n.created_at)}</div></a>`).join('')
        : '<div class="notif-empty">알림이 없어요</div>';
      await api('/api/notifications/read', { method: 'POST', body: {} });
      setBadge(0);
    } catch { dropdown.innerHTML = '<div class="notif-empty">불러오지 못했습니다</div>'; }
  }

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('hidden')) openDropdown();
    else dropdown.classList.add('hidden');
  });
  document.addEventListener('click', () => dropdown.classList.add('hidden'));

  // 초기 unread
  api('/api/notifications').then(({ unread }) => setBadge(unread)).catch(() => {});
  // 실시간
  onSocket((m) => {
    if (m.t === 'notif_count') setBadge(m.unread);
    else if (m.t === 'notif') setBadge(m.unread);
  });
}

// 보호 페이지에서 호출: 미로그인 시 /login 으로
export async function requireLogin() {
  const me = await getMe();
  if (!me) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return null; }
  return me;
}
