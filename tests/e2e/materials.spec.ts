import { expect, test, type Page } from "@playwright/test";

async function deleteVisibleMaterials(page: Page) {
  const checkboxes = page.locator("tbody").getByLabel(/^Chọn /);
  const count = await checkboxes.count();
  if (count === 0) {
    return;
  }

  for (let index = 0; index < count; index += 1) {
    await checkboxes.nth(index).check();
  }

  await page.getByRole("button", { name: "Xóa vật tư đã chọn" }).click();
  await page.locator("dialog").getByRole("button", { name: "Xóa" }).click();
}

test("previews an uploaded materials workbook before import", async ({
  page,
}) => {
  await page.goto("/materials/import");
  await page.waitForLoadState("networkidle");

  await page
    .getByLabel("Chọn file Excel")
    .setInputFiles("docs/sample/khoa điện long thành.xlsx");

  await expect(page.getByText("Preview trước khi nhập")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Chi tiết" }),
  ).toBeVisible();
  await expect(page.locator("select").first()).toHaveValue("Sheet1");
  await expect(page.getByRole("button", { name: "Nhập Excel" })).toBeEnabled();
});

test("previews provided sample material workbooks without phantom row warnings", async ({
  page,
}) => {
  await page.goto("/materials/import");
  await page.waitForLoadState("networkidle");

  await page
    .getByLabel("Chọn file Excel")
    .setInputFiles("docs/sample/sample materials 1.xlsx");
  await expect(page.locator("select").first()).toHaveValue("Tổng hợp");
  await expect(
    page.getByText("Header dòng 1; 618 dòng dữ liệu đọc được."),
  ).toBeVisible();
  await expect(page.getByText(/hơn 5\.000 dòng/)).toHaveCount(0);

  await page
    .getByLabel("Chọn file Excel")
    .setInputFiles("docs/sample/sample materials 2.xlsx");
  await expect(page.locator("select").first()).toHaveValue("Sheet1");
  await expect(
    page.getByText("Header dòng 1; 71 dòng dữ liệu đọc được."),
  ).toBeVisible();
  await expect(page.getByText(/hơn 5\.000 dòng/)).toHaveCount(0);
});

test("material summary shows import-preview-style important fields", async ({
  page,
}) => {
  await page.goto("/materials#material-summary");
  await page.waitForLoadState("networkidle");

  const summary = page.locator("#material-summary");
  await expect(summary.getByText("Thông tin vật tư quan trọng")).toBeVisible();
  await expect(summary.getByText("Thiếu giá")).toBeVisible();
  await expect(summary.locator(":scope > #material-catalog")).toBeVisible();
  await expect(summary.getByText("Snapshot catalog")).toHaveCount(0);
  await expect(summary.getByRole("table")).toHaveCount(1);
  const catalogTable = summary.getByRole("table", {
    name: "Danh mục vật tư",
  });

  for (const header of [
    "Tên vật tư",
    "ĐVT",
    "Thông số",
    "Chi tiết",
    "NCC",
    "Xuất xứ",
    "Giá",
  ]) {
    await expect(
      catalogTable.getByRole("columnheader", { name: header, exact: true }),
    ).toBeVisible();
  }

  await expect(page.getByText("Nhập catalog vật tư hàng loạt")).toHaveCount(0);
});

test("CSV import skips duplicate material name and unit", async ({ page }) => {
  const prefix = `E2E CSV duplicate ${Date.now()}`;
  const csv = [
    "code,name,unit,category,spec_text,manufacturer,origin_country,default_unit_price,currency,source_url,default_depreciation,default_reuse_pct",
    `,${prefix},Cái,Test,Spec A,NCC,VN,12000,VND,,1,0`,
    `,${prefix},Cái,Test,Spec B,NCC,VN,13000,VND,,1,0`,
  ].join("\n");

  await page.goto("/materials/import");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nội dung CSV sản phẩm hoặc vật tư").fill(csv);
  await page.getByRole("button", { name: "Nhập CSV" }).click();

  await expect(page.getByText(/Đã nhập 1 dòng, bỏ qua 1 dòng/)).toBeVisible();

  await page.goto("/materials");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Tìm sản phẩm hoặc vật tư").fill(prefix);
  await expect(page.getByLabel(`Chọn ${prefix}`)).toHaveCount(1);

  await deleteVisibleMaterials(page);
  await expect(page.getByText(prefix)).toHaveCount(0);
});

test("manual material save shows a friendly duplicate code error", async ({
  page,
}) => {
  const code = `E2E-DUP-${Date.now()}`;
  const firstName = `${code} first`;
  const secondName = `${code} second`;

  await page.goto("/materials/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Mã vật tư").fill(code);
  await page.getByLabel("Tên vật tư").fill(firstName);
  await page.getByLabel("ĐVT").fill("Cái");
  await Promise.all([
    page.waitForURL(/\/materials\/\d+$/),
    page.getByRole("button", { name: "Lưu và mở chi tiết" }).click(),
  ]);

  await page.goto("/materials/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Mã vật tư").fill(code);
  await page.getByLabel("Tên vật tư").fill(secondName);
  await page.getByLabel("ĐVT").fill("Cái");
  await page.getByRole("button", { name: "Lưu và mở chi tiết" }).click();
  await expect(page.getByText(`Mã vật tư "${code}" đã tồn tại.`)).toBeVisible();

  await page.goto("/materials");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Tìm sản phẩm hoặc vật tư").fill(code);
  await expect(page.getByLabel(`Chọn ${firstName}`)).toHaveCount(1);
  await expect(page.getByLabel(`Chọn ${secondName}`)).toHaveCount(0);

  await deleteVisibleMaterials(page);
  await expect(page.getByText(code)).toHaveCount(0);
});

test("bulk deletes selected materials without requiring a reload", async ({
  page,
}) => {
  const prefix = `E2E material bulk delete ${Date.now()}`;
  const names = [`${prefix} A`, `${prefix} B`];

  for (const name of names) {
    await page.goto("/materials/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Tên vật tư").fill(name);
    await page.getByLabel("ĐVT").fill("Cái");
    await Promise.all([
      page.waitForURL(/\/materials\/\d+$/),
      page.getByRole("button", { name: "Lưu và mở chi tiết" }).click(),
    ]);
  }

  await page.goto("/materials");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Tìm sản phẩm hoặc vật tư").fill(prefix);

  for (const name of names) {
    await page.getByLabel(`Chọn ${name}`).check();
  }

  await expect(page.getByText("2/2")).toBeVisible();
  const deleteSelected = page.getByRole("button", {
    name: "Xóa vật tư đã chọn",
  });
  await expect(deleteSelected).toBeEnabled();
  await deleteSelected.click();
  await expect(page.getByText("Xóa 2 vật tư?")).toBeVisible();
  await page.locator("dialog").getByRole("button", { name: "Xóa" }).click();

  for (const name of names) {
    await expect(page.getByText(name)).toHaveCount(0);
  }

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Tìm sản phẩm hoặc vật tư").fill(prefix);

  for (const name of names) {
    await expect(page.getByText(name)).toHaveCount(0);
  }
});
