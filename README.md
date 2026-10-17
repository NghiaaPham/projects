# Bloom by Giang – app quản lý shop hoa + backend

Giao diện quản lý đơn hoa (mobile-first) giờ lưu dữ liệu lên **PostgreSQL** thay vì chỉ lưu trong trình duyệt.
Nhiều máy (điện thoại chủ shop, máy nhân viên) đăng nhập cùng mật khẩu là thấy chung đơn, tự đồng bộ mỗi 15 giây.

## Công nghệ
- Node.js 18+ / Express, PostgreSQL (Supabase / Neon free hoặc Postgres riêng)
- Đăng nhập mật khẩu chủ shop (băm scrypt), token JWT
- Helmet (CSP, header bảo mật), giới hạn dò mật khẩu theo IP, CORS theo danh sách domain
- Cấu hình 100% qua biến môi trường, thiếu biến bắt buộc là server dừng ngay khi khởi động
- Health check có kiểm tra database, tắt server êm (SIGTERM), log JSON
- Ảnh đơn tách bảng `images` (đơn chỉ giữ đường dẫn), danh sách tải nhẹ; dữ liệu cũ có ảnh nhúng tự chuyển khi khởi động
- Sao lưu đầy đủ kèm ảnh: nút "Tải file sao lưu" trong app hoặc `GET /api/export`
- Dockerfile, GitHub Actions CI (test trên pg-mem + PostgreSQL 16 thật, npm audit)
- Tải nhanh: nén gzip/brotli; `index.html` luôn hỏi lại server (ETag, không bao giờ dùng giao diện cũ);
  `api-adapter.js` và logo được gắn `?v=<hash>` tự động nên cache 1 năm; icon 30 ngày, manifest 7 ngày
- Đồng bộ 15 giây dùng ETag: dữ liệu không đổi thì server trả `304` rỗng, giao diện không vẽ lại; tạm dừng khi ẩn app
- Workflow `bloom-by-giang keepalive` gọi `/api/health` mỗi 10 phút từ 06:00 đến 22:00 giờ VN để Render free không ngủ trong giờ bán

## Biến môi trường
Xem đầy đủ trong `.env.example`. Bắt buộc:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối Postgres |
| `SHOP_PASSWORD_HASH` | Mật khẩu chủ shop đã băm: `npm run hash-password -- "matkhau"` |
| `JWT_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự khi `NODE_ENV=production` |

Tuỳ chọn: `PORT`, `TRUST_PROXY`, `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`, `DB_POOL_MAX`, `JWT_EXPIRES_IN`,
`CORS_ORIGINS`, `BODY_LIMIT`, `LOGIN_RATE_WINDOW_MIN`, `LOGIN_RATE_MAX`, `CLIENT_POLL_MS`.

**Ảnh trên Supabase Storage (tuỳ chọn, khuyên dùng):** đặt `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service_role)
và `SUPABASE_BUCKET` (mặc định `order-images`, tạo bucket Private). Khi bật, ảnh mới lên Storage (1GB free),
database chỉ giữ khoá; ảnh cũ trong database tự chuyển dần sang khi server khởi động. Không đặt thì ảnh lưu trong database như cũ.

## Chạy thử nhanh (không cần Postgres)
```bash
cd bloom-by-giang
npm install
DEV_PASSWORD=matkhauthu npm run dev:memory   # http://localhost:3000
```
Database nằm trong bộ nhớ, tắt là mất. Không dùng cho production.

## Chạy với Postgres
```bash
cp .env.example .env      # điền các biến bắt buộc
npm install
npm start                 # tự tạo bảng ở lần chạy đầu
```

## Test
```bash
npm test                                            # Postgres giả trong bộ nhớ
TEST_DATABASE_URL=postgresql://... npm test         # chạy trên Postgres thật
```

## Deploy
**Render (free):** New → Blueprint → chọn repo (có `render.yaml` ở gốc), điền `DATABASE_URL`, `SHOP_PASSWORD_HASH`; `JWT_SECRET` Render tự sinh.
Render free ngủ sau 15 phút không dùng, lần mở đầu chờ khoảng 30–60 giây (ngoài giờ keepalive).

**Docker:**
```bash
docker build -t bloom-by-giang .
docker run -p 3000:3000 --env-file .env bloom-by-giang
```

Giao diện gọi API cùng domain. Muốn đặt API ở domain khác, thêm vào `public/index.html`:
`<meta name="bloom-api" content="https://api.domain-cua-ban.com">` và khai báo domain giao diện trong `CORS_ORIGINS`.

## API
Tất cả route `/api/*` (trừ login/health) cần header `Authorization: Bearer <token>`.

| Method | Route | Mô tả |
|---|---|---|
| POST | `/api/login` | `{ "password": "..." }` → `{ "token": "..." }` |
| GET | `/api/health` | Kiểm tra server |
| GET | `/api/orders` | Danh sách đơn (gửi `If-None-Match` để nhận `304` khi không đổi) |
| PUT | `/api/orders/:id` | Thêm / sửa đơn |
| DELETE | `/api/orders/:id` | Xóa đơn |
| GET | `/api/flowers` | Danh mục mẫu hoa |
| PUT | `/api/flowers/:id` | Thêm / sửa mẫu hoa |
| DELETE | `/api/flowers/:id` | Xóa mẫu hoa |
| GET | `/api/images/:key` | Ảnh đơn (khoá ngẫu nhiên 128-bit, không cần token) |
| GET | `/api/export` | Bản sao lưu đầy đủ kèm ảnh |
| GET | `/api/config` | Cấu hình cho giao diện (chu kỳ đồng bộ) |

## Cấu trúc
```
src/app.js             route Express
src/db.js              truy vấn Postgres
src/config.js          đọc + kiểm tra biến môi trường
src/auth.js            đăng nhập, JWT
src/password.js        băm mật khẩu scrypt
scripts/hash-password.js  tạo SHOP_PASSWORD_HASH
db/schema.sql          bảng orders, flowers
public/index.html      giao diện shop
public/api-adapter.js  nối giao diện với API (thay localStorage) + màn hình đăng nhập
test/                  test API bằng pg-mem
```

Dữ liệu cũ trên trình duyệt (nếu có) tự đẩy lên database ở lần đăng nhập đầu tiên.
