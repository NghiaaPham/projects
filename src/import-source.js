// Chuyển dữ liệu một lần từ database cũ sang database mới (khi bàn giao).
// Chỉ chạy khi có SOURCE_DATABASE_URL và database mới còn trống, nên khởi động lại nhiều lần vẫn an toàn.
async function importFromSource(target, source, log = () => {}) {
  const { rows: [t] } = await target.query('SELECT (SELECT count(*) FROM orders) + (SELECT count(*) FROM flowers) AS n');
  if (Number(t.n) > 0) { log('import skipped: target not empty'); return { skipped: true }; }
  const [orders, flowers] = await Promise.all([
    source.query('SELECT id, date, status, data, updated_at FROM orders'),
    source.query('SELECT id, data, updated_at FROM flowers'),
  ]);
  const client = await target.connect();
  let images = 0;
  try {
    await client.query('BEGIN');
    for (const r of orders.rows) await client.query('INSERT INTO orders (id, date, status, data, updated_at) VALUES ($1,$2,$3,$4,$5)', [r.id, r.date, r.status, JSON.stringify(r.data), r.updated_at]);
    for (const r of flowers.rows) await client.query('INSERT INTO flowers (id, data, updated_at) VALUES ($1,$2,$3)', [r.id, JSON.stringify(r.data), r.updated_at]);
    // ảnh đọc từng đợt để không giữ hết trong bộ nhớ
    const { rows: keys } = await source.query('SELECT key FROM images ORDER BY key');
    for (let i = 0; i < keys.length; i += 50) {
      const batch = keys.slice(i, i + 50).map(k => k.key);
      const ph = batch.map((_, j) => '$' + (j + 1)).join(',');
      const { rows } = await source.query(`SELECT key, order_id, mime, data_b64, created_at FROM images WHERE key IN (${ph})`, batch);
      for (const r of rows) { await client.query('INSERT INTO images (key, order_id, mime, data_b64, created_at) VALUES ($1,$2,$3,$4,$5)', [r.key, r.order_id, r.mime, r.data_b64, r.created_at]); images++; }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  const out = { orders: orders.rowCount, flowers: flowers.rowCount, images };
  log('import done', out);
  return out;
}

module.exports = { importFromSource };
