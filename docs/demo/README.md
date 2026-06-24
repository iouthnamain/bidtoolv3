# Demo material samples

Paired XLSX files for manual testing of **Danh mục vật tư** (`/materials/import`) and **Hồ sơ vật tư** (`/material-profiles/[id]`).

## Generate files

```bash
bun run demo:samples
```

Creates:

| File | Route | Purpose |
|------|-------|---------|
| `demo-catalog-6.xlsx` | `/materials/import` | 6 catalog rows (canonical names) |
| `demo-boq-6.xlsx` | `/material-profiles/[id]` step 1 | 6 BOQ rows (tender-style wording + qty) |

Generated `.xlsx` files are gitignored; the generator script is the source of truth.

## Paired demo workflow (~10 min)

1. **Import catalog** — `Sidebar → Sản phẩm / vật tư → Nhập sheet`  
   Upload `demo-catalog-6.xlsx`. Confirm preview shows 6 rows, then import.

2. **Create material profile** — `Sidebar → Hồ sơ vật tư`  
   Enter TBMT e.g. `TBMT-DEMO-2026-001` → **Tạo hồ sơ**.

3. **Upload BOQ** — Step 1 on the profile detail page  
   Upload `demo-boq-6.xlsx`. Checklist should show 1 sheet, 6 data rows.

4. **Map & match** — Steps 2–3  
   Sheet `Vật tư`, header row 1. Mapping should auto-suggest `Tên vật tư`, `ĐVT`, etc.  
   Run **Lưu & chạy match** → expect high-confidence matches for all 6 lines against the catalog imported in step 1.

5. **Export** *(optional)* — Step 4  
   Preview BT columns → **Export local folder**.

## Row pairing

Catalog names are exact; BOQ names are abbreviated (typical tender sheet). All 6 pairs share code, unit, spec, vendor, origin, and price so auto-match works after catalog import.

See also: [material-profiles-and-materials-mvp.md](../material-profiles-and-materials-mvp.md).
