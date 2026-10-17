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
function createStore(pool, blobs = null) {
  const log = (msg, extra) => console.error(JSON.stringify({ level: 'warn', msg, ...extra }));
  // ảnh cần xoá khỏi Storage sau khi giao dịch xong (xoá trễ, lỗi chỉ để lại file mồ côi chứ không mất dữ liệu)
  const dropBlobs = (keys) => { if (blobs && keys.length) blobs.del(keys).catch(e => log('storage delete failed', { err: e.message })); };
  const deleteImages = async (q, where, params, gone) => {
    const r = await q.query(`DELETE FROM images WHERE ${where} RETURNING key, data_b64`, params);
    for (const row of r.rows) if (!row.data_b64) gone.push(row.key);
  };
  // Phiên bản dữ liệu cho ETag: đếm số lần ghi qua server này (kèm mã lần khởi động),
  // cộng số dòng + updated_at mới nhất để vẫn nhận ra nếu ai đó sửa thẳng trong database.
  const boot = crypto.randomBytes(4).toString('hex');
  const writes = { orders: 0, flowers: 0 };
  const bump = (col) => { writes[col]++; };

  async function tx(fn) {
    const client = await pool.connect();
    const gone = [];
    try {
      await client.query('BEGIN');
      const out = await fn(client, gone);
      await client.query('COMMIT');
      dropBlobs(gone);
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
  async function resolveImage(q, orderId, image, gone) {
    const m = typeof image === 'string' ? DATA_URL_RE.exec(image) : null;
    if (m) {
      const key = crypto.randomBytes(16).toString('hex');
      let b64 = m[2];
      if (blobs) { await blobs.put(key, m[1], Buffer.from(b64, 'base64')); b64 = ''; }
      await deleteImages(q, 'order_id = $1', [orderId], gone);
      await q.query('INSERT INTO images (key, order_id, mime, data_b64) VALUES ($1, $2, $3, $4)',
        [key, orderId, m[1], b64]);
      return IMAGE_PATH + key;
    }
    const key = keyFromUrl(image);
    if (key) {
      await deleteImages(q, 'order_id = $1 AND key <> $2', [orderId, key], gone);
      return image;
    }
    await deleteImages(q, 'order_id = $1', [orderId], gone);
    return '';
  }

  async function writeOrder(q, id, item, gone) {
    const image = await resolveImage(q, id, item.image, gone);
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
      if (typeof d.image === 'string' && d.image.startsWith('data:')) { await tx((c, g) => writeOrder(c, r.id, d, g)); bump('orders'); }
    }
  }

  async function list(col) {
    const order = col === 'orders' ? 'date DESC, id' : 'id';
    const { rows } = await pool.query(`SELECT id, data FROM ${col} ORDER BY ${order}`);
    return rows.map(r => ({ ...parse(r.data), id: r.id }));
  }

  // Gọi TRƯỚC khi đọc danh sách: nếu có ghi xen giữa, lần sau thẻ khác nên client tải lại, không bao giờ kẹt dữ liệu cũ
  async function version(col) {
    const { rows } = await pool.query(`SELECT count(*) AS n, max(updated_at) AS m FROM ${col}`);
    const m = rows[0].m ? new Date(rows[0].m).getTime() : 0;
    return `${boot}-${writes[col]}-${Number(rows[0].n)}-${m}`;
  }

  async function upsert(col, id, item) {
    try {
      if (col === 'orders') return await tx((c, g) => writeOrder(c, id, item, g));
      const doc = { ...item, id };
      await pool.query(
        `INSERT INTO flowers (id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [id, JSON.stringify(doc)]);
      return doc;
    } finally { bump(col); }
  }

  async function remove(col, id) {
    try {
      return await tx(async (c, g) => {
        if (col === 'orders') await deleteImages(c, 'order_id = $1', [id], g);
        const r = await c.query(`DELETE FROM ${col} WHERE id = $1`, [id]);
        return r.rowCount > 0;
      });
    } finally { bump(col); }
  }

  async function getImage(key) {
    if (!IMAGE_KEY_RE.test(key)) return null;
    const { rows } = await pool.query('SELECT mime, data_b64 FROM images WHERE key = $1', [key]);
    const row = rows[0];
    if (!row) return null;
    if (row.data_b64) return { mime: row.mime, data: Buffer.from(row.data_b64, 'base64') };
    if (!blobs) return null;
    const b = await blobs.get(key);
    return b ? { mime: row.mime, data: b.data } : null;
  }

  // Chuyển dần ảnh đang nằm trong database sang Storage (chạy nền khi khởi động, an toàn nếu bị ngắt giữa chừng)
  async function moveImagesToStorage(batch = 20) {
    if (!blobs) return 0;
    let moved = 0;
    for (;;) {
      const { rows } = await pool.query("SELECT key, mime, data_b64 FROM images WHERE data_b64 <> '' LIMIT " + Number(batch));
      if (!rows.length) return moved;
      for (const r of rows) {
        await blobs.put(r.key, r.mime, Buffer.from(r.data_b64, 'base64'));
        await pool.query("UPDATE images SET data_b64 = '' WHERE key = $1", [r.key]);
        moved++;
      }
    }
  }

  // Bản sao lưu đầy đủ: ảnh nhúng lại dạng data URL để khôi phục được ở bất kỳ đâu
  async function exportAll() {
    const [orders, flowers, imgs] = await Promise.all([list('orders'), list('flowers'),
      pool.query('SELECT key, mime, data_b64 FROM images')]);
    // một truy vấn cho tất cả ảnh thay vì mỗi đơn một truy vấn
    const byKey = new Map(imgs.rows.map(r => [r.key, r]));
    const todo = [];
    for (const o of orders) {
      const key = keyFromUrl(o.image);
      if (!key) continue;
      const img = byKey.get(key);
      if (img && img.data_b64) o.image = `data:${img.mime};base64,${Buffer.from(img.data_b64, 'base64').toString('base64')}`;
      else if (img && blobs) todo.push([o, key, img.mime]);
      else o.image = '';
    }
    // ảnh trên Storage: tải song song tối đa 8 cái một lúc
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map(async ([o, key, mime]) => {
        try { const b = await blobs.get(key); o.image = b ? `data:${mime};base64,${b.data.toString('base64')}` : ''; }
        catch (e) { log('storage get failed', { key, err: e.message }); o.image = ''; }
      }));
    }
    return { app: 'bloom-by-giang', version: 1, exportedAt: new Date().toISOString(), orders, flowers };
  }

  async function ping() { await pool.query('SELECT 1'); }

  return { migrate, moveInlineImages, moveImagesToStorage, list, version, upsert, remove, getImage, exportAll, ping, close: () => pool.end() };
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
