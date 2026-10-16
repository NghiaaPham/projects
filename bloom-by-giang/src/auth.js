const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const secret = () => process.env.JWT_SECRET || 'doi-chuoi-nay-trong-env';

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function login(req, res) {
  const expected = process.env.SHOP_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'Chưa đặt SHOP_PASSWORD trên server' });
  const { password } = req.body || {};
  if (!password || !safeEqual(password, expected)) return res.status(401).json({ error: 'Sai mật khẩu' });
  const token = jwt.sign({ role: 'owner' }, secret(), { expiresIn: '30d' });
  res.json({ token });
}

function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'Cần đăng nhập' });
  try { req.user = jwt.verify(m[1], secret()); next(); }
  catch { res.status(401).json({ error: 'Phiên đăng nhập hết hạn' }); }
}

module.exports = { login, requireAuth };
