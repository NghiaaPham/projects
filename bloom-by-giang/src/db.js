const fs = require('fs');
const path = require('path');

const COLS = { orders: true, flowers: true };

/** Tạo kho dữ liệu từ một Pool kiểu `pg` (Postgres thật, hoặc pg-mem khi test). */
function createStore(pool) {
  async function migrate() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    const stmts = sql.split(';').map(s => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
    for (const stmt of stmts) await pool.query(stmt);
  }

  async function list(col) {
    const order = col === 'orders' ? 'date DESC, id' : 'id';
    const { rows } = await pool.query(`SELECT id, data FROM ${col} ORDER BY ${order}`);
    return rows.map(r => ({ ...(typeof r.data === 'string' ? JSON.parse(r.data) : r.data), id: r.id }));
  }

  async function upsert(col, id, item) {
    const data = JSON.stringify({ ...item, id });
    if (col === 'orders') {
      await pool.query(
        `INSERT INTO orders (id, date, status, data, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
        [id, item.date || null, item.status || null, data]);
    } else {
      await pool.query(
        `INSERT INTO flowers (id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [id, data]);
    }
  }

  async function remove(col, id) {
    const r = await pool.query(`DELETE FROM ${col} WHERE id = $1`, [id]);
    return r.rowCount > 0;
  }

  async function ping() { await pool.query('SELECT 1'); }

  return { migrate, list, upsert, remove, ping, close: () => pool.end() };
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
