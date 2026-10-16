const fs = require('fs');
const path = require('path');

let pool;

/** Dùng Pool của `pg`; khi test có thể truyền pool giả (pg-mem) vào. */
function setPool(p) { pool = p; }

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Thiếu DATABASE_URL trong .env');
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  }
  return pool;
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  for (const stmt of sql.split(';').map(s => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
    await getPool().query(stmt);
  }
}

const COLS = { orders: true, flowers: true };

async function list(col) {
  const order = col === 'orders' ? 'date DESC, id' : 'id';
  const { rows } = await getPool().query(`SELECT id, data FROM ${col} ORDER BY ${order}`);
  return rows.map(r => ({ ...(typeof r.data === 'string' ? JSON.parse(r.data) : r.data), id: r.id }));
}

async function upsert(col, id, item) {
  const data = JSON.stringify({ ...item, id });
  if (col === 'orders') {
    await getPool().query(
      `INSERT INTO orders (id, date, status, data, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [id, item.date || null, item.status || null, data]);
  } else {
    await getPool().query(
      `INSERT INTO flowers (id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [id, data]);
  }
}

async function remove(col, id) {
  const r = await getPool().query(`DELETE FROM ${col} WHERE id = $1`, [id]);
  return r.rowCount > 0;
}

module.exports = { setPool, getPool, migrate, list, upsert, remove, COLS };
