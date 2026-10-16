/* Nối giao diện Bloom by Giang với backend.
   App gọi window.claude.use('db') rồi dùng db.collection(col).doc(id).set/delete và onSnapshot,
   nên ở đây cung cấp đúng giao diện đó, phía sau là REST API + polling 15 giây. */
(function () {
  // Địa chỉ API: mặc định cùng domain; muốn tách domain thì đặt <meta name="bloom-api" content="https://...">
  const meta = document.querySelector('meta[name="bloom-api"]');
  // mở file HTML lẻ (file://) không có server: không nối API, để giao diện dùng bộ nhớ trình duyệt
  if (location.protocol === 'file:' && !(meta && meta.content)) return;
  const API = ((meta && meta.content) || '').replace(/\/$/, '') + '/api';
  const TOKEN_KEY = 'bloom_token';
  let pollMs = 15000; // ghi đè bằng CLIENT_POLL_MS từ server qua /api/config
  const getToken = () => localStorage.getItem(TOKEN_KEY);

  async function call(method, url, body) {
    const res = await fetch(API + url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); location.reload(); throw new Error('unauthorized'); }
    if (!res.ok) {
      const err = new Error('http_' + res.status);
      if (res.status === 413) err.code = 'quota_exceeded';
      throw err;
    }
    return res.json();
  }

  const listeners = { orders: new Set(), flowers: new Set() };
  const fails = { orders: 0, flowers: 0 }, retry = {};
  async function refresh(col) {
    if (!listeners[col].size) return;
    clearTimeout(retry[col]);
    try {
      const items = await call('GET', '/' + col);
      fails[col] = 0;
      const snap = { docs: items.map(x => ({ id: x.id, data: () => x })) };
      listeners[col].forEach(l => l.next(snap));
    } catch (e) {
      // lỗi mạng / máy chủ đang dậy: thử lại sớm (3s, 6s, 12s...) thay vì chờ tới lượt kiểm tra sau
      fails[col]++;
      retry[col] = setTimeout(() => refresh(col), Math.min(3000 * Math.pow(2, fails[col] - 1), pollMs));
      listeners[col].forEach(l => l.error && l.error(e));
    }
  }
  const soon = {};
  const refreshSoon = (col) => { clearTimeout(soon[col]); soon[col] = setTimeout(() => refresh(col), 400); };
  let timer = null;
  const startPolling = () => {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) { refresh('orders'); refresh('flowers'); } }, pollMs);
  };
  fetch(API + '/config').then(r => r.ok ? r.json() : null)
    .then(c => { if (c && Number(c.pollMs) >= 2000) pollMs = Number(c.pollMs); })
    .catch(() => {}).finally(startPolling);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh('orders'); refresh('flowers'); } });

  const db = {
    collection(col) {
      return {
        doc(id) {
          const path = '/' + col + '/' + encodeURIComponent(id);
          return {
            // lưu xong tải lại để nhận đường dẫn ảnh server trả về
            set: (item) => call('PUT', path, item).then(r => { refreshSoon(col); return r; }),
            delete: () => call('DELETE', path).then(r => { refreshSoon(col); return r; }),
          };
        },
        onSnapshot(next, error) {
          const l = { next, error };
          listeners[col].add(l);
          refresh(col);
          return () => listeners[col].delete(l);
        },
      };
    },
  };

  function loginScreen() {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#F6F3EC;font-family:"Be Vietnam Pro",system-ui,sans-serif;padding:24px';
      wrap.innerHTML =
        '<form style="width:100%;max-width:340px;background:#fff;border-radius:18px;padding:28px;box-shadow:0 8px 24px rgba(60,20,35,.08);display:flex;flex-direction:column;gap:14px">' +
        '<div style="font-family:\'Playfair Display\',Georgia,serif;font-style:italic;font-size:28px;color:#1F2A33">Bloom by Giang</div>' +
        '<div style="color:#5B6770;font-size:14px">Nhập mật khẩu chủ shop để vào quản lý đơn.</div>' +
        '<input type="password" name="pw" placeholder="Mật khẩu" autocomplete="current-password" required style="font:inherit;padding:12px 14px;border:1px solid #DCE3E7;border-radius:12px">' +
        '<div class="msg" style="color:#B3261E;font-size:13px;min-height:16px"></div>' +
        '<button style="font:inherit;font-weight:600;padding:12px;border:0;border-radius:12px;background:#3F6B8F;color:#fff;cursor:pointer">Đăng nhập</button>' +
        '</form>';
      document.body.appendChild(wrap);
      const form = wrap.querySelector('form'), msg = wrap.querySelector('.msg');
      form.pw.focus();
      const btn = form.querySelector('button');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (btn.disabled) return; // chặn bấm hai lần
        btn.disabled = true; btn.style.opacity = '.7';
        msg.textContent = 'Đang đăng nhập...';
        // Render bản free ngủ sau 15 phút: lần đầu có thể chờ khoảng 1 phút
        const slow = setTimeout(() => { msg.style.color = '#5B6770'; msg.textContent = 'Máy chủ đang khởi động, chờ khoảng 1 phút nhé...'; }, 3000);
        const done = () => { clearTimeout(slow); btn.disabled = false; btn.style.opacity = ''; msg.style.color = ''; };
        try {
          const res = await fetch(API + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.pw.value }) });
          const data = await res.json().catch(() => ({}));
          done();
          if (!res.ok) { msg.textContent = data.error || 'Không đăng nhập được'; form.pw.select(); return; }
          localStorage.setItem(TOKEN_KEY, data.token);
          wrap.remove();
          resolve();
        } catch { done(); msg.textContent = 'Không kết nối được server, kiểm tra mạng rồi bấm Đăng nhập lại'; }
      });
    });
  }

  window.claude = {
    async use(name) {
      if (name !== 'db') return null; // các tính năng khác (tải file) dùng mặc định của trình duyệt
      if (!getToken()) await loginScreen();
      return db;
    },
  };
  window.bloomExportText = async () => {
    const res = await fetch(API + '/export', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!res.ok) throw new Error('export_failed');
    return res.text();
  };
  window.bloomLogout = () => { localStorage.removeItem(TOKEN_KEY); location.reload(); };
})();
