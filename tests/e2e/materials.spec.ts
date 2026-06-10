import { expect, test, type Locator, type Page } from "@playwright/test";

const materialFixtureDir = "tests/fixtures/materials";

function materialCatalogRows(page: Page) {
  return page.getByRole("table", { name: "Danh mục vật tư" }).locator("tbody");
}

async function deleteVisibleMaterials(page: Page) {
  const checkboxes = materialCatalogRows(page).getByLabel(/^Chọn /);
  const count = await checkboxes.count();
  if (count === 0) {
    return;
  }

  await page.getByLabel("Chọn tất cả vật tư đang hiển thị").check();

  await page.getByRole("button", { name: "Xóa vật tư đã chọn" }).click();
  await page.locator("dialog").getByRole("button", { name: "Xóa" }).click();
}

async function importMaterialRowsViaCsv(
  page: Page,
  prefix: string,
  count: number,
) {
  const rows = Array.from({ length: count }, (_, index) => {
    const rowNumber = String(index + 1).padStart(2, "0");
    return [
      `${prefix}-${rowNumber}`,
      `${prefix} pagination row ${rowNumber}`,
      "Cái",
      "E2E",
      "",
      "",
      "",
      String(10_000 + index),
      "VND",
      "",
      "1",
      "0",
    ].join(",");
  });
  const csv = [
    "code,name,unit,category,spec_text,manufacturer,origin_country,default_unit_price,currency,source_url,default_depreciation,default_reuse_pct",
    ...rows,
  ].join("\n");

  await page.goto("/materials/import");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nội dung CSV sản phẩm hoặc vật tư").fill(csv);
  await page.getByRole("button", { name: "Nhập CSV" }).click();
  await expect(
    page.getByText(`Đã nhập ${count.toLocaleString("vi-VN")} dòng`),
  ).toBeVisible();
}

async function expectMinTouchTarget(locator: Locator, minSize = 40) {
  await expect(locator).toBeVisible();

  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(minSize);
  expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(minSize);
}

test("previews an uploaded materials workbook before import", async ({
  page,
}) => {
  await page.goto("/materials/import");
  await page.waitForLoadState("networkidle");

  await page
    .getByLabel("Chọn file Excel")
    .setInputFiles(`${materialFixtureDir}/khoa điện long thành.xlsx`);

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
    .setInputFiles(`${materialFixtureDir}/sample materials 1.xlsx`);
  await expect(page.locator("select").first()).toHaveValue("Tổng hợp");
  await expect(
    page.getByText("Header dòng 1; 618 dòng dữ liệu đọc được."),
  ).toBeVisible();
  await expect(page.getByText(/hơn 5\.000 dòng/)).toHaveCount(0);

  await page
    .getByLabel("Chọn file Excel")
    .setInputFiles(`${materialFixtureDir}/sample materials 2.xlsx`);
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
  await expect(
    summary.getByRole("heading", { name: "Quản lý sản phẩm / vật tư" }),
  ).toBeVisible();
  await expect(summary.getByText("Items / Vật tư / Sản phẩm")).toBeVisible();
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

test("material page keeps navigation compact on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/materials");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { level: 1, name: "Sản phẩm / vật tư" }),
  ).toBeVisible();

  const metrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    firstPanelTop:
      document.querySelector("#material-summary")?.getBoundingClientRect()
        .top ?? 0,
    sectionNavHeight:
      document
        .querySelector("nav[aria-label='Khu vực vật tư']")
        ?.getBoundingClientRect().height ?? 0,
  }));

  expect(metrics.bodyWidth).toBe(metrics.viewportWidth);
  expect(metrics.sectionNavHeight).toBeLessThan(140);
  expect(metrics.firstPanelTop).toBeLessThan(480);
  await expect(
    page.locator("[aria-label='Danh sách vật tư dạng thẻ']"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Mở menu điều hướng" }).click();
  const drawer = page.getByRole("dialog", {
    name: "Thanh điều hướng chính",
  });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "Sản phẩm / vật tư" }),
  ).toBeVisible();

  await drawer.getByRole("button", { name: "Đóng menu" }).click();
  await expect(drawer).toBeHidden();
});

test("material mobile controls keep touch targets usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/materials");
  await page.waitForLoadState("networkidle");

  await expectMinTouchTarget(
    page.getByRole("button", { name: "Mở menu điều hướng" }),
    44,
  );
  await page.getByRole("button", { name: "Mở menu điều hướng" }).click();
  await expectMinTouchTarget(
    page
      .getByRole("dialog", { name: "Thanh điều hướng chính" })
      .getByRole("button", { name: "Đóng menu" }),
    44,
  );
  await page
    .getByRole("dialog", { name: "Thanh điều hướng chính" })
    .getByRole("button", { name: "Đóng menu" })
    .click();

  await expectMinTouchTarget(
    page
      .getByRole("navigation", { name: "Khu vực vật tư" })
      .getByRole("link", { name: /Danh mục/i }),
    44,
  );
  await expectMinTouchTarget(
    page.locator("#material-summary").getByRole("link", {
      name: "Thêm thủ công",
    }),
    40,
  );
  await expectMinTouchTarget(
    page.locator("#material-summary").getByRole("link", {
      name: "Nhập sheet",
    }),
    40,
  );
  await expectMinTouchTarget(
    page.locator("#material-summary").getByRole("link", {
      name: "Scrape shop",
    }),
    40,
  );

  await page.goto("/materials/scrape");
  await page.waitForLoadState("networkidle");
  await expectMinTouchTarget(page.getByRole("button", { name: "Giới hạn" }));
  await expectMinTouchTarget(page.getByRole("button", { name: "Scrape hết" }));
  await expectMinTouchTarget(
    page.getByLabel("Phương thức scrape sản phẩm"),
    40,
  );
  await expectMinTouchTarget(
    page.getByLabel("Số sản phẩm tối đa cần scrape"),
    40,
  );
});

test("material import page keeps upload controls high on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/materials/import");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { level: 1, name: "Nhập sản phẩm / vật tư" }),
  ).toBeVisible();
  await expect(page.getByLabel("Chọn file Excel")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const firstPanel = document
      .querySelector(".panel")
      ?.getBoundingClientRect();
    const fileLabel = document
      .querySelector("label[for='material-import-xlsx']")
      ?.getBoundingClientRect();

    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      firstPanelTop: firstPanel?.top ?? 0,
      fileLabelHeight: fileLabel?.height ?? 0,
    };
  });

  expect(metrics.bodyWidth).toBe(metrics.viewportWidth);
  expect(metrics.firstPanelTop).toBeLessThan(420);
  expect(metrics.fileLabelHeight).toBeLessThan(160);
});

test("material catalog paginates server-backed table rows", async ({
  page,
}) => {
  const prefix = `E2E-PAGE-${Date.now()}`;
  await importMaterialRowsViaCsv(page, prefix, 30);

  try {
    await page.goto(`/materials?q=${prefix}#material-catalog`);
    await page.waitForLoadState("networkidle");

    const catalog = page.locator("#material-catalog");
    await expect(
      catalog.getByRole("table", { name: "Danh mục vật tư" }),
    ).toBeVisible();
    await expect(
      page.locator("[aria-label='Tổng vật tư theo bộ lọc']"),
    ).toHaveText("30");
    await expect(
      page.locator("[aria-label='Vật tư có giá theo bộ lọc']"),
    ).toHaveText("30");
    await expect(
      page.locator("[aria-label='Vật tư thiếu giá theo bộ lọc']"),
    ).toHaveText("0");
    await expect(page.getByLabel("Số dòng mỗi trang")).toHaveValue("50");

    const rowChecks = catalog.locator("tbody").getByLabel(/^Chọn /);
    await expect(rowChecks).toHaveCount(30);

    await page.getByLabel("Số dòng mỗi trang").selectOption("25");
    await expect(page).toHaveURL(/pageSize=25/);
    await expect(catalog.locator("tbody").getByLabel(/^Chọn /)).toHaveCount(25);
    await expect(catalog.getByText("Trang 1 /")).toBeVisible();

    const nextPage = page.getByLabel("Trang sau");
    await expect(nextPage).toBeEnabled();
    await catalog
      .locator("tbody")
      .getByLabel(/^Chọn /)
      .first()
      .check();
    await expect(catalog.getByText("1/25", { exact: true })).toBeVisible();
    await nextPage.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(catalog.getByText("Trang 2 /")).toBeVisible();
    await expect(catalog.getByText("0/25", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Trang trước")).toBeEnabled();

    await page.getByRole("button", { name: "Đặt lại" }).click();
    await expect(page).not.toHaveURL(/pageSize=25/);
    await expect(catalog.getByText("Trang 1 /")).toBeVisible();
    await expect(page.getByLabel("Số dòng mỗi trang")).toHaveValue("50");

    await page.goto(
      `/materials?q=${prefix}&pageSize=25&page=2#material-catalog`,
    );
    await expect(page.getByLabel("Số dòng mỗi trang")).toHaveValue("25");
    await expect(catalog.getByText("Trang 2 /")).toBeVisible();
  } finally {
    await page.goto(`/materials?q=${prefix}`);
    await page.waitForLoadState("networkidle");
    await deleteVisibleMaterials(page);
  }
});

test("shop scrape accepts whole max product values without saved URL shortcuts", async ({
  page,
}) => {
  await page.goto("/materials/scrape");
  await page.waitForLoadState("networkidle");

  const maxProducts = page.getByLabel("Số sản phẩm tối đa cần scrape");
  await maxProducts.fill("1500");
  await expect(maxProducts).toHaveValue("1500");
  await expect
    .poll(() =>
      maxProducts.evaluate((element) => {
        const input = element as HTMLInputElement;
        return {
          step: input.step,
          valid: input.checkValidity(),
          validationMessage: input.validationMessage,
        };
      }),
    )
    .toEqual({
      step: "1",
      valid: true,
      validationMessage: "",
    });

  await expect(
    page.getByRole("button", { name: /Cơ Điện Hải Âu|Thegioiic/i }),
  ).toHaveCount(0);
});

test("shop scrape shows progress while the server starts the job", async ({
  page,
}) => {
  let releaseStartRequest: () => void = () => undefined;
  const blockedStartRequest = new Promise<void>((resolve) => {
    releaseStartRequest = resolve;
  });

  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("material.startShopScrapeJob")) {
      await blockedStartRequest;
      await route.abort("aborted");
      return;
    }

    await route.continue();
  });

  await page.goto("/materials/scrape");
  await page.waitForLoadState("networkidle");

  await page
    .getByLabel("URL shop để scrape sản phẩm")
    .fill("https://codienhaiau.com/");
  await page.getByLabel("Số trang tối đa cần scrape").fill("2");
  await page.getByLabel("Số sản phẩm tối đa cần scrape").fill("20");
  await page.getByRole("button", { name: "Bắt đầu scrape" }).click();

  await expect(page.getByText("Đang tạo job nền trên server")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Đang khởi động" }),
  ).toBeDisabled();

  releaseStartRequest();
  await expect(page.getByText("Đang tạo job nền trên server")).toHaveCount(0);
});

test("shop scrape clears expired stored job ids", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "bidtool:shop-scrape-job:v1",
      "00000000-0000-4000-8000-000000000001",
    );
    window.localStorage.setItem(
      "bidtool:shop-import-job:v1",
      "00000000-0000-4000-8000-000000000002",
    );
  });

  await page.goto("/materials/scrape");
  await page.waitForLoadState("networkidle");

  await expect(page.getByLabel("URL shop để scrape sản phẩm")).toBeEnabled();
  await expect(page.getByText(/Job ID:/)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        scrapeJobId: window.localStorage.getItem("bidtool:shop-scrape-job:v1"),
        importJobId: window.localStorage.getItem("bidtool:shop-import-job:v1"),
      })),
    )
    .toEqual({ scrapeJobId: null, importJobId: null });
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
  await expect(
    materialCatalogRows(page).getByLabel(`Chọn ${prefix}`),
  ).toHaveCount(1);

  await deleteVisibleMaterials(page);
  await expect(materialCatalogRows(page).getByText(prefix)).toHaveCount(0);
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
  await expect(
    materialCatalogRows(page).getByLabel(`Chọn ${firstName}`),
  ).toHaveCount(1);
  await expect(
    materialCatalogRows(page).getByLabel(`Chọn ${secondName}`),
  ).toHaveCount(0);

  await deleteVisibleMaterials(page);
  await expect(materialCatalogRows(page).getByText(code)).toHaveCount(0);

  const reusedName = `${code} reused`;
  await page.goto("/materials/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Mã vật tư").fill(code);
  await page.getByLabel("Tên vật tư").fill(reusedName);
  await page.getByLabel("ĐVT").fill("Cái");
  await Promise.all([
    page.waitForURL(/\/materials\/\d+$/),
    page.getByRole("button", { name: "Lưu và mở chi tiết" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: reusedName })).toBeVisible();
  await expect(page.getByText(/Khấu hao|Sử dụng lại/)).toHaveCount(0);

  await page.goto("/materials");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Tìm sản phẩm hoặc vật tư").fill(code);
  await expect(
    materialCatalogRows(page).getByLabel(`Chọn ${reusedName}`),
  ).toHaveCount(1);
  await deleteVisibleMaterials(page);
  await expect(materialCatalogRows(page).getByText(code)).toHaveCount(0);
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
  await expect(materialCatalogRows(page).getByLabel(/^Chọn /)).toHaveCount(
    names.length,
  );

  for (const name of names) {
    await materialCatalogRows(page).getByLabel(`Chọn ${name}`).check();
  }

  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  const deleteSelected = page.getByRole("button", {
    name: "Xóa vật tư đã chọn",
  });
  await expect(deleteSelected).toBeEnabled();
  await deleteSelected.click();
  await expect(page.getByText("Xóa 2 vật tư?")).toBeVisible();
  await page.locator("dialog").getByRole("button", { name: "Xóa" }).click();

  for (const name of names) {
    await expect(materialCatalogRows(page).getByText(name)).toHaveCount(0);
  }

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Tìm sản phẩm hoặc vật tư").fill(prefix);

  for (const name of names) {
    await expect(materialCatalogRows(page).getByText(name)).toHaveCount(0);
  }
});
