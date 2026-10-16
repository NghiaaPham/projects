# Bloom by Giang – app quản lý shop hoa + backend

Giao diện quản lý đơn hoa (mobile-first) giờ lưu dữ liệu lên **PostgreSQL** thay vì chỉ lưu trong trình duyệt.
Nhiều máy (điện thoại chủ shop, máy nhân viên) đăng nhập cùng mật khẩu là thấy chung đơn, tự đồng bộ mỗi 15 giây.

## Công nghệ
- Node.js 18+ / Express
- PostgreSQL (khuyên dùng **Supabase** hoặc **Neon** gói free)
- Đăng nhập bằng mật khẩu chủ shop, token JWT hạn 30 ngày

## Chạy thử ngay (không cần cài Postgres)
```bash
cd bloom-by-giang
npm install
node dev-memory.js        # mở http://localhost:3000, mật khẩu: demo123
```
Database nằm trong bộ nhớ, tắt là mất, chỉ để xem thử.

## Chạy với Postgres thật
```bash
cp .env.example .env      # điền DATABASE_URL, SHOP_PASSWORD, JWT_SECRET
npm install
npm start                 # tự tạo bảng ở lần chạy đầu
```

## Test
```bash
npm test
```

## Deploy miễn phí
1. Tạo project trên Supabase (hoặc Neon), copy **connection string** Postgres.
2. Trên Render: New → Blueprint → chọn repo này (đã có `render.yaml` ở gốc repo), điền `DATABASE_URL` và `SHOP_PASSWORD`.
3. Mở link Render, đăng nhập bằng mật khẩu shop.

> Render free "ngủ" sau 15 phút không dùng, lần mở đầu chờ khoảng 30–50 giây.

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
src/auth.js            đăng nhập, JWT
db/schema.sql          bảng orders, flowers
public/index.html      giao diện shop
public/api-adapter.js  nối giao diện với API (thay localStorage) + màn hình đăng nhập
test/                  test API bằng pg-mem
```

Dữ liệu cũ trên trình duyệt (nếu có) tự đẩy lên database ở lần đăng nhập đầu tiên.
