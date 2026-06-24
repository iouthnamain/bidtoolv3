# Test guide — Vật tư & Hồ sơ vật tư

**App:** `http://localhost:3000`

Hướng dẫn kiểm thử thủ công cho danh mục vật tư và workflow **Hồ sơ vật tư** (theo Số TBMT).

---

## Demo files

Generate paired 6-row samples for import + material profile:

```bash
bun run demo:samples
```

Output in [`docs/demo/`](../demo/):

| File | Dùng ở |
|------|--------|
| `demo-catalog-6.xlsx` | `/materials/import` — nhập danh mục trước |
| `demo-boq-6.xlsx` | `/material-profiles/[id]` bước 1 — upload BOQ theo TBMT |

Gợi ý TBMT: `TBMT-DEMO-2026-001`. Chi tiết workflow: [docs/demo/README.md](../demo/README.md).

**Test nhanh (~10 phút):** `demo:samples` → import catalog → tạo hồ sơ → upload BOQ → map/match (6 dòng) → export.

---

## Routes chính

| Menu (sidebar) | Route | Việc làm |
|----------------|-------|----------|
| **Sản phẩm / vật tư → Danh mục** | `/materials` | Xem, tìm, lọc vật tư dùng chung |
| **Sản phẩm / vật tư → Thêm thủ công** | `/materials/new` | Tạo 1 vật tư |
| **Sản phẩm / vật tư → Nhập sheet** | `/materials/import` | Import Excel/CSV hàng loạt |
| **Sản phẩm / vật tư → Scrape shop** | `/materials/scrape` | Lấy sản phẩm từ shop URL |
| **Hồ sơ vật tư** | `/material-profiles` | Hub: tạo work theo TBMT |
| **Hồ sơ vật tư → chi tiết** | `/material-profiles/[id]` | 4 bước upload → map → duyệt → export |

**Thứ tự:** Nhập danh mục trước → rồi mới làm hồ sơ gói thầu.

**Không nhầm với:** **Đối chiếu Excel** (`/enrich`) = file Excel bất kỳ, tải 1 file về. **Hồ sơ vật tư** = theo TBMT, xuất folder kết quả (Excel đã điền cột BT).

---

## 1. Danh mục vật tư

### Nhập danh mục
`Sidebar → Sản phẩm / vật tư → Nhập sheet` (`/materials/import`)

1. Upload Excel hoặc dán CSV  
2. Map cột (Tên + ĐVT bắt buộc)  
3. Nhập → kiểm tra **Danh mục** có thêm dòng  

☐ Preview đúng số dòng  
☐ Import thành công, danh mục tăng  

---

### Xem & tìm
`Sidebar → Sản phẩm / vật tư → Danh mục` (`/materials`)

1. Tìm theo tên  
2. Lọc **Đã có giá** / **Chưa có giá** (và lọc nguồn giá nếu cần)  

☐ Tìm ra đúng vật tư  
☐ Lọc hoạt động  

---

### Thêm 1 vật tư
`Sidebar → Sản phẩm / vật tư → Thêm thủ công` (`/materials/new`)

1. Điền Tên + ĐVT → Lưu  
2. Thấy trong Danh mục  

☐ Lưu OK  

---

### Scrape shop *(tuỳ chọn)*
`Sidebar → Sản phẩm / vật tư → Scrape shop` (`/materials/scrape`)

1. Dán URL shop → Bắt đầu  
2. Chờ xong → chọn sản phẩm → Nhập danh mục  

☐ Tên sản phẩm đúng (không lẫn KH / khuyến mãi)  
☐ Vào được danh mục  

---

## 2. Hồ sơ vật tư

Workflow 4 bước trên `/material-profiles/[id]`:

| Bước | Tên trong UI |
|------|----------------|
| 1 | Tải lên Excel |
| 2 | Map & chỉnh sheet |
| 3 | Duyệt vật tư |
| 4 | Preview & export |

Có thể nhảy lại bước đã mở (step header) nếu work đã tiến xa hơn.

### Tạo work
`Sidebar → Hồ sơ vật tư` (`/material-profiles`)

1. Nhập **Số TBMT** → **Tạo hồ sơ**  
2. Tự chuyển sang trang chi tiết  

☐ Vào được trang 4 bước  

---

### Bước 1 — Tải lên Excel
1. **Upload file Excel** (`.xlsx`)  
2. Checklist tick đủ (work TBMT, file, số sheet, số dòng)  
3. **Tiếp tục map sheet**  

☐ Đọc được file, checklist xanh  
☐ Chuyển sang bước 2  

---

### Bước 2 — Map & chỉnh sheet
1. Chọn **Sheet vật tư** + **Header row**  
2. Map cột **Tên vật tư** (*) — các cột phụ tuỳ chọn (Mã, ĐVT, Nhóm, Thông số, NCC, Xuất xứ, Đơn giá, Nguồn)  
3. *(Tuỳ chọn)* Sửa trực tiếp cell trên grid workbook gốc  
4. **Lưu state** hoặc **Lưu & chạy match**  

☐ Không map Tên mà vẫn match được → bug  
☐ Lưu state giữ mapping/chỉnh sửa khi reload  
☐ Match tạo danh sách ở bước 3  

---

### Bước 3 — Duyệt vật tư
1. Lọc **Cần duyệt** / tìm theo tên, thông số, material id  
2. Chọn sản phẩm đúng:
   - Bấm chip **Candidates**, hoặc  
   - Nhập **material id** thủ công, hoặc  
   - Mở drawer tìm vật tư  
3. *(Tuỳ chọn)* Chọn nhiều dòng → **Bulk auto-apply ≥ 85%**, Include/Exclude export, Undo bulk apply  
4. Tick/bỏ tick cột **Export** từng dòng nếu cần  
5. **Qua preview export**  

☐ Chọn được vật tư từ danh mục  
☐ Badge trạng thái (Tự động / Cần duyệt / Thủ công / Chưa match) khớp bảng  
☐ Bulk apply + undo hoạt động  

---

### Bước 4 — Preview & export
1. Preview tự load (hoặc **Refresh preview**) — sheet vật tư có cột **BT - …**:
   - BT - Match status, Tên vật tư, Mã VT, ĐVT, Nhóm, Thông số, NCC, Xuất xứ, Đơn giá, Tiền tệ, Nguồn  
2. *(Tuỳ chọn)* Sửa cell, xóa/khôi phục dòng/cột khỏi bản export → **Lưu preview**  
3. Xem badge **Match counts** và **Workbook edit warnings**  
4. **Export local folder**  
5. **Open folder** — kiểm tra file Excel kết quả  

☐ Preview hiển thị đủ sheet (sheet vật tư đánh dấu · vật tư)  
☐ Excel export có cột BT  
☐ Folder tạo được, mở được  

---

### Hub — Mở lại / quản lý work
`/material-profiles` → bảng **Previous work**

| Thao tác | Kỳ vọng |
|----------|---------|
| **Resume** | Vào đúng work, nhảy tới bước đã mở |
| **Đổi tên** | Sửa Số TBMT |
| **Xóa** | Xóa work (confirm) |
| **Có output** | Badge khi đã export — path hiển thị ở bước 4 |

☐ Resume vào đúng chỗ đang làm dở  
☐ Trạng thái hub (Nháp → … → Đã export) cập nhật sau mỗi bước  

---

## Test nhanh (~20 phút)

1. ☐ Nhập danh mục (CSV/Excel)  
2. ☐ Tạo hồ sơ TBMT + upload Excel  
3. ☐ Map + chỉnh cell + match  
4. ☐ Duyệt vài dòng (thử chip candidate + bulk apply)  
5. ☐ Preview → chỉnh/xóa dòng nếu cần → Export + Open folder  

---

## Ghi bug

```
Trang: …
Route: …
Bước: …
Kỳ vọng: …
Thực tế: …
Screenshot/log: …
```
