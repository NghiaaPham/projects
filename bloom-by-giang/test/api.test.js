const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { memoryPool } = require('./memdb');
const { createStore } = require('../src/db');
const { createApp } = require('../src/app');
const password = require('../src/password');

const PW = 'mat-khau-test-' + Date.now();
const baseCfg = {
  nodeEnv: 'test', isProd: false, trustProxy: 0,
  shopPasswordHash: password.hash(PW), jwtSecret: 'x'.repeat(40), jwtExpiresIn: '1h',
  corsOrigins: [], bodyLimit: '1mb', loginRateWindowMin: 15, loginRateMax: 3, clientPollMs: 9000,
};

let app, token;
test.before(async () => {
  const store = createStore(memoryPool());
  await store.migrate();
  app = createApp(baseCfg, store);
});

test('băm và kiểm tra mật khẩu', () => {
  const h = password.hash('abc');
  assert.ok(password.verify('abc', h));
  assert.ok(!password.verify('abd', h));
});

test('sai mật khẩu bị từ chối', async () => {
  await request(app).post('/api/login').send({ password: 'sai' }).expect(401);
});

test('đăng nhập lấy token', async () => {
  const r = await request(app).post('/api/login').send({ password: PW }).expect(200);
  token = r.body.token;
  assert.ok(token);
});

test('chặn dò mật khẩu sau LOGIN_RATE_MAX lần', async () => {
  // đã sai 1 lần ở test trước; sai thêm tới giới hạn (3) thì lần kế tiếp bị chặn
  await request(app).post('/api/login').send({ password: 'sai' }).expect(401);
  await request(app).post('/api/login').send({ password: 'sai' }).expect(401);
  await request(app).post('/api/login').send({ password: 'sai' }).expect(429);
});

test('config cho client lấy từ server', async () => {
  const r = await request(app).get('/api/config').expect(200);
  assert.equal(r.body.pollMs, 9000);
});

test('có header bảo mật', async () => {
  const r = await request(app).get('/api/health').expect(200);
  assert.ok(r.headers['content-security-policy']);
  assert.equal(r.headers['x-powered-by'], undefined);
});

test('chưa đăng nhập thì không đọc được đơn', async () => {
  await request(app).get('/api/orders').expect(401);
});

test('thêm, sửa, đọc, xóa đơn hàng', async () => {
  const auth = { Authorization: 'Bearer ' + token };
  const order = { id: 'o1', name: 'Bó hồng đỏ 20 bông', customer: 'Minh Anh', date: '2026-10-16', time: '08:30', price: 790000, status: 'pending' };
  await request(app).put('/api/orders/o1').set(auth).send(order).expect(200);
  await request(app).put('/api/orders/o1').set(auth).send({ ...order, status: 'done' }).expect(200);
  let r = await request(app).get('/api/orders').set(auth).expect(200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].status, 'done');
  await request(app).delete('/api/orders/o1').set(auth).expect(200);
  r = await request(app).get('/api/orders').set(auth).expect(200);
  assert.equal(r.body.length, 0);
});

test('mẫu hoa và kiểm tra dữ liệu sai', async () => {
  const auth = { Authorization: 'Bearer ' + token };
  await request(app).put('/api/flowers/f1').set(auth).send({ id: 'f1', name: 'Hoa ly mix', price: 650000 }).expect(200);
  const r = await request(app).get('/api/flowers').set(auth).expect(200);
  assert.equal(r.body[0].price, 650000);
  await request(app).put('/api/orders/o2').set(auth).send({ name: 'Thiếu ngày' }).expect(400);
  await request(app).get('/api/khac').set(auth).expect(404);
});

test('config báo thiếu biến môi trường', () => {
  const { load } = require('../src/config');
  const saved = { ...process.env };
  delete process.env.DATABASE_URL; delete process.env.JWT_SECRET; delete process.env.SHOP_PASSWORD; delete process.env.SHOP_PASSWORD_HASH;
  assert.throws(() => load(), /DATABASE_URL/);
  process.env.DATABASE_URL = 'postgres://x'; process.env.SHOP_PASSWORD_HASH = 'scrypt$a$b';
  process.env.JWT_SECRET = 'ngan'; process.env.NODE_ENV = 'production';
  assert.throws(() => load(), /32/);
  process.env = saved;
});
