# UX/UI Spec - Dashboard card-based và workflows

## 1. Nguyên tắc thiết kế

- Trực quan và dễ quét thông tin nhanh trong 3-5 giây.
- Ưu tiên hành động tiếp theo (next best action) trên từng card.
- Hiển thị dữ liệu đúng ngữ cảnh, hạn chế thông tin thừa.
- Đồng nhất ngôn ngữ tiếng Việt trong toàn bộ giao diện.

## 2. Information Architecture

4 khu vực điều hướng chính:

1. Tổng quan
- KPI cards
- Cảnh báo mới
- Workflow gần đây
- Cơ hội ưu tiên hôm nay

2. Tìm kiếm tùy chỉnh
- Thanh tìm kiếm + bộ lọc nâng cao
- Kết quả dạng card/table switch
- Lưu bộ lọc thành Smart View

3. Workflows tự động
- Danh sách workflow
- Trang tạo/sửa workflow
- Lịch sử chạy, trạng thái, log lỗi

4. Báo cáo và Insights
- Xu hướng thị trường
- Phân tích bên mời thầu/đối thủ
- Tổng hợp hiệu quả bộ lọc và workflow

## 3. Thành phần giao diện chính

1. KPI Card
- Tiêu đề
- Giá trị hiện tại
- Biến động so với kỳ trước
- CTA: "Xem chi tiết"

2. Alert Card
- Loại cảnh báo (gói thầu mới, đối thủ mới, biến động giá)
- Độ ưu tiên (cao/trung bình/thấp)
- CTA: "Thêm vào watchlist" / "Tạo workflow"

3. Workflow Card
- Tên workflow
- Trigger
- Lần chạy gần nhất
- Tỷ lệ thành công
- CTA: "Tạm dừng" / "Mở log" / "Chỉnh sửa"

4. Search Result Card
- Tên gói thầu
- Bên mời thầu
- Giá trị gói thầu
- Mức độ phù hợp với bộ lọc
- CTA: "Theo dõi" / "So sánh" / "Đánh dấu"

## 4. Luồng người dùng MVP

### Luồng A: Tạo bộ lọc cá nhân

1. Người dùng vào Tìm kiếm tùy chỉnh.
2. Nhập từ khóa + chọn địa phương + lĩnh vực + khoảng giá.
3. Xem kết quả real-time.
4. Bấm "Lưu bộ lọc" thành Smart View.
5. Chọn tần suất cảnh báo (ngày/tuần).

Tiêu chí chấp nhận:
- Lưu thành công và hiển thị trong danh sách Smart View.
- Có thể áp dụng lại bộ lọc trong 1 click.

### Luồng B: Tạo workflow cảnh báo tự động

1. Từ Alert Card hoặc Smart View, bấm "Tạo workflow".
2. Chọn trigger: có gói thầu mới phù hợp.
3. Chọn hành động: gửi thông báo trong app + email.
4. Đặt điều kiện ưu tiên.
5. Lưu và kích hoạt.

Tiêu chí chấp nhận:
- Workflow xuất hiện trong danh sách đang hoạt động.
- Có lịch sử chạy đầu tiên trong 24h (nếu có dữ liệu đầu vào).

### Luồng C: Quan sát và tối ưu workflow

1. Vào Workflows, lọc theo trạng thái.
2. Mở chi tiết workflow.
3. Xem lần chạy lỗi/thành công.
4. Điều chỉnh điều kiện trigger.
5. Lưu phiên bản mới.

Tiêu chí chấp nhận:
- Có lịch sử version workflow.
- Có thông báo nếu tỷ lệ lỗi vượt ngưỡng cấu hình.

## 5. Responsive rule

Desktop:
- Sidebar cố định + main content 12 cột.
- KPI cards 4 cột/trên 1 hàng.

Tablet:
- Sidebar collapse thành icon.
- KPI cards 2 cột.

Mobile:
- Bottom navigation 4 mục chính.
- KPI cards 1 cột, ưu tiên action quan trọng.

## 6. Empty/Error/Loading states

- Empty state: hướng dẫn tạo bộ lọc đầu tiên.
- Error state: thông điệp rõ nguyên nhân + "Thử lại".
- Loading state: skeleton cho card, tránh nhảy layout.

## 7. Design tokens đề xuất

- Màu:
  - Primary: #0B3C5D
  - Accent: #F4B400
  - Success: #1E8E3E
  - Danger: #C5221F
  - Surface: #F7F9FC
  - Text: #1F2937
- Border radius: 12px
- Spacing scale: 4, 8, 12, 16, 24, 32
- Shadow card: nhẹ, ưu tiên độ tương phản thông tin

## Checklist UX/UI

- [ ] Hoàn thành wireframe cho 4 khu vực chính: Tổng quan, Search, Workflows, Insights.
- [ ] Có đầy đủ trạng thái Empty/Error/Loading cho từng màn hình chính.
- [ ] Kiểm tra tính nhất quán CTA giữa các card và luồng thao tác.
- [ ] Xác nhận responsive ở desktop/tablet/mobile.
- [ ] Chạy review nhanh với 1-2 người dùng nội bộ trước khi lên UI high-fidelity.