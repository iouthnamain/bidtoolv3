# BidTool v3

BidTool v3 là bàn điều hành hồ sơ thầu dành cho một người vận hành: tìm kiếm cơ hội trên BidWinner, chuẩn hóa danh mục vật tư, nghiên cứu dữ liệu từ web và hoàn thiện hồ sơ vật tư mà không phải ghép nhiều bảng tính rời rạc.

## Chức năng hiện có

- **Tìm kiếm gói thầu:** tìm gói thầu, KHLCNT và dự án; lưu bộ lọc, watchlist, workflow và thông báo.
- **Danh mục vật tư:** nhập Excel/CSV, CRUD, scrape shop, làm giàu dữ liệu web/AI và quản lý catalog PDF.
- **Hồ sơ vật tư:** upload BOQ, map sheet, đối chiếu danh mục, tìm tối đa 8 nguồn web cho mỗi dòng, scrape nhiều nguồn song song, giữ nhiều sản phẩm cùng bản nháp riêng, rồi chọn đúng một sản phẩm để lưu vào `/materials`.
- **Xử lý Excel:** đối chiếu đồng bộ với catalog hoặc chạy nghiên cứu web/AI theo job trước khi xuất workbook.
- **Nhiều môi trường chạy:** web Next.js, bộ cài on-prem và desktop Electron dùng chung API tRPC cùng PostgreSQL.

Giao diện sử dụng tiếng Việt (`vi-VN`). Ứng dụng hiện vận hành theo mô hình single-user cục bộ, không có bước đăng nhập hay phân quyền theo người dùng.

## Công nghệ

Next.js App Router · React 19 · tRPC · TanStack Query · Drizzle ORM · PostgreSQL · Tailwind CSS · Bun · Vitest · Playwright · Electron

Các tác vụ dài chạy qua scheduler trong tiến trình Node và được lưu trạng thái trong PostgreSQL. Docker Compose cục bộ khởi động PostgreSQL cùng SearXNG; không cần Redis hay message broker riêng.

## Tải ứng dụng Windows

- **Windows v0.1.0:** [Tải tệp cài đặt](https://github.com/iouthnamain/bidtoolv3/releases/download/v0.1.0/BidTool.v3.Setup.0.1.0.exe)
- [Xem ghi chú phát hành](https://github.com/iouthnamain/bidtoolv3/releases/tag/v0.1.0)

Bản cài hiện tại chưa ký mã nên Windows SmartScreen có thể hiển thị cảnh báo. Desktop có thể kết nối máy chủ sẵn có qua `BIDTOOL_SERVER_URL` hoặc chạy máy chủ cục bộ với `DATABASE_URL`.

## Chạy từ mã nguồn

Yêu cầu: Node.js `20+`, Bun `1.3+`, Docker Engine và Docker Compose plugin.

```bash
bun run dev:install   # lần đầu: dependencies, .env, dịch vụ Docker, migration
bun run dev:update    # sau git pull: cập nhật dependencies và migration
bun run dev:run       # chạy hằng ngày tại http://localhost:3000
```

Có thể dùng launcher tương ứng hệ điều hành: `run.ps1`, `run.bat` hoặc `run.sh`. Dữ liệu demo không được seed tự động; đặt `ENABLE_DEMO_SEED="true"` trong `.env`, sau đó chạy `bun run db:seed`.

## Lệnh thường dùng

| Lệnh                   | Mục đích                                        |
| ---------------------- | ----------------------------------------------- |
| `bun run dev`          | Chạy riêng Next.js, không kiểm tra stack cục bộ |
| `bun run check`        | Chạy ESLint và TypeScript                       |
| `bun run test`         | Chạy toàn bộ unit/integration test bằng Vitest  |
| `bun run test:e2e`     | Chạy Playwright end-to-end                      |
| `bun run build`        | Tạo production build                            |
| `bun run db:migrate`   | Áp dụng migration hiện có                       |
| `bun run db:studio`    | Mở Drizzle Studio                               |
| `bun run demo:samples` | Tạo và kiểm tra workbook mẫu vật tư             |

## Cấu trúc chính

```text
src/app/               App Router pages, route handlers và UI
src/app/_components/   Client components theo feature
src/server/api/        tRPC routers và context
src/server/services/   Nghiệp vụ, scheduler và tích hợp ngoài
src/server/db/         Drizzle schema và kết nối PostgreSQL
drizzle/               SQL migrations đã sinh
tests/                  Playwright và test fixture cấp ứng dụng
docs/                   Kiến trúc, workflow và hướng dẫn vận hành
```

Khi đổi schema: sửa `src/server/db/schema.ts`, chạy `bun run db:generate`, review SQL trong `drizzle/`, rồi chạy `bun run db:migrate`. Không gọi `drizzle-kit migrate` trực tiếp.

## Tài liệu

- [Luồng chính và kiến trúc runtime](docs/workflows.md)
- [Kiểm thử Danh mục & Hồ sơ vật tư](docs/material-profiles-and-materials-mvp.md)
- [Mục lục tài liệu](docs/README.md)
- [Phát hành, cập nhật và on-prem](docs/updates/README.md)

## Xử lý lỗi cục bộ

- Docker lỗi: kiểm tra daemon trước khi chạy nhóm lệnh `dev:*`.
- PostgreSQL chưa sẵn sàng: chờ vài giây rồi chạy lại `bun run dev:run` hoặc `bun run db:migrate`.
- `.env` lỗi hoặc thiếu biến: đối chiếu `.env.example` và giữ lại giá trị riêng của máy.
- Cổng PostgreSQL mặc định phía host là `55432`; có thể đổi bằng `POSTGRES_HOST_PORT`.
