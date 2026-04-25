# Plan 02 - Excel Workspace: Catalog PDF → Check → Final Review

Plan này hiện thực hoá đoạn cuối của flow trong [docs/07-excel-workspace.md](../07-excel-workspace.md):

> **create catalog PDF → check → final review**

Đoạn đầu (`excel workspace → search product → create new excel → review`) thuộc về [01-excel-workspace-edit.md](./01-excel-workspace-edit.md) và **bắt buộc xong trước**.

## Phụ thuộc

Plan 02 yêu cầu Plan 01 đã release với:

- Schema đã có đủ 5 trạng thái trong enum `excel_workspace_status` (Plan 01 đã định nghĩa nhưng chưa dùng `catalog_generated`, `checked`, `approved`).
- Cột `thvt_pdf_url` và `request_pdf_url` đã có trong `excel_workspaces` (nullable, Plan 01 để trống).
- Workspace có thể đạt trạng thái `reviewed` từ Plan 01.
- Wizard shell đã có 5 step indicator; Plan 01 disable Catalog + Final, Plan 02 thay implement.

Nếu Plan 01 chưa xong, các phase dưới đây sẽ block ở khâu schema migration (cần ALTER ENUM nếu Plan 01 chỉ định nghĩa 2 trạng thái — nên Plan 01 đã định nghĩa đủ để tránh).

## Phạm vi

In-scope (Plan 02):

- Sinh 2 PDF: **THVT** (đầy đủ 8 cột) và **Đề nghị mua** (6 cột, lọc dòng `Thực mua > 0`, có khối "Kính gửi" + đoạn căn cứ + khối ký).
- Embed font Be Vietnam Pro để tiếng Việt + ký tự `Ø` `²` không bị tofu.
- Validator service cho bước Check (auto rule + ack).
- Bước Final review + lock workspace (state `approved`).
- Export `.xlsx` 2 sheet (THVT + Đề nghị mua).
- Mở rộng state machine cho 3 trạng thái mới + transition reverse.
- Polish UI (empty states, error toast, menu icon) + test critical.

Out-of-scope (chưa làm trong v2):

- Lưu PDF lên object storage (v2 dùng `public/catalogs/`).
- Cấu hình UI cho header chính phủ / khoa (v2 hardcode "Khoa Cơ Khí Chế Tạo" + tên trường).
- Đa khoa / đa năm học song song.
- Đồng bộ ngược từ `.xlsx` chỉnh tay về workspace.

## Quyết định đã chốt liên quan Plan 02

| # | Vấn đề | Quyết định | Ảnh hưởng Plan 02 |
|---|--------|-----------|------------------|
| 1 | Phạm vi cơ sở | 1 workspace = 1 cơ sở | PDF / Excel chỉ render dữ liệu 1 cơ sở. |
| 2 | Auth | Không thêm v2 | Khối ký 4 ô trên PDF chỉ in chức danh; ai ký ghi tay. |
| 3 | Bước check | Auto-validate + ack | Cần `excel-workspace-validator` service (Phase 6). |
| 4 | Master vật tư | Để trống, user nhập | Plan 02 không liên quan; chỉ render data đã có. |

## Tổng quan phase

4 phase, ước lượng **5 ngày dev**.

| Phase | Nội dung | Ước lượng |
|-------|---------|-----------|
| 5 | Step Catalog (sinh 2 PDF) | 2 ngày |
| 6 | Step Check (validator + ack) + Final review + lock | 1 ngày |
| 7 | Excel export `.xlsx` (2 sheet) | 1 ngày |
| 8 | Polish + viết test critical | 1 ngày |

Đánh số phase tiếp nối Plan 01 để dễ tham chiếu (Plan 01 dùng phase 0-4).

## Phase 5 - Step Catalog (PDF)

Deliverables:

- `package.json` thêm:
  - `@react-pdf/renderer` (footprint nhỏ, server-side render, không cần Chromium).
- File font `public/fonts/BeVietnamPro-Regular.ttf` + `public/fonts/BeVietnamPro-Bold.ttf` + LICENSE (lấy từ Google Fonts, OFL).
- `src/server/services/catalog-pdf.ts`:
  - Component `<ThvtPdf workspace items />`:
    - Header 3 dòng (UBND TỈNH ĐỒNG NAI / TRƯỜNG CAO ĐẲNG KỸ THUẬT - CÔNG NGHỆ ĐỒNG NAI / KHOA CƠ KHÍ CHẾ TẠO) — hardcode v2.
    - Tiêu đề `BẢNG TỔNG HỢP VẬT TƯ THỰC HÀNH KHOA CƠ KHÍ` + năm học + cơ sở.
    - Bảng 8 cột theo thứ tự spec; subheader `Học kỳ I` / `Học kỳ II` merged row.
    - Khối ký 4 ô (Người lập, Khoa, Phòng vật tư, Hiệu trưởng) — chỉ chức danh + dòng kẻ trống.
  - Component `<RequestPdf workspace items />`:
    - Cùng header + khối "Kính gửi:" + đoạn căn cứ (giữ text từ file mẫu — sao chép trực tiếp 3 đoạn ngắn).
    - Bảng 6 cột: STT, Tên qui cách vật tư, ĐVT, Số lượng (= `Thực mua`), Khấu hao, % sử dụng còn lại.
    - Chỉ in dòng `qty_to_buy > 0`.
  - Embed font Be Vietnam Pro Regular + Bold qua `Font.register`.
- `excelWorkspace.generatePdfs({ id })`:
  - Yêu cầu `status = reviewed`.
  - Render 2 PDF, ghi `public/catalogs/{workspaceId}-thvt.pdf` và `-request.pdf`.
  - Update `thvt_pdf_url` + `request_pdf_url`, transition `reviewed → catalog_generated`.
  - Audit event `pdf_generated:thvt` và `pdf_generated:request`.
- UI step Catalog (replace placeholder của Plan 01):
  - 2 thẻ preview PDF (`<iframe>` hoặc `<embed>` từ blob URL).
  - Nút Download cho từng file.
  - Nút "Generate lại" → re-render (xoá file cũ, tạo lại; transition giữ nguyên `catalog_generated`).
  - Hiển thị thời điểm generate cuối từ event log.

Mở rộng `transitionState` (Plan 01 đã có khung): cho phép `reviewed → catalog_generated` và `catalog_generated → reviewed` (quay lại sửa).

Done when: 2 PDF in ra layout giống file mẫu trong `docs/sample/`, tiếng Việt OK, dấu `Ø` `²` không tofu.

## Phase 6 - Step Check + Final review + Lock

Deliverables:

- `src/server/services/excel-workspace-validator.ts`:
  - `validateForCheck(workspace, items)` → `Issue[]` với `{ severity: 'error'|'warning', code, message, itemId? }`.
  - Rules error:
    - `EMPTY_WORKSPACE`: tổng items < 1.
    - `MISSING_FIELD`: thiếu `material_name`, `unit`, hoặc `qty_total <= 0`.
    - `STOCK_OVERFLOW`: `qty_in_stock > qty_total`.
  - Rules warning:
    - `DUPLICATE_ITEM`: trùng `material_name + unit + term` → đề xuất gộp.
    - `NO_PURCHASE`: tất cả `qty_to_buy = 0`.
- Mở rộng `transitionState`:
  - `catalog_generated → checked`: chạy validator; nếu có error → reject với issue list; chỉ warning → cho qua, ghi audit `validation_passed`.
  - `checked → catalog_generated`: cho phép quay lại sửa, ghi audit `ack_revoked`.
  - `checked → approved`: từ Final step.
  - `approved → *`: reject, workspace lock.
- UI step Check (replace placeholder của Plan 01):
  - Hiển thị issue list (đỏ error, vàng warning).
  - Nút "Acknowledge & continue" disabled nếu còn error.
  - Khi bấm → transitionState.
- UI step Final:
  - Tóm tắt + 2 PDF + link Excel (Phase 7 thêm — Phase 6 tạm hiển thị "Excel sẽ có ở Phase 7").
  - Nút "Approve & lock" → `transitionState({ to: 'approved' })`.
  - Sau approve, mọi mutation bị lock; UI chuyển read-only banner "Workspace đã duyệt; tạo bản sao để sửa".
- Backend lock guard: tất cả mutation trong `excel-workspace` router check `status !== 'approved'` (đã setup khung ở Plan 01, Plan 02 mở rộng cho các trạng thái mới).

Done when: Auto-validate chạy đúng 5 rule; lock sau approve không cho sửa; transition reverse từ checked → catalog_generated mất ack đúng.

## Phase 7 - Excel export

Deliverables:

- `package.json` thêm `exceljs`.
- `src/server/services/excel-export.ts`:
  - Dùng `exceljs.stream.xlsx.WorkbookWriter`.
  - Sheet 1 đặt tên `THVT Khoa CK NH {year} ({CAMPUS})`:
    - Row 1-7: header (UBND, trường, khoa) — match đúng thứ tự 7 dòng đầu của file mẫu.
    - Row 8: column header in đậm.
    - Subheader "Học kỳ I" / "Học kỳ II" merged + bold giữa các nhóm.
    - Freeze pane row 9.
    - Width column auto-fit hoặc set cứng (`Tên qui cách vật tư` = 50, `ĐVT` = 12, các cột số = 14).
  - Sheet 2 đặt tên `De nghi mua {CAMPUS}`:
    - 6 cột, chỉ rows `qty_to_buy > 0`.
    - Khối "Kính gửi:" + đoạn căn cứ ở các row đầu (giống PDF).
    - Khối ký 4 ô ở cuối.
- `src/app/api/excel-workspace/[id]/export/route.ts` (Next route handler GET):
  - Stream `.xlsx` qua `Response` với header `Content-Disposition: attachment; filename=...`.
  - Không gắn vào tRPC vì tRPC không stream binary tốt.
- UI step Final: replace text "Excel sẽ có ở Phase 7" bằng nút "Tải Excel" → mở route handler.

Done when: Excel mở trong LibreOffice / MS Excel hiển thị đúng layout; tên sheet trùng quy ước file mẫu.

## Phase 8 - Polish + test

Deliverables:

- Empty states: list workspace trống ("Chưa có workspace nào, bắt đầu tạo mới"), search vật tư trống, no PDF yet.
- Error toast cho mọi mutation fail (dùng pattern hiện có hoặc thêm Sonner / hot-toast).
- Loading states cho generate PDF (có thể mất 5-15s với workspace lớn).
- Cài test runner `vitest` (repo chưa có) + setup minimal config.
- Test critical:
  - `excel-workspace-validator.test.ts`: 3 rule error + 2 rule warning.
  - `transition-state.test.ts`: ma trận transition hợp lệ / không hợp lệ + lock guard.
  - `catalog-pdf-tree.test.ts`: snapshot React PDF tree (không snapshot binary PDF vì không deterministic).
- Smoke manual: tạo 1 workspace, đi hết wizard 5 step, kiểm tra 2 PDF + Excel với file mẫu trong `docs/sample/`.
- Cập nhật `docs/04-mvp-roadmap.md`: chèn Phase 6 (Excel Workspace) với link đến spec + 2 plan.

Done when: Demo end-to-end mượt; CI typecheck + test xanh; QA so layout PDF với file mẫu OK.

## File mới (Plan 02)

- `src/server/services/catalog-pdf.ts`
- `src/server/services/excel-workspace-validator.ts`
- `src/server/services/excel-export.ts`
- `src/app/api/excel-workspace/[id]/export/route.ts`
- `src/app/_components/excel-workspace/step-catalog.tsx` (replace placeholder Plan 01)
- `src/app/_components/excel-workspace/step-check.tsx` (replace placeholder Plan 01)
- `src/app/_components/excel-workspace/step-final.tsx` (replace placeholder Plan 01)
- `public/fonts/BeVietnamPro-Regular.ttf`, `public/fonts/BeVietnamPro-Bold.ttf` + `public/fonts/LICENSE`
- `vitest.config.ts` (Phase 8)
- `tests/excel-workspace-validator.test.ts`
- `tests/transition-state.test.ts`
- `tests/catalog-pdf-tree.test.ts`

## File thay đổi (Plan 02)

- `src/server/api/routers/excel-workspace.ts` — bổ sung `generatePdfs`, mở rộng `transitionState` cho 3 trạng thái mới + lock guard cho mọi mutation.
- `src/app/_components/excel-workspace/wizard-shell.tsx` — bỏ disable + tooltip cho step Catalog / Final.
- `package.json` — thêm `@react-pdf/renderer`, `exceljs`, `vitest`, `@vitest/ui`.
- `docs/04-mvp-roadmap.md` — chèn Phase 6 với link spec + plan.

## Verification end-to-end (Plan 02)

Tiền điều kiện: Plan 01 đã release; có ít nhất 1 workspace ở trạng thái `reviewed` với ~10 dòng vật tư trải HK I + HK II.

1. Step Catalog → bấm "Generate PDF" → 2 PDF render xong; preview hiển thị header gov + bảng đúng; download mở được.
2. Mở `public/catalogs/{id}-thvt.pdf` so sánh với 1 trang in từ file mẫu — header và khối ký khớp.
3. Cố tình vào step Edit, đặt 1 dòng `SL còn tồn = 100` với `SL tổng hợp = 50` → quay lại Step Check → thấy error `STOCK_OVERFLOW`; nút Acknowledge bị disable. Sửa lại → error biến mất → Acknowledge OK.
4. Step Final → Approve → workspace lock; UI chuyển read-only banner; thử update item từ console → tRPC reject `WORKSPACE_LOCKED`.
5. Tải Excel → mở trong LibreOffice → 2 sheet đúng tên; số liệu khớp PDF; freeze pane đúng row 9.
6. Tạo workspace mới, không thêm dòng nào, vào thẳng step Check → thấy error `EMPTY_WORKSPACE`.
7. `bun run vitest run` → test xanh; `bun run check` → lint + typecheck xanh.

## Câu hỏi mở (Plan 02)

1. **Storage PDF lâu dài**: v2 dùng `public/catalogs/`. Nếu deploy Docker volume bị mất khi rebuild → ghi nhận; v3 chuyển object storage.
2. **Văn bản "căn cứ"** trong Đề nghị mua: v2 hardcode 3 đoạn từ file mẫu. v3 cho user edit qua settings.
3. **Đa khoa**: header hardcode "KHOA CƠ KHÍ CHẾ TẠO". Khi mở rộng, cần `school_faculties` table và header config.
4. **Test runner**: cài `vitest` ở Phase 8 — confirm có ngân sách tuần đầu hay đẩy sau.

## Estimate

- Dev: 5 ngày, 1 fullstack engineer.
- QA: 1-2 ngày sau Phase 8 (so layout PDF với file mẫu giấy).
- Buffer: 2 ngày cho font / PDF rendering edge cases (hay gặp với `@react-pdf/renderer` + tiếng Việt).
- Tổng: **~1.5-2 tuần** sau khi Plan 01 release.

Tổng cộng (Plan 01 + 02): ~3-3.5 tuần dev + QA cho toàn flow.
