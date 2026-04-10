# Data Source Strategy - Kết hợp nhiều nguồn

## 1. Nguyên tắc

- Ưu tiên nguồn hợp lệ, có thể kiểm chứng.
- Tách data raw và data đã chuẩn hóa.
- Có cơ chế trace nguồn gốc bản ghi.

## 2. Nhóm nguồn dữ liệu

1. Nguồn công khai
- Dữ liệu đấu thầu công khai, website công bố thông tin.
- Mục tiêu: bao phủ tin mới và metadata cơ bản.

2. Nguồn import thủ công
- CSV/Excel do user upload.
- Mục tiêu: cho phép onboard nhanh với dữ liệu nội bộ.

3. Nguồn API chính thức (nếu có)
- Kết nối qua connector riêng.
- Mục tiêu: tăng độ tin cậy và cập nhật ổn định.

## 3. Pipeline đề xuất

1. Ingest
- Scheduler lấy dữ liệu theo tần suất.
- File import parser theo template.

2. Normalize
- Chuẩn hóa trường: tên gói thầu, địa phương, lĩnh vực, giá trị, thời gian.
- Mapping key chung để gộp bản ghi trùng lặp.

3. Index
- Tạo index phục vụ search và filter nhanh.

4. Serve
- tRPC trả dữ liệu cho UI và workflow engine.

## 4. Quality và governance

- Có data_version để truy vết.
- Có duplicate score khi merge.
- Có đánh dấu độ tin cậy theo nguồn.
- Có chính sách xóa/ẩn dữ liệu theo yêu cầu.

## 5. Implementation notes cho MVP

- Giai đoạn đầu: kết hợp import file + 1-2 nguồn public ổn định.
- Lưu schema ingest giản lược, dễ mở rộng sau.
- Chưa phụ thuộc vào API private nếu chưa được cấp quyền.

## 6. Ranh giới pháp lý và vận hành

- Kiểm tra điều khoản sử dụng của từng nguồn trước khi crawl/ingest.
- Giới hạn tần suất truy cập, tôn trọng robots/chính sách hiện hành.
- Lưu log ingest để phục vụ audit nội bộ.

## Checklist dữ liệu

- [ ] Lập danh sách nguồn dữ liệu được phép sử dụng.
- [ ] Chốt template import CSV/Excel cho người dùng nội bộ.
- [ ] Hoàn thành mapping chuẩn hóa dữ liệu đầu vào.
- [ ] Thiết lập cơ chế phát hiện bản ghi trùng lặp.
- [ ] Thiết lập log ingest và cơ chế truy vết data_version.