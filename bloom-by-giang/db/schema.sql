-- Mỗi đơn / mẫu hoa lưu nguyên một bản ghi JSON (giống cấu trúc app đang dùng),
-- thêm vài cột tách riêng để lọc và sắp xếp nhanh.
CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  date        TEXT,
  status      TEXT,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_date_idx ON orders (date);

CREATE TABLE IF NOT EXISTS flowers (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
