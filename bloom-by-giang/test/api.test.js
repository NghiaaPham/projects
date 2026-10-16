const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { testPool } = require('./memdb');
const { createStore } = require('../src/db');
const { createApp } = require('../src/app');
const password = require('../src/password');

const PW = 'mat-khau-test-' + Date.now();
const baseCfg = {
  nodeEnv: 'test', isProd: false, trustProxy: 0,
  shopPasswordHash: password.hash(PW), jwtSecret: 'x'.repeat(40), jwtExpiresIn: '1h',
  corsOrigins: [], bodyLimit: '1mb', loginRateWindowMin: 15, loginRateMax: 3, clientPollMs: 9000,
};

let app, token, store;
test.after(() => store.close());
test.before(async () => {
  store = createStore(await testPool());
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
  process.env.DATABASE_URL = 'postgres://x'; process.env.SHOP_PASSWORD_HASH = 'scrypt:aa:bb';
  process.env.JWT_SECRET = 'ngan'; process.env.NODE_ENV = 'production';
  assert.throws(() => load(), /32/);
  process.env = saved;
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('ảnh đơn tách bảng riêng, đọc được, giữ khi sửa, xoá theo đơn', async () => {
  const auth = { Authorization: 'Bearer ' + token };
  const base = { id: 'img1', name: 'Có ảnh', date: '2026-10-16', status: 'pending', image: PNG };
  const saved = (await request(app).put('/api/orders/img1').set(auth).send(base).expect(200)).body;
  assert.match(saved.image, /^\/api\/images\/[a-f0-9]{32}$/);
  const list = (await request(app).get('/api/orders').set(auth).expect(200)).body;
  assert.equal(list.find(o => o.id === 'img1').image, saved.image);
  const img = await request(app).get(saved.image).expect(200);
  assert.equal(img.headers['content-type'], 'image/png');
  // sửa trạng thái, gửi lại đường dẫn cũ -> giữ nguyên ảnh
  const edited = (await request(app).put('/api/orders/img1').set(auth).send({ ...base, image: saved.image, status: 'done' }).expect(200)).body;
  assert.equal(edited.image, saved.image);
  // sao lưu đầy đủ nhúng lại ảnh
  const bk = (await request(app).get('/api/export').set(auth).expect(200)).body;
  assert.equal(bk.orders.find(o => o.id === 'img1').image, PNG);
  // bỏ ảnh -> ảnh cũ bị xoá
  await request(app).put('/api/orders/img1').set(auth).send({ ...base, image: '' }).expect(200);
  await request(app).get(saved.image).expect(404);
  // đơn có ảnh mới, xoá đơn -> xoá ảnh
  const again = (await request(app).put('/api/orders/img1').set(auth).send(base).expect(200)).body;
  await request(app).delete('/api/orders/img1').set(auth).expect(200);
  await request(app).get(again.image).expect(404);
});

test('export cần đăng nhập, ảnh sai khoá trả 404', async () => {
  await request(app).get('/api/export').expect(401);
  await request(app).get('/api/images/khongtonai').expect(404);
});

test('migrate chuyển ảnh nhúng của dữ liệu cũ sang bảng images', async () => {
  const pool = await testPool();
  const s2 = createStore(pool);
  await s2.migrate();
  await pool.query('INSERT INTO orders (id, date, status, data) VALUES ($1, $2, $3, $4)',
    ['old1', '2026-10-01', 'done', JSON.stringify({ id: 'old1', name: 'Đơn cũ', date: '2026-10-01', image: PNG })]);
  await s2.moveInlineImages(); // migrate() gọi hàm này mỗi lần khởi động
  const [o] = await s2.list('orders');
  assert.match(o.image, /^\/api\/images\//);
  const img = await s2.getImage(o.image.split('/').pop());
  assert.ok(img && img.data.length > 0);
  await s2.close();
});

test('poll danh sách: không đổi thì 304 rỗng, có ghi thì 200 dữ liệu mới', async () => {
  const auth = { Authorization: 'Bearer ' + token };
  await request(app).put('/api/orders/e1').set(auth).send({ id: 'e1', name: 'Đơn ETag', date: '2026-10-16', status: 'pending' }).expect(200);
  const a = await request(app).get('/api/orders').set(auth).expect(200);
  const tag = a.headers.etag;
  assert.ok(tag);
  assert.match(a.headers['cache-control'], /no-cache/);
  // trình duyệt (fetch cache:'no-store') gửi kèm Cache-Control/Pragma: no-cache, vẫn phải được 304
  const b = await request(app).get('/api/orders').set(auth).set('If-None-Match', tag).set('Cache-Control', 'no-cache').set('Pragma', 'no-cache').expect(304);
  assert.equal(b.text, '');
  await request(app).put('/api/orders/e1').set(auth).send({ id: 'e1', name: 'Đơn ETag', date: '2026-10-16', status: 'done' }).expect(200);
  const c = await request(app).get('/api/orders').set(auth).set('If-None-Match', tag).expect(200);
  assert.equal(c.body.find(o => o.id === 'e1').status, 'done');
  assert.notEqual(c.headers.etag, tag);
  await request(app).delete('/api/orders/e1').set(auth).expect(200);
  await request(app).get('/api/orders').set(auth).set('If-None-Match', c.headers.etag).expect(200);
  // không có token thì vẫn 401, không lộ ETag
  await request(app).get('/api/orders').set('If-None-Match', tag).expect(401);
});

test('nén gzip, index.html luôn hỏi lại (ETag/304), file có ?v= cache lâu', async () => {
  const idx = await request(app).get('/').set('Accept-Encoding', 'gzip').expect(200);
  assert.equal(idx.headers['content-encoding'], 'gzip');
  assert.equal(idx.headers['cache-control'], 'no-cache');
  const m = /src="api-adapter\.js\?v=([a-f0-9]{10})"/.exec(idx.text);
  assert.ok(m, 'index.html phải gắn phiên bản cho api-adapter.js');
  assert.match(idx.text, /src="icons\/logo\.jpg\?v=[a-f0-9]{10}"/);
  await request(app).get('/').set('If-None-Match', idx.headers.etag).expect(304);
  const js = await request(app).get('/api-adapter.js?v=' + m[1]).set('Accept-Encoding', 'gzip').expect(200);
  assert.match(js.headers['cache-control'], /max-age=31536000, immutable/);
  assert.equal(js.headers['content-encoding'], 'gzip');
  const plain = await request(app).get('/api-adapter.js').expect(200);
  assert.equal(plain.headers['cache-control'], 'no-cache');
  assert.match((await request(app).get('/icons/icon-192.png').expect(200)).headers['cache-control'], /max-age=2592000/);
  const mf = await request(app).get('/manifest.webmanifest').set('Accept-Encoding', 'gzip').expect(200);
  assert.match(mf.headers['cache-control'], /max-age=604800/);
  const h = await request(app).get('/api/health').expect(200);
  assert.equal(h.headers['cache-control'], 'no-store');
});

test('phiên bản dữ liệu đổi khi có người sửa thẳng trong database', async () => {
  const pool = await testPool();
  const s2 = createStore(pool);
  await s2.migrate();
  const v0 = await s2.version('orders');
  await pool.query('INSERT INTO orders (id, date, status, data) VALUES ($1, $2, $3, $4)',
    ['ext1', '2026-10-01', 'done', JSON.stringify({ id: 'ext1', name: 'Thêm ngoài app', date: '2026-10-01' })]);
  const v1 = await s2.version('orders');
  assert.notEqual(v1, v0);
  await pool.query('DELETE FROM orders WHERE id = $1', ['ext1']);
  assert.notEqual(await s2.version('orders'), v1);
  await s2.close();
});
