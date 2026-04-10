# MVP Roadmap - Dashboard Search và Workflow

## Phase 0 - Setup (1 tuần)

Mục tiêu:
- Chốt data strategy và phạm vi MVP.
- Khởi tạo cấu trúc docs, convention và naming.

Deliverables:
- Bộ docs trong thư mục docs.
- Danh sách API ưu tiên và schema data MVP.

## Phase 1 - Foundation (1-2 tuần)

Mục tiêu:
- Đặt nền tảng data + i18n + shell dashboard.

Tasks:
1. Thêm bộ route dashboard/search/workflows/insights.
2. Khởi tạo design tokens và component card cơ bản.
3. Tạo schema DB cho filters/watchlist/workflows.
4. Tạo routers tRPC khung.

Done when:
- Vào được các màn hình chính.
- Có dữ liệu mock typed end-to-end.

## Phase 2 - Search MVP (2 tuần)

Mục tiêu:
- Tìm kiếm và lưu bộ lọc cá nhân.

Tasks:
1. Build UI bộ lọc nâng cao.
2. API search + save filter + list filter.
3. Smart View list + apply 1-click.
4. Watchlist from search results.

Done when:
- User tạo, sửa, xóa bộ lọc.
- Kết quả search cập nhật đúng bộ lọc.

## Phase 3 - Workflow MVP (2 tuần)

Mục tiêu:
- Tự động cảnh báo theo trigger cơ bản.

Tasks:
1. Create/update/activate workflow.
2. Queue worker chạy trigger theo lịch cơ bản.
3. Lưu workflow_runs và hiển thị log.
4. Notification center in-app.

Done when:
- Workflow chạy được và tạo thông báo.
- Có lịch sử run thành công/thất bại.

## Phase 4 - Insights MVP (1-2 tuần)

Mục tiêu:
- Dashboard tổng hợp KPI và xu hướng cơ bản.

Tasks:
1. KPI cards: số cơ hội mới, số cảnh báo quan trọng, tỷ lệ workflow success.
2. Chart xu hướng theo ngày/tuần.
3. Bảng top bên mời thầu/đối thủ được theo dõi.

Done when:
- Dashboard tổng quan có giá trị ra quyết định.

## Phase 5 - Hardening (1 tuần)

Mục tiêu:
- Ổn định hệ thống trước pilot nội bộ.

Tasks:
1. Error handling + retry policy.
2. Performance tune truy vấn search.
3. Theo dõi metric vận hành và metric sản phẩm.
4. Viết test cho luồng critical.

Done when:
- Sẵn sàng pilot với user nội bộ.

## Backlog ưu tiên (sample)

P0:
- Search custom filters
- Save smart views
- Basic workflow trigger
- Notification center

P1:
- Workflow templates theo ngành
- Rule builder nâng cao
- Insight so sánh theo kỳ

P2:
- Multi-channel notifications
- Team collaboration
- Permission role chi tiết

## Checklist triển khai theo phase

- [ ] Phase 0 hoàn tất: phạm vi MVP, API ưu tiên, quy ước tài liệu.
- [ ] Phase 1 hoàn tất: routes chính + card components + schema khung.
- [ ] Phase 2 hoàn tất: search filters + smart views + watchlist cơ bản.
- [ ] Phase 3 hoàn tất: workflow trigger + notification center + run logs.
- [ ] Phase 4 hoàn tất: dashboard KPI + insight cơ bản.
- [ ] Phase 5 hoàn tất: hardening, test luồng critical, sẵn sàng pilot.