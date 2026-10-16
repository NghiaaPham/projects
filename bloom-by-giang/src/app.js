const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { login, requireAuth } = require('./auth');

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

function validate(col, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Dữ liệu không hợp lệ';
  if (typeof item.name !== 'string' || !item.name.trim()) return 'Thiếu tên';
  if (col === 'orders' && !/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) return 'Ngày giao không hợp lệ';
  return null;
}

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '15mb' })); // ảnh đơn hàng gửi dạng base64

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.post('/api/login', login);

  const api = express.Router();
  api.use(requireAuth);
  api.param('col', (req, res, next, col) => db.COLS[col] ? next() : res.status(404).json({ error: 'Không có bảng này' }));
  api.param('id', (req, res, next, id) => ID_RE.test(id) ? next() : res.status(400).json({ error: 'ID không hợp lệ' }));

  api.get('/:col', async (req, res, next) => {
    try { res.json(await db.list(req.params.col)); } catch (e) { next(e); }
  });
  api.put('/:col/:id', async (req, res, next) => {
    const err = validate(req.params.col, req.body);
    if (err) return res.status(400).json({ error: err });
    try { await db.upsert(req.params.col, req.params.id, req.body); res.json({ ok: true }); } catch (e) { next(e); }
  });
  api.delete('/:col/:id', async (req, res, next) => {
    try { res.json({ ok: await db.remove(req.params.col, req.params.id) }); } catch (e) { next(e); }
  });
  app.use('/api', api);

  // giao diện shop
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Ảnh quá lớn' });
    console.error(err);
    res.status(500).json({ error: 'Lỗi server' });
  });
  return app;
}

module.exports = { createApp };
