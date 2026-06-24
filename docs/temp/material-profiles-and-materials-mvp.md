# Test guide — Vật tư & Hồ sơ vật tư

**App:** `http://localhost:3000`

---

## 2 trang chính

| Menu | Việc làm |
|------|----------|
| **Sản phẩm / vật tư** | Lưu danh sách sản phẩm (dùng chung) |
| **Hồ sơ vật tư** | Làm file Excel **theo từng gói thầu** (Số TBMT) |

**Thứ tự:** Nhập danh mục trước → rồi mới làm hồ sơ gói thầu.

---

## 1. Danh mục vật tư

### Nhập catalog
`Sidebar → Sản phẩm / vật tư → Nhập sheet`

1. Upload Excel hoặc dán CSV  
2. Map cột (Tên + ĐVT bắt buộc)  
3. Nhập → kiểm tra **Danh mục** có thêm dòng  

☐ Preview đúng số dòng  
☐ Import thành công, danh mục tăng  

---

### Xem & tìm
`Sidebar → Danh mục`

1. Tìm theo tên  
2. Lọc Có giá / Thiếu giá  

☐ Tìm ra đúng vật tư  
☐ Lọc hoạt động  

---

### Thêm 1 vật tư
`Thêm thủ công`

1. Điền Tên + ĐVT → Lưu  
2. Thấy trong Danh mục  

☐ Lưu OK  

---

### Scrape shop *(tuỳ chọn)*
`Scrape shop`

1. Dán URL shop → Bắt đầu  
2. Chờ xong → chọn sản phẩm → Nhập catalog  

☐ Tên sản phẩm đúng (không lẫn KH / khuyến mãi)  
☐ Vào được danh mục  

---

## 2. Hồ sơ vật tư

### Tạo work
`Sidebar → Hồ sơ vật tư`

1. Nhập **Số TBMT** → Tạo hồ sơ  

☐ Vào được trang 4 bước  

---

### Bước 1 — Upload
1. Chọn file Excel gói thầu  
2. Checklist tick đủ → **Tiếp tục**  

☐ Đọc được file  

---

### Bước 2 — Map
1. Chọn sheet + dòng header  
2. Map cột **Tên vật tư** (*)  
3. **Lưu & chạy match**  

☐ Không map Tên mà vẫn match được → bug  
☐ Có kết quả match  

---

### Bước 3 — Duyệt
1. Lọc **Cần duyệt**  
2. Chọn sản phẩm đúng (bấm chip ứng viên)  
3. **Qua preview export**  

☐ Chọn được sản phẩm catalog  
☐ Số badge khớp bảng  

---

### Bước 4 — Export
1. **Refresh preview** — thấy cột **BT - …**  
2. **Export local folder**  
3. Mở folder — có Excel + thư mục **Catalog**  

☐ Folder tạo được  
☐ Excel có cột BT  
☐ Có PDF trong Catalog (nếu vật tư đã gắn PDF)  

---

### Mở lại work cũ
Hub → **Resume** trên dòng TBMT  

☐ Vào đúng chỗ đang làm dở  

---

## Test nhanh (~20 phút)

1. ☐ Nhập catalog (CSV/Excel)  
2. ☐ Tạo hồ sơ TBMT + upload Excel  
3. ☐ Map + match  
4. ☐ Duyệt vài dòng  
5. ☐ Export + mở folder  

---

## Ghi bug

```
Trang: …
Bước: …
Kỳ vọng: …
Thực tế: …
```

---

## Không nhầm với

**Đối chiếu Excel** (`/enrich`) = file Excel bất kỳ, tải 1 file về.  
**Hồ sơ vật tư** = theo TBMT, xuất cả folder Excel + Catalog.
