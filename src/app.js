const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const compression = require('compression');
const { COLS } = require('./db');
const { createAuth } = require('./auth');

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

function validate(col, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Dữ liệu không hợp lệ';
  if (typeof item.name !== 'string' || !item.name.trim()) return 'Thiếu tên';
  if (col === 'orders' && !/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) return 'Ngày giao không hợp lệ';
  return null;
}

const PUBLIC = path.join(__dirname, '..', 'public');
const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/* index.html phục vụ từ bộ nhớ: gắn ?v=<hash> vào file tĩnh để trình duyệt cache lâu mà không bao giờ dùng bản cũ.
   Đọc lại khi file đổi (so mtime) nên sửa giao diện không cần khởi động lại. */
const VERSIONED = ['api-adapter.js', 'icons/logo.jpg'];
function indexPage() {
  const files = ['index.html', ...VERSIONED].map(f => path.join(PUBLIC, f));
  const stamp = files.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join('|');
  if (indexPage.cache && indexPage.cache.stamp === stamp) return indexPage.cache;
  let html = fs.readFileSync(files[0], 'utf8');
  for (const f of VERSIONED) {
    let v; try { v = hashOf(fs.readFileSync(path.join(PUBLIC, f))).slice(0, 10); } catch { continue; }
    html = html.split('src="' + f + '"').join('src="' + f + '?v=' + v + '"');
  }
  const body = Buffer.from(html);
  indexPage.cache = { stamp, body, etag: '"' + hashOf(body) + '"' };
  return indexPage.cache;
}

// Cache tĩnh: file có ?v= thì cache 1 năm; icon 30 ngày; manifest 7 ngày; còn lại luôn hỏi lại server (ETag)
function staticCache(res, filePath) {
  const rel = path.relative(PUBLIC, filePath).split(path.sep).join('/');
  let cc = 'no-cache';
  if (res.req && res.req.query && res.req.query.v) cc = 'public, max-age=31536000, immutable';
  else if (rel.startsWith('icons/')) cc = 'public, max-age=2592000';
  else if (rel === 'manifest.webmanifest') cc = 'public, max-age=604800';
  res.setHeader('Cache-Control', cc);
}

// /api/health gọi rất thường (Render health check, keepalive): chỉ hỏi database tối đa 30 giây một lần
function cheapPinger(store) {
  let at = 0, p = null;
  return () => {
    if (Date.now() - at < 30000) return Promise.resolve();
    if (!p) p = store.ping().then(() => { at = Date.now(); }).finally(() => { p = null; });
    return p;
  };
}

function createApp(cfg, store) {
  const app = express();
  const { login, requireAuth } = createAuth(cfg);
  const cheapPing = cheapPinger(store);
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],   // giao diện dùng script nội tuyến
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],     // manifest.webmanifest để cài app lên màn hình chính
      },
    },
  }));
  // CORS chỉ mở cho các domain khai báo trong CORS_ORIGINS; để trống = chỉ cùng domain
  app.use(cors({ origin: cfg.corsOrigins.length ? cfg.corsOrigins : false, exposedHeaders: ['ETag'] }));
  // nén gzip/brotli cho HTML, JS, JSON, manifest, SVG (ảnh JPEG/PNG đã nén sẵn nên bỏ qua)
  app.use(compression({ filter: (req, res) => /webmanifest/.test(res.getHeader('Content-Type') || '') || compression.filter(req, res) }));
  app.use(express.json({ limit: cfg.bodyLimit }));

  app.get('/api/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await cheapPing(); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  });
  // Ảnh: khoá ngẫu nhiên 128-bit không đoán được, nội dung không đổi nên cache lâu
  app.get('/api/images/:key', async (req, res, next) => {
    try {
      const img = await store.getImage(req.params.key);
      if (!img) return res.status(404).end();
      res.set('Content-Type', img.mime).set('Cache-Control', 'private, max-age=31536000, immutable').send(Buffer.from(img.data));
    } catch (e) { next(e); }
  });
  app.get('/api/config', (req, res) => res.json({ pollMs: cfg.clientPollMs }));

  const loginLimiter = rateLimit({
    windowMs: cfg.loginRateWindowMin * 60 * 1000,
    limit: cfg.loginRateMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true, // chỉ đếm lần nhập sai
    message: { error: 'Thử sai quá nhiều lần, vui lòng đợi rồi thử lại' },
  });
  app.post('/api/login', loginLimiter, login);

  const api = express.Router();
  api.use(requireAuth);
  api.get('/export', async (req, res, next) => {
    try {
      res.set('Content-Disposition', `attachment; filename="bloom-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(await store.exportAll());
    } catch (e) { next(e); }
  });
  api.param('col', (req, res, next, col) => COLS[col] ? next() : res.status(404).json({ error: 'Không có bảng này' }));
  api.param('id', (req, res, next, id) => ID_RE.test(id) ? next() : res.status(400).json({ error: 'ID không hợp lệ' }));
  // Polling 15 giây: client gửi If-None-Match, dữ liệu không đổi thì trả 304 rỗng, không đọc lại cả danh sách
  api.get('/:col', async (req, res, next) => {
    try {
      const tag = 'W/"' + await store.version(req.params.col) + '"';
      res.set('ETag', tag).set('Cache-Control', 'private, no-cache');
      // so thẳng If-None-Match: fetch cache:'no-store' luôn gửi kèm Cache-Control: no-cache nên req.fresh không dùng được
      const inm = String(req.headers['if-none-match'] || '').split(',').map(x => x.trim().replace(/^W\//, ''));
      if (inm.includes(tag.replace(/^W\//, ''))) return res.status(304).end();
      res.json(await store.list(req.params.col));
    } catch (e) { next(e); }
  });
  api.put('/:col/:id', async (req, res, next) => {
    const err = validate(req.params.col, req.body);
    if (err) return res.status(400).json({ error: err });
    try { res.json(await store.upsert(req.params.col, req.params.id, req.body)); } catch (e) { next(e); }
  });
  api.delete('/:col/:id', async (req, res, next) => {
    try { res.json({ ok: await store.remove(req.params.col, req.params.id) }); } catch (e) { next(e); }
  });
  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy' }));

  app.get(['/', '/index.html'], (req, res, next) => {
    try {
      const page = indexPage();
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: page.etag });
      if (req.fresh) return res.status(304).end();
      res.send(page.body);
    } catch (e) { next(e); }
  });
  app.use(express.static(PUBLIC, { cacheControl: false, setHeaders: staticCache }));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu quá lớn' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ' });
    console.error(JSON.stringify({ level: 'error', msg: err.message, path: req.path, stack: cfg.isProd ? undefined : err.stack }));
    res.status(500).json({ error: 'Lỗi server' });
  });
  return app;
}

module.exports = { createApp };
