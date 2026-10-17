const jwt = require('jsonwebtoken');
const password = require('./password');

function createAuth(cfg) {
  function checkPassword(input) {
    if (cfg.shopPasswordHash) return password.verify(input, cfg.shopPasswordHash);
    return password.safeEqual(input, cfg.shopPassword);
  }

  function login(req, res) {
    const input = req.body && req.body.password;
    if (typeof input !== 'string' || !input || !checkPassword(input)) {
      return res.status(401).json({ error: 'Sai mật khẩu' });
    }
    const token = jwt.sign({ role: 'owner' }, cfg.jwtSecret, { expiresIn: cfg.jwtExpiresIn });
    res.json({ token });
  }

  function requireAuth(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'Cần đăng nhập' });
    try { req.user = jwt.verify(m[1], cfg.jwtSecret); next(); }
    catch { res.status(401).json({ error: 'Phiên đăng nhập hết hạn' }); }
  }

  return { login, requireAuth };
}

module.exports = { createAuth };
