// Mọi cấu hình đọc từ biến môi trường. Thiếu biến bắt buộc là dừng ngay khi khởi động.
const env = process.env;

function int(name, def) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} phải là số, đang là "${v}"`);
  return n;
}
function bool(name, def) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(v);
}
function list(name) {
  return (env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
}

function load() {
  const nodeEnv = env.NODE_ENV || 'development';
  const cfg = {
    nodeEnv,
    isProd: nodeEnv === 'production',
    port: int('PORT', 3000),
    trustProxy: int('TRUST_PROXY', 1),
    databaseUrl: env.DATABASE_URL,
    dbSsl: bool('DB_SSL', true),
    dbSslRejectUnauthorized: bool('DB_SSL_REJECT_UNAUTHORIZED', false),
    dbPoolMax: int('DB_POOL_MAX', 5),
    // mặc định không cần mật khẩu (khách yêu cầu); đặt REQUIRE_LOGIN=true để bật lại đăng nhập
    requireLogin: bool('REQUIRE_LOGIN', false),
    shopPassword: env.SHOP_PASSWORD,
    shopPasswordHash: env.SHOP_PASSWORD_HASH,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '30d',
    corsOrigins: list('CORS_ORIGINS'),
    bodyLimit: env.BODY_LIMIT || '15mb',
    loginRateWindowMin: int('LOGIN_RATE_WINDOW_MIN', 15),
    loginRateMax: int('LOGIN_RATE_MAX', 10),
    clientPollMs: int('CLIENT_POLL_MS', 15000),
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY || '',
    sourceAppUrl: env.SOURCE_APP_URL || '',
    sourceAppPassword: env.SOURCE_APP_PASSWORD || env.SHOP_PASSWORD || '',
    sourceDatabaseUrl: env.SOURCE_DATABASE_URL || '',
    sourceDbPassword: env.SOURCE_PGPASSWORD || '',
    supabaseBucket: env.SUPABASE_BUCKET || 'order-images',
  };

  const missing = [];
  if (!cfg.databaseUrl) missing.push('DATABASE_URL');
  if (cfg.requireLogin && !cfg.shopPassword && !cfg.shopPasswordHash) missing.push('SHOP_PASSWORD_HASH (hoặc SHOP_PASSWORD)');
  if (!cfg.jwtSecret) missing.push('JWT_SECRET');
  if (!!cfg.supabaseUrl !== !!cfg.supabaseServiceKey) missing.push(cfg.supabaseUrl ? 'SUPABASE_SERVICE_KEY' : 'SUPABASE_URL');
  if (missing.length) throw new Error('Thiếu biến môi trường: ' + missing.join(', '));
  if (cfg.shopPasswordHash && !/^scrypt:[a-f0-9]+:[a-f0-9]+$/.test(cfg.shopPasswordHash.trim())) throw new Error('SHOP_PASSWORD_HASH sai định dạng, tạo lại bằng: npm run hash-password -- "matkhau"');
  if (cfg.isProd && cfg.jwtSecret.length < 32) throw new Error('JWT_SECRET phải dài ít nhất 32 ký tự khi chạy production');
  if (cfg.requireLogin && cfg.isProd && !cfg.shopPasswordHash) console.warn('[cảnh báo] Nên dùng SHOP_PASSWORD_HASH thay cho SHOP_PASSWORD ở production (npm run hash-password)');
  return cfg;
}

module.exports = { load };
