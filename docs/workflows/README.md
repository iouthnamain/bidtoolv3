# BidTool Workflow Library

Thư mục này mô tả các workflow vận hành chính của BidTool v3 ở dạng có thể dùng cho Product, Design, Engineering và QA.

Mỗi workflow cố gắng trả lời 5 câu hỏi:

- Ai dùng workflow này?
- Bắt đầu từ màn hình hoặc sự kiện nào?
- Dữ liệu nào đi vào và đi ra?
- Trạng thái nào cần lưu để audit?
- Khi nào được xem là hoàn tất?

## Danh sách workflow

1. [Search package -> review -> YCKT Excel export](./01-search-review-yckt-export.md)
2. [Excel workspace -> product sourcing -> enriched export](./02-excel-product-sourcing.md)
3. [Smart filter -> alert workflow automation](./03-smart-filter-alert-automation.md)
4. [Workflow monitoring -> optimize -> audit](./04-workflow-monitor-optimize.md)

## Quy ước chung

- Không tự động chọn quyết định quan trọng thay người dùng.
- Dữ liệu public/realtime chỉ lưu khi người dùng chủ động chọn, lưu bộ lọc, match sản phẩm hoặc tạo workflow.
- Mỗi workflow có trạng thái rõ ràng để có thể tiếp tục sau khi refresh hoặc quay lại sau.
- Mọi bước xuất file phải giữ được nguồn chứng cứ: URL, snippet/evidence, thời điểm lấy dữ liệu và người thao tác.
- Lỗi từ nguồn ngoài như BidWinner, SearXNG hoặc Tavily phải có hướng xử lý thủ công.
