# Workflow 01 - Search Package, Review, Export YCKT Excel

## Goal

Turn a tender-search result into a reviewed opportunity and, after business confirmation, export a structured YCKT Excel file.

Target flow:

`search -> open link -> review -> wait confirm -> receive YCKT -> export YCKT Excel`

## Users

- Chuyên viên đấu thầu tìm gói phù hợp theo ngày.
- Quản lý kinh doanh dự án cần xác nhận tham gia/không tham gia.
- Operations user chuẩn bị file YCKT để downstream review.

## Entry Points

- `/search` - tìm kiếm và lọc gói thầu.
- `/package-details/[externalId]` - mở chi tiết gói thầu.
- `/saved-items` - quay lại gói đã lưu hoặc đang chờ xác nhận.

## Inputs

- Từ khóa, địa phương, lĩnh vực, khoảng ngân sách.
- External package id hoặc URL nguồn public.
- Thông tin gói thầu: tiêu đề, bên mời thầu, ngân sách, thời hạn, lĩnh vực.
- Tài liệu hoặc nội dung YCKT khi đã nhận được.

## Status Flow

`discovered -> reviewing -> waiting_confirmation -> yckt_received -> exported -> archived`

Meaning:

- `discovered`: gói xuất hiện từ search hoặc alert.
- `reviewing`: user đang kiểm tra fit, deadline, ngân sách, nguồn.
- `waiting_confirmation`: đã đủ thông tin sơ bộ và chờ quyết định nội bộ.
- `yckt_received`: đã nhận nội dung/tài liệu YCKT.
- `exported`: đã xuất file Excel YCKT.
- `archived`: kết thúc hoặc không tiếp tục.

## Main Steps

1. User vào `/search`, nhập keyword và bộ lọc.
2. Hệ thống trả danh sách gói thầu dạng card/table.
3. User mở một kết quả để xem chi tiết.
4. User review các thông tin chính:
   - fit theo ngành/sản phẩm
   - ngân sách
   - deadline
   - bên mời thầu
   - nguồn dữ liệu và link gốc
5. User đánh dấu watchlist hoặc lưu trạng thái `waiting_confirmation`.
6. Quản lý xác nhận tiếp tục hoặc loại bỏ.
7. Khi nhận YCKT, user upload/nhập nội dung YCKT vào package detail.
8. Hệ thống normalize các dòng YCKT thành bảng review.
9. User rà soát dòng, sửa trường còn thiếu và xác nhận export.
10. Hệ thống xuất Excel YCKT và lưu audit snapshot.

## Output

Excel YCKT gồm tối thiểu:

- `package_title`
- `external_id`
- `inviter`
- `province`
- `category`
- `budget`
- `deadline`
- `requirement_name`
- `requirement_spec`
- `unit`
- `quantity`
- `notes`
- `source_url`
- `review_status`

## Data To Persist

- Package external id/source URL.
- User review status and notes.
- Confirmation decision and timestamp.
- YCKT raw source or file reference.
- Export file name, exported timestamp, and final row snapshot.

## Acceptance Criteria

- User can move a search result into a reviewed/saved state.
- User can distinguish `waiting_confirmation` from active review.
- Export is blocked until YCKT rows pass required-field validation.
- Exported Excel preserves source package metadata and user notes.
- The package detail page shows when and by whom the export was created.

## Edge Cases

- Source link is unavailable: keep the saved metadata and show a refresh/manual update action.
- Duplicate package appears from multiple searches: merge by external id or canonical URL.
- Confirmation rejects the package: move to `archived` with reason.
- YCKT arrives as inconsistent text: allow manual row editing before export.
