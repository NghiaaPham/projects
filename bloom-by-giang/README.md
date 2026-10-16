# Bloom by Giang – app quản lý shop hoa + backend

Giao diện quản lý đơn hoa (mobile-first) giờ lưu dữ liệu lên **PostgreSQL** thay vì chỉ lưu trong trình duyệt.
Nhiều máy (điện thoại chủ shop, máy nhân viên) đăng nhập cùng mật khẩu là thấy chung đơn, tự đồng bộ mỗi 15 giây.

## Công nghệ
- Node.js 18+ / Express, PostgreSQL (Supabase / Neon free hoặc Postgres riêng)
- Đăng nhập mật khẩu chủ shop (băm scrypt), token JWT
- Helmet (CSP, header bảo mật), giới hạn dò mật khẩu theo IP, CORS theo danh sách domain
- Cấu hình 100% qua biến môi trường, thiếu biến bắt buộc là server dừng ngay khi khởi động
- Health check có kiểm tra database, tắt server êm (SIGTERM), log JSON
- Dockerfile, GitHub Actions CI (test + npm audit)

## Biến môi trường
Xem đầy đủ trong `.env.example`. Bắt buộc:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối Postgres |
| `SHOP_PASSWORD_HASH` | Mật khẩu chủ shop đã băm: `npm run hash-password -- "matkhau"` |
| `JWT_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự khi `NODE_ENV=production` |

Tuỳ chọn: `PORT`, `TRUST_PROXY`, `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`, `DB_POOL_MAX`, `JWT_EXPIRES_IN`,
`CORS_ORIGINS`, `BODY_LIMIT`, `LOGIN_RATE_WINDOW_MIN`, `LOGIN_RATE_MAX`, `CLIENT_POLL_MS`.

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
npm test
```

## Deploy
**Render (free):** New → Blueprint → chọn repo (có `render.yaml` ở gốc), điền `DATABASE_URL`, `SHOP_PASSWORD_HASH`; `JWT_SECRET` Render tự sinh.
Render free ngủ sau 15 phút không dùng, lần mở đầu chờ khoảng 30–50 giây.

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
| GET | `/api/orders` | Danh sách đơn |
| PUT | `/api/orders/:id` | Thêm / sửa đơn |
| DELETE | `/api/orders/:id` | Xóa đơn |
| GET | `/api/flowers` | Danh mục mẫu hoa |
| PUT | `/api/flowers/:id` | Thêm / sửa mẫu hoa |
| DELETE | `/api/flowers/:id` | Xóa mẫu hoa |

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
