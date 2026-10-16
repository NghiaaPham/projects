const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { useMemoryDb } = require('./memdb');
const db = require('../src/db');
const { createApp } = require('../src/app');

process.env.SHOP_PASSWORD = 'matkhau123';
process.env.JWT_SECRET = 'test-secret';

let app, token;
test.before(async () => {
  useMemoryDb();
  await db.migrate();
  app = createApp();
});

test('sai mật khẩu bị từ chối', async () => {
  await request(app).post('/api/login').send({ password: 'sai' }).expect(401);
});

test('đăng nhập lấy token', async () => {
  const r = await request(app).post('/api/login').send({ password: 'matkhau123' }).expect(200);
  token = r.body.token;
  assert.ok(token);
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
  assert.equal(r.body[0].customer, 'Minh Anh');
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
