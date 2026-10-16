require('dotenv').config();
const { load } = require('./config');
const { createApp } = require('./app');
const { createStore, createPgPool } = require('./db');

async function main() {
  const cfg = load();
  const store = createStore(createPgPool(cfg));
  await store.migrate();
  const server = createApp(cfg, store).listen(cfg.port, () =>
    console.log(JSON.stringify({ level: 'info', msg: 'server started', port: cfg.port, env: cfg.nodeEnv })));

  const shutdown = (sig) => {
    console.log(JSON.stringify({ level: 'info', msg: 'shutting down', signal: sig }));
    server.close(() => store.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => { console.error(JSON.stringify({ level: 'fatal', msg: err.message })); process.exit(1); });
