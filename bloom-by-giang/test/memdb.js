// Pool Postgres giả trong bộ nhớ (pg-mem) cho test và chạy thử.
const { newDb } = require('pg-mem');
function memoryPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}
module.exports = { memoryPool };
