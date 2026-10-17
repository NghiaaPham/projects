require('dotenv').config();
const { load } = require('./config');
const { createApp } = require('./app');
const { createStore, createPgPool } = require('./db');
const { createSupabaseBlobs } = require('./blobs');

async function main() {
  const cfg = load();
  const blobs = cfg.supabaseUrl ? createSupabaseBlobs({ url: cfg.supabaseUrl, key: cfg.supabaseServiceKey, bucket: cfg.supabaseBucket }) : null;
  const store = createStore(createPgPool(cfg), blobs);
  await store.migrate();
  if (cfg.sourceDatabaseUrl) {
    const { Pool } = require('pg');
    const { importFromSource } = require('./import-source');
    const ssl = cfg.dbSsl ? { rejectUnauthorized: cfg.dbSslRejectUnauthorized } : false;
    const source = new Pool({ connectionString: cfg.sourceDatabaseUrl, ...(cfg.sourceDbPassword ? { password: cfg.sourceDbPassword } : {}), ssl, max: 2 });
    const target = createPgPool(cfg);
    try {
      await importFromSource(target, source, (msg, extra) => console.log(JSON.stringify({ level: 'info', msg, ...extra })));
    } finally { await Promise.all([source.end(), target.end()]); }
  }
  if (blobs) store.moveImagesToStorage()
    .then(n => n && console.log(JSON.stringify({ level: 'info', msg: 'images moved to storage', count: n })))
    .catch(e => console.error(JSON.stringify({ level: 'warn', msg: 'move images to storage failed', err: e.message })));
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
