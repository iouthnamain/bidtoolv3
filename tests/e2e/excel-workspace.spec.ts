import { expect, test } from "@playwright/test";

test("creates a standard workspace, imports rows, adds a row, and downloads xlsx", async ({
  page,
}) => {
  await page.goto("/excel-workspace");
  await page.waitForLoadState("networkidle");

  const name = `E2E standard workbook ${Date.now()}`;
  await page.getByLabel("Tên không gian Excel mới").fill(name);
  const createButton = page.getByRole("button", { name: "Tạo workspace" });
  await expect(createButton).toBeEnabled();
  await Promise.all([
    page.waitForURL(/\/excel-workspace\/\d+\?step=setup/),
    createButton.click(),
  ]);

  await expect(page.getByText("Cấu hình header và mẫu sheet")).toBeVisible();
  const templateCheckboxes = page.getByRole("checkbox");
  await templateCheckboxes.nth(2).uncheck();
  await templateCheckboxes.nth(3).uncheck();
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await expect(page.getByText("Đã lưu cấu hình workbook.")).toBeVisible();

  await page.getByRole("button", { name: /Nhập Excel/ }).click();
  await page
    .getByLabel("Chọn tệp Excel")
    .setInputFiles("docs/sample/khoa điện long thành.xlsx");
  await expect(page.getByText(/Đã đọc workbook/)).toBeVisible();
  await page.getByRole("button", { name: "Nhập dòng chuẩn" }).click();

  await expect(page.getByText("Dòng vật tư chuẩn")).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.waitForLoadState("networkidle");

  const addName = page.getByPlaceholder("Tên vật tư").first();
  const addUnit = page.getByPlaceholder("ĐVT").first();
  const addTotal = page.getByPlaceholder("SL tổng").first();
  const addStock = page.getByPlaceholder("SL tồn").first();
  const addButton = page.getByRole("button", { name: "Thêm dòng" });

  await addName.fill("Vật tư E2E thêm tay");
  await addUnit.fill("Cái");
  await addTotal.fill("2");
  await addStock.fill("0");
  await expect(addName).toHaveValue("Vật tư E2E thêm tay");
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(
    page.getByRole("row", { name: /Vật tư E2E thêm tay/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Xuất/ }).click();
  await expect(page.getByText("Kiểm tra và xuất workbook chuẩn")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Tải Excel" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/standard\.xlsx$/);
});
