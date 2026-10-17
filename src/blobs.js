// Kho ảnh ngoài database (Supabase Storage). Không cấu hình thì ảnh vẫn nằm trong bảng images như cũ.
function createSupabaseBlobs({ url, key, bucket, timeoutMs = 15000 }) {
  const base = url.replace(/\/+$/, '') + '/storage/v1/object';
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  const enc = (k) => encodeURIComponent(k);
  const call = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });

  async function put(k, mime, data) {
    const r = await call(`/${bucket}/${enc(k)}`, { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' }, body: data });
    if (!r.ok) throw new Error(`Storage put ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  async function get(k) {
    const r = await call(`/authenticated/${bucket}/${enc(k)}`);
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error(`Storage get ${r.status}`);
    return { mime: r.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await r.arrayBuffer()) };
  }
  async function del(keys) {
    if (!keys.length) return;
    const r = await call(`/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: keys }) });
    if (!r.ok) throw new Error(`Storage delete ${r.status}`);
  }
  return { put, get, del };
}

/** Kho giả trong bộ nhớ cho test. */
function memoryBlobs() {
  const m = new Map();
  return {
    map: m,
    async put(k, mime, data) { m.set(k, { mime, data: Buffer.from(data) }); },
    async get(k) { return m.get(k) || null; },
    async del(keys) { keys.forEach(k => m.delete(k)); },
  };
}

module.exports = { createSupabaseBlobs, memoryBlobs };
