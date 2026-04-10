# Bộ tài liệu BidTool v3

Mục tiêu của bộ tài liệu này là định nghĩa rõ sản phẩm dashboard hỗ trợ tìm kiếm gói thầu tùy chỉnh và workflow tự động, được xây dựng dựa trên bài toán mà BidWinner đang giải.

## Tài liệu chính

1. [01-product-brief.md](./01-product-brief.md)
2. [02-uxui-dashboard-workflows.md](./02-uxui-dashboard-workflows.md)
3. [03-technical-architecture.md](./03-technical-architecture.md)
4. [04-mvp-roadmap.md](./04-mvp-roadmap.md)
5. [05-data-source-strategy.md](./05-data-source-strategy.md)
6. [06-bidwinner-public-research.md](./06-bidwinner-public-research.md)

## Cách sử dụng

1. Product/BA: bắt đầu từ Product Brief để thống nhất phạm vi.
2. Designer: dùng UX/UI Spec để vẽ wireframe và prototype.
3. Engineer: dùng Technical Architecture + Roadmap để triển khai.
4. PM: quản lý backlog theo các phase trong Roadmap.

## Phạm vi hiện tại

- Ngôn ngữ: tiếng Việt.
- Định hướng giao diện: card-based, trực quan, ưu tiên dễ đọc.
- MVP: bao phủ Search + Workflow + Insights ở mức cơ bản.
- Dữ liệu: ưu tiên nguồn public realtime cho bước xem trước; chỉ lưu DB khi người dùng chủ động chọn.

## Checklist tổng hợp

- [ ] Product Brief được duyệt bởi PM/Business.
- [ ] UX/UI Spec có wireframe và flow đầy đủ.
- [ ] Technical Architecture được chốt với team engineering.
- [ ] MVP Roadmap có owner và timeline cho từng phase.
- [ ] Data Source Strategy có xác nhận pháp lý và vận hành.


# Note
## New Flow (v2 target)
1. `search -> open link -> review -> wait confirm -> receive YCKT -> export YCKT Excel`
2. `excel workspace -> search product -> create new excel (example, product country, price, ...) -> review -> create catalog PDF -> check -> final review`