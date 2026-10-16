const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { COLS } = require('./db');
const { createAuth } = require('./auth');

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

function validate(col, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Dữ liệu không hợp lệ';
  if (typeof item.name !== 'string' || !item.name.trim()) return 'Thiếu tên';
  if (col === 'orders' && !/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) return 'Ngày giao không hợp lệ';
  return null;
}

function createApp(cfg, store) {
  const app = express();
  const { login, requireAuth } = createAuth(cfg);
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
      },
    },
  }));
  // CORS chỉ mở cho các domain khai báo trong CORS_ORIGINS; để trống = chỉ cùng domain
  app.use(cors({ origin: cfg.corsOrigins.length ? cfg.corsOrigins : false }));
  app.use(express.json({ limit: cfg.bodyLimit }));

  app.get('/api/health', async (req, res) => {
    try { await store.ping(); res.json({ ok: true }); }
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
  api.get('/:col', async (req, res, next) => {
    try { res.json(await store.list(req.params.col)); } catch (e) { next(e); }
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

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: cfg.isProd ? '1h' : 0 }));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu quá lớn' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ' });
    console.error(JSON.stringify({ level: 'error', msg: err.message, path: req.path, stack: cfg.isProd ? undefined : err.stack }));
    res.status(500).json({ error: 'Lỗi server' });
  });
  return app;
}

module.exports = { createApp };
