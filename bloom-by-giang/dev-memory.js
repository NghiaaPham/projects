// Chạy thử ngay không cần Postgres: node dev-memory.js (dữ liệu mất khi tắt).
process.env.SHOP_PASSWORD = process.env.SHOP_PASSWORD || 'demo123';
require('./test/memdb').useMemoryDb();
const db = require('./src/db');
const { createApp } = require('./src/app');
const port = process.env.PORT || 3000;
db.migrate().then(() => createApp().listen(port, () => console.log(`Chạy thử (DB trong bộ nhớ) tại http://localhost:${port}, mật khẩu: ${process.env.SHOP_PASSWORD}`)));
