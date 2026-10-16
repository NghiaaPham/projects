// Pool cho test: có TEST_DATABASE_URL thì dùng Postgres thật (CI), không thì pg-mem trong bộ nhớ.
const { newDb } = require('pg-mem');

function memoryPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

let schemaN = 0;
async function testPool() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return memoryPool();
  const { Pool } = require('pg');
  // mỗi lần gọi dùng một schema riêng để test không đụng nhau
  const schema = `t_${process.pid}_${Date.now()}_${schemaN++}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  return new Pool({ connectionString: url, options: `-c search_path=${schema}` });
}

module.exports = { memoryPool, testPool };
