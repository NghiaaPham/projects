require('dotenv').config();
const { createApp } = require('./app');
const db = require('./db');

const port = process.env.PORT || 3000;

db.migrate()
  .then(() => createApp().listen(port, () => console.log(`Bloom by Giang chạy tại http://localhost:${port}`)))
  .catch(err => { console.error('Không kết nối được database:', err.message); process.exit(1); });
