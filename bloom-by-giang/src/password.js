// Băm mật khẩu bằng scrypt có sẵn trong Node, định dạng: scrypt$<salt hex>$<hash hex>
const crypto = require('crypto');
const KEYLEN = 64;

function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verify(password, stored) {
  const [algo, saltHex, keyHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

module.exports = { hash, verify, safeEqual };
