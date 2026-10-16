// Chạy thử không cần Postgres: DEV_PASSWORD=abc node dev-memory.js (dữ liệu mất khi tắt).
// Không dùng file này cho production.
require('dotenv').config();
const crypto = require('crypto');
const { memoryPool } = require('./test/memdb');
const { createStore } = require('./src/db');
const { createApp } = require('./src/app');

const password = process.env.DEV_PASSWORD;
if (!password) { console.error('Đặt DEV_PASSWORD trước khi chạy, ví dụ: DEV_PASSWORD=abc node dev-memory.js'); process.exit(1); }
const cfg = {
  nodeEnv: 'development', isProd: false, port: Number(process.env.PORT) || 3000, trustProxy: 0,
  shopPassword: password, jwtSecret: crypto.randomBytes(32).toString('hex'), jwtExpiresIn: '1d',
  corsOrigins: [], bodyLimit: '15mb', loginRateWindowMin: 15, loginRateMax: 50, clientPollMs: 15000,
};
const store = createStore(memoryPool());
store.migrate().then(() => createApp(cfg, store).listen(cfg.port, () =>
  console.log(`Chạy thử (DB trong bộ nhớ) tại http://localhost:${cfg.port}`)));
