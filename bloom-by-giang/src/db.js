const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COLS = { orders: true, flowers: true };
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const IMAGE_PATH = '/api/images/';
const IMAGE_KEY_RE = /^[a-f0-9]{32}$/;
const keyFromUrl = (v) => {
  if (typeof v !== 'string' || !v.startsWith(IMAGE_PATH)) return null;
  const k = v.slice(IMAGE_PATH.length);
  return IMAGE_KEY_RE.test(k) ? k : null;
};
const parse = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

/** Kho dữ liệu trên một Pool kiểu `pg` (Postgres thật, hoặc pg-mem khi test). */
function createStore(pool) {
  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }

  async function migrate() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    const stmts = sql.replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) await pool.query(stmt);
    await moveInlineImages();
  }

  // Ảnh: data URL -> lưu bảng images, trả về đường dẫn; đường dẫn cũ hợp lệ -> giữ nguyên; rỗng -> xoá
  async function resolveImage(q, orderId, image) {
    const m = typeof image === 'string' ? DATA_URL_RE.exec(image) : null;
    if (m) {
      const key = crypto.randomBytes(16).toString('hex');
      await q.query('DELETE FROM images WHERE order_id = $1', [orderId]);
      await q.query('INSERT INTO images (key, order_id, mime, data_b64) VALUES ($1, $2, $3, $4)',
        [key, orderId, m[1], m[2]]);
      return IMAGE_PATH + key;
    }
    const key = keyFromUrl(image);
    if (key) {
      await q.query('DELETE FROM images WHERE order_id = $1 AND key <> $2', [orderId, key]);
      return image;
    }
    await q.query('DELETE FROM images WHERE order_id = $1', [orderId]);
    return '';
  }

  async function writeOrder(q, id, item) {
    const image = await resolveImage(q, id, item.image);
    const doc = { ...item, id, image };
    await q.query(
      `INSERT INTO orders (id, date, status, data, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [id, item.date || null, item.status || null, JSON.stringify(doc)]);
    return doc;
  }

  // Dữ liệu cũ còn ảnh nhúng trong JSON thì chuyển sang bảng images
  async function moveInlineImages() {
    const { rows } = await pool.query('SELECT id, data FROM orders');
    for (const r of rows) {
      const d = parse(r.data);
      if (typeof d.image === 'string' && d.image.startsWith('data:')) await tx(c => writeOrder(c, r.id, d));
    }
  }

  async function list(col) {
    const order = col === 'orders' ? 'date DESC, id' : 'id';
    const { rows } = await pool.query(`SELECT id, data FROM ${col} ORDER BY ${order}`);
    return rows.map(r => ({ ...parse(r.data), id: r.id }));
  }

  async function upsert(col, id, item) {
    if (col === 'orders') return tx(c => writeOrder(c, id, item));
    const doc = { ...item, id };
    await pool.query(
      `INSERT INTO flowers (id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [id, JSON.stringify(doc)]);
    return doc;
  }

  async function remove(col, id) {
    return tx(async (c) => {
      if (col === 'orders') await c.query('DELETE FROM images WHERE order_id = $1', [id]);
      const r = await c.query(`DELETE FROM ${col} WHERE id = $1`, [id]);
      return r.rowCount > 0;
    });
  }

  async function getImage(key) {
    if (!IMAGE_KEY_RE.test(key)) return null;
    const { rows } = await pool.query('SELECT mime, data_b64 FROM images WHERE key = $1', [key]);
    return rows[0] ? { mime: rows[0].mime, data: Buffer.from(rows[0].data_b64, 'base64') } : null;
  }

  // Bản sao lưu đầy đủ: ảnh nhúng lại dạng data URL để khôi phục được ở bất kỳ đâu
  async function exportAll() {
    const [orders, flowers] = await Promise.all([list('orders'), list('flowers')]);
    for (const o of orders) {
      const key = keyFromUrl(o.image);
      if (!key) continue;
      const img = await getImage(key);
      o.image = img ? `data:${img.mime};base64,${img.data.toString('base64')}` : '';
    }
    return { app: 'bloom-by-giang', version: 1, exportedAt: new Date().toISOString(), orders, flowers };
  }

  async function ping() { await pool.query('SELECT 1'); }

  return { migrate, moveInlineImages, list, upsert, remove, getImage, exportAll, ping, close: () => pool.end() };
}

function createPgPool(cfg) {
  const { Pool } = require('pg');
  return new Pool({
    connectionString: cfg.databaseUrl,
    ssl: cfg.dbSsl ? { rejectUnauthorized: cfg.dbSslRejectUnauthorized } : false,
    max: cfg.dbPoolMax,
  });
}

module.exports = { createStore, createPgPool, COLS };
