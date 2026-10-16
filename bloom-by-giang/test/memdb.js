// Database Postgres giả trong bộ nhớ, dùng cho test và chạy thử không cần cài Postgres.
const { newDb } = require('pg-mem');
const db = require('../src/db');

function useMemoryDb() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  db.setPool(new Pool());
  return mem;
}
module.exports = { useMemoryDb };
