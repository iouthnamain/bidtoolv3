import { randomUUID } from "node:crypto";

import { expect, test as base, type Page, type Route } from "@playwright/test";
import dotenv from "dotenv";
import postgres from "postgres";

if (!process.env.CI) {
  dotenv.config({ path: ".env.local", override: true });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("Thiếu DATABASE_URL cho Material Profile E2E.");
const sql = postgres(databaseUrl, { max: 4 });

type ProfileSeed = {
  workspaceId: number;
  itemId: number;
  marker: string;
  code: string;
  sourceFingerprint: string;
  htmlUrl: string;
  htmlTitle: string;
  pdfUrl: string;
  pdfTitle: string;
  catalogUrl: string;
  itemUpdatedAt: string;
};

type SeedOptions = {
  catalogAttached?: boolean;
};

function serializedDecision(
  seed: Omit<ProfileSeed, "workspaceId" | "itemId" | "itemUpdatedAt">,
  options: SeedOptions,
) {
  return {
    materialId: null,
    acceptedFields: [
      "code",
      "unit",
      "category",
      "specText",
      "manufacturer",
      "originCountry",
      "defaultUnitPrice",
      "currency",
      "sourceUrl",
    ],
    overwriteFields: [],
    acceptedProfileFields: ["name", "imageUrl"],
    editedProfileValues: {
      name: `Máy bơm ${seed.marker}`,
      imageUrl: "https://example.com/pump.jpg",
    },
    editedValues: {
      code: seed.code,
      unit: "cái",
      category: "Máy",
      specText: "IP68 220V",
      manufacturer: "Acme",
      originCountry: "Việt Nam",
      defaultUnitPrice: "1250000",
      currency: "VND",
      sourceUrl: seed.htmlUrl,
    },
    webProposedFields: {
      sourceUrl: seed.htmlUrl,
    },
    webEvidence: [],
    webLinkResults: [
      {
        title: seed.htmlTitle,
        url: seed.htmlUrl,
        domain: "example.com",
        snippet: "Trang sản phẩm máy bơm E2E",
        query: seed.marker,
        rankScore: 0.96,
      },
      {
        title: seed.pdfTitle,
        url: seed.pdfUrl,
        domain: "example.com",
        snippet: "Catalog PDF máy bơm E2E",
        query: seed.marker,
        rankScore: 0.9,
      },
    ],
    webLinksStatus: "done",
    selectedSource: "web",
    selectedSearchCandidateKey: `web:${seed.htmlUrl}`,
    ...(options.catalogAttached ? { catalogPdfUrls: [seed.catalogUrl] } : {}),
  };
}

async function createProfileSeed(
  options: SeedOptions = {},
): Promise<ProfileSeed> {
  const marker = `E2E-MP-${randomUUID().slice(0, 8)}`;
  const code = marker;
  const sourceFingerprint = `source-${marker}`;
  const htmlUrl = `https://example.com/${marker}/product`;
  const pdfUrl = `https://example.com/${marker}/catalog.pdf`;
  const catalogUrl = `https://example.com/${marker}/approved.pdf`;
  const htmlTitle = `Nguồn HTML ${marker}`;
  const pdfTitle = `Catalog PDF ${marker}`;
  const workbook = {
    sheets: [
      {
        name: "Sheet1",
        detectedHeaderRowIndex: 1,
        activeHeaderRowIndex: 1,
        rowCount: 1,
        headers: ["Tên vật tư", "ĐVT", "Thông số"],
        rawRows: [[`Máy bơm ${marker}`, "cái", "IP68 220V"]],
        suggestedMapping: {},
        warnings: [],
        previewRows: [],
      },
    ],
  };
  const seedWithoutIds = {
    marker,
    code,
    sourceFingerprint,
    htmlUrl,
    htmlTitle,
    pdfUrl,
    pdfTitle,
    catalogUrl,
  };
  const [workspace] = await sql<{ id: number }[]>`
    insert into excel_workspaces (
      name, source_sheet_name, row_count, workbook_json
    ) values (
      ${marker}, 'Sheet1', 1, ${sql.json(workbook)}
    ) returning id
  `;
  if (!workspace) throw new Error("Không seed được workspace E2E.");
  const decision = serializedDecision(seedWithoutIds, options);
  const [item] = await sql<{ id: number; updated_at: string }[]>`
    insert into excel_workspace_items (
      workspace_id, original_row_index, source_fingerprint, product_name,
      spec_text, unit, unit_price, currency, review_decision_json, match_status
    ) values (
      ${workspace.id}, 2, ${sourceFingerprint}, ${`Máy bơm ${marker}`},
      'IP68 220V', 'cái', 1250000, 'VND', ${sql.json(decision)}, 'manual'
    ) returning id, updated_at
  `;
  if (!item) throw new Error("Không seed được dòng E2E.");
  return {
    workspaceId: workspace.id,
    itemId: item.id,
    ...seedWithoutIds,
    itemUpdatedAt: item.updated_at,
  };
}

async function cleanupProfileSeed(seed: ProfileSeed) {
  const childJobs = await sql<{ shop_scrape_job_id: string }[]>`
    select shop_scrape_job_id
    from material_profile_scrape_runs
    where workspace_id = ${seed.workspaceId} and shop_scrape_job_id is not null
  `;
  await sql`delete from excel_workspaces where id = ${seed.workspaceId}`;
  if (childJobs.length > 0) {
    await sql`
      delete from shop_scrape_jobs
      where id in ${sql(childJobs.map((job) => job.shop_scrape_job_id))}
    `;
  }
  await sql`delete from materials where code = ${seed.code}`;
  await sql`
    delete from material_catalog_documents
    where source_url in (${seed.catalogUrl}, ${seed.pdfUrl})
  `;
}

async function addSecondHtmlSource(seed: ProfileSeed) {
  const [item] = await sql<{ review_decision_json: Record<string, unknown> }[]>`
    select review_decision_json
    from excel_workspace_items
    where id = ${seed.itemId}
  `;
  if (!item) throw new Error("Không đọc được quyết định E2E.");
  const secondUrl = `${seed.htmlUrl}/alternate`;
  const secondTitle = `Nguồn HTML phụ ${seed.marker}`;
  const links: Record<string, unknown>[] = Array.isArray(
    item.review_decision_json.webLinkResults,
  )
    ? item.review_decision_json.webLinkResults.filter(
        (link): link is Record<string, unknown> =>
          link != null && typeof link === "object",
      )
    : [];
  await sql`
    update excel_workspace_items
    set review_decision_json = ${sql.json({
      ...item.review_decision_json,
      webLinkResults: [
        ...links,
        {
          title: secondTitle,
          url: secondUrl,
          domain: "example.com",
          snippet: "Trang sản phẩm phụ E2E",
          query: seed.marker,
          rankScore: 0.92,
        },
      ],
    } as postgres.JSONValue)}
    where id = ${seed.itemId}
  `;
  return { secondUrl, secondTitle };
}

async function addSecondProfileItem(seed: ProfileSeed) {
  const marker = `${seed.marker}-SECOND`;
  const htmlUrl = `${seed.htmlUrl}/second`;
  const pdfUrl = `${seed.pdfUrl}?second=1`;
  const htmlTitle = `Nguồn HTML ${marker}`;
  const pdfTitle = `Catalog PDF ${marker}`;
  const decision = serializedDecision(
    {
      marker,
      code: `${seed.code}-SECOND`,
      sourceFingerprint: `${seed.sourceFingerprint}-second`,
      htmlUrl,
      htmlTitle,
      pdfUrl,
      pdfTitle,
      catalogUrl: `${seed.catalogUrl}?second=1`,
    },
    { catalogAttached: false },
  );
  await sql`
    insert into excel_workspace_items (
      workspace_id, original_row_index, source_fingerprint, product_name,
      spec_text, unit, unit_price, currency, review_decision_json, match_status,
      sort_order
    ) values (
      ${seed.workspaceId}, 3, ${`${seed.sourceFingerprint}-second`},
      ${`Máy bơm ${marker}`}, 'IP68 220V', 'cái', 1250000, 'VND',
      ${sql.json(decision)}, 'manual', 1
    )
  `;
  return {
    name: `Máy bơm ${marker}`,
    pdfTitle,
  };
}

async function seedCurrentSearchRun(seed: ProfileSeed) {
  const decision = serializedDecision(seed, { catalogAttached: false });
  const searchJobId = randomUUID();
  const now = new Date().toISOString();
  await sql`
    insert into material_profile_search_jobs (
      id, workspace_id, status, mode, requested_item_ids, total, processed,
      found, started_at, finished_at, last_progress_at, updated_at
    ) values (
      ${searchJobId}, ${seed.workspaceId}, 'completed', 'web',
      ${sql.json([seed.itemId])}, 1, 1, 1, ${now}, ${now}, ${now}, ${now}
    )
  `;
  await sql`
    insert into material_profile_search_runs (
      job_id, workspace_id, item_id, original_row_index, mode, status,
      is_current, input_snapshot_json, web_links_status,
      ai_search_status, web_link_results_json, ai_search_candidates_json,
      recommended_candidate_key, started_at, finished_at, updated_at
    ) values (
      ${searchJobId}, ${seed.workspaceId}, ${seed.itemId}, 2, 'web',
      'completed', true, ${sql.json({ sourceFingerprint: seed.sourceFingerprint })},
      'done', 'idle', ${sql.json(decision.webLinkResults)}, ${sql.json([])},
      ${`web:${seed.htmlUrl}`}, ${now}, ${now}, ${now}
    )
  `;
}

async function openReview(page: Page, seed: ProfileSeed) {
  await page.goto(`/material-profiles/${seed.workspaceId}`);
  await page.getByRole("button", { name: /Tự tìm & điền/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Chọn dòng → tìm nguồn → thu thập → xác nhận dữ liệu",
    }),
  ).toBeVisible();
}

function scrapedProductCard(page: Page, name: string) {
  return page.getByRole("group", {
    name: `Sản phẩm ${name}`,
    exact: true,
  });
}

async function seedAwaitingProductSelection(seed: ProfileSeed) {
  const jobId = randomUUID();
  const runId = randomUUID();
  const decision = {
    ...serializedDecision(seed, { catalogAttached: false }),
    acceptedFields: [] as string[],
    acceptedProfileFields: [] as string[],
    editedValues: {},
  };
  Reflect.deleteProperty(decision, "editedProfileValues");
  const searchGeneration = JSON.stringify({
    webLinksStatus: "done",
    aiSearchStatus: "idle",
    webLinks: [
      [seed.htmlUrl, 0.96],
      [seed.pdfUrl, 0.9],
    ],
    aiCandidates: [],
  });
  const products = [
    {
      name: `Máy bơm ${seed.marker} A`,
      unit: "cái",
      category: "Máy",
      specText: "IP68 220V",
      manufacturer: "Acme",
      originCountry: "Việt Nam",
      price: 1250000,
      priceText: "1.250.000 đ",
      currency: "VND",
      sourceUrl: `${seed.htmlUrl}?sku=a`,
      imageUrl: "https://example.com/pump-a.jpg",
      sku: "A",
      model: "A",
      shopCategory: "Máy bơm",
      catalogPdfUrls: [seed.catalogUrl],
    },
    {
      name: `Máy bơm ${seed.marker} B`,
      unit: "cái",
      category: "Máy",
      specText: "IP68 220V bản B",
      manufacturer: "Acme B",
      originCountry: "Việt Nam",
      price: 1350000,
      priceText: "1.350.000 đ",
      currency: "VND",
      sourceUrl: `${seed.htmlUrl}?sku=b`,
      imageUrl: "https://example.com/pump-b.jpg",
      sku: "B",
      model: "B",
      shopCategory: "Máy bơm",
      catalogPdfUrls: [seed.catalogUrl],
    },
  ];
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await sql`
    insert into material_profile_scrape_jobs (
      id, workspace_id, status, requested_item_ids, total, needs_review,
      current_item_id, current_row_index, current_product_name, message,
      started_at, last_progress_at, expires_at, updated_at
    ) values (
      ${jobId}, ${seed.workspaceId}, 'awaiting_review', ${sql.json([seed.itemId])},
      1, 1, ${seed.itemId}, 2, ${`Máy bơm ${seed.marker}`},
      'Hãy chọn sản phẩm đã scrape.', ${now}, ${now}, ${expiresAt}, ${now}
    )
  `;
  await sql`
    insert into material_profile_scrape_runs (
      id, job_id, workspace_id, item_id, original_row_index, status,
      source_candidate_key, source_url, source_kind, source_score,
      input_snapshot_json, source_fingerprint,
      scraped_product_candidates_json, started_at, updated_at
    ) values (
      ${runId}, ${jobId}, ${seed.workspaceId}, ${seed.itemId}, 2,
      'awaiting_product_selection', ${`web:${seed.htmlUrl}`}, ${seed.htmlUrl},
      'html', 0.96,
      ${sql.json({
        productName: `Máy bơm ${seed.marker}`,
        code: seed.code,
        searchGeneration,
        materialId: null,
      })},
      ${seed.sourceFingerprint}, ${sql.json(products)}, ${now}, ${now}
    )
  `;
  await sql`
    update excel_workspace_items
    set review_decision_json = ${sql.json(decision)}, updated_at = ${seed.itemUpdatedAt}
    where id = ${seed.itemId}
  `;
  await seedCurrentSearchRun(seed);
}

const test = base.extend<
  { profileSeed: ProfileSeed },
  { databaseLifecycle: undefined }
>({
  databaseLifecycle: [
    async ({}, provide) => {
      await provide(undefined);
      await sql.end({ timeout: 5 });
    },
    { scope: "worker", auto: true },
  ],
  profileSeed: async ({ page }, provide) => {
    const seed = await createProfileSeed({ catalogAttached: true });
    await provide(seed);
    await page.close();
    await cleanupProfileSeed(seed);
  },
});

test.describe.configure({ mode: "serial" });

test("workspace exposes all four workflow steps and refreshes the clean export", async ({
  page,
  profileSeed,
}) => {
  await page.goto(`/material-profiles/${profileSeed.workspaceId}`);
  await expect(
    page.getByRole("heading", { name: "Một sheet sạch, sẵn sàng gửi đi" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Tải lên Excel/ }).click();
  await expect(
    page.getByRole("heading", { name: "Đổi file Excel" }),
  ).toBeVisible();
  await expect(page.getByText("Dữ liệu đã nhận")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    ".xlsx",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "khong-phai-excel.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Tên vật tư,ĐVT"),
  });
  await expect(
    page.getByText("Chỉ nhận file Excel định dạng .xlsx."),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Kiểm tra dữ liệu", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Sheet vật tư" }),
  ).toHaveValue("Sheet1");
  await expect(
    page.getByRole("spinbutton", { name: "Dòng tiêu đề" }),
  ).toHaveValue("1");
  await expect(page.getByText("Cột bắt buộc", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Cột bổ sung (tùy chọn)", { exact: true }),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("materialProfile.updateState") &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await saved;

  await page.getByRole("button", { name: /Tự tìm & điền/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Chọn dòng → tìm nguồn → thu thập → xác nhận dữ liệu",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Tải file chuẩn/ }).click();
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes("materialProfile.previewCleanExport") &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Làm mới kiểm tra" }).click();
  await refreshed;
  await expect(
    page.getByRole("button", { name: "Tải file Excel" }),
  ).toBeEnabled();

  await page.setViewportSize({ width: 375, height: 812 });
  const stepNavigation = page.getByRole("navigation", {
    name: "Các bước hồ sơ vật tư",
  });
  const phoneSteps = [
    { name: /Tải lên Excel/, heading: "Đổi file Excel" },
    {
      name: /Kiểm tra dữ liệu/,
      heading: "Ánh xạ cột vật tư và chỉnh ô",
    },
    {
      name: /Tự tìm & điền/,
      heading: "Chọn dòng → tìm nguồn → thu thập → xác nhận dữ liệu",
    },
    {
      name: /Tải file chuẩn/,
      heading: "Một sheet sạch, sẵn sàng gửi đi",
    },
  ];
  for (const step of phoneSteps) {
    await stepNavigation.getByRole("button", { name: step.name }).click();
    await expect(
      page.getByRole("heading", { name: step.heading }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("staged review saves all compare fields without checkboxes and stacks responsively", async ({
  page,
  profileSeed,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReview(page, profileSeed);

  await expect(
    page.getByRole("button", { name: "Scrape nguồn này" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Trích xuất AI", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Chấp nhận Tên vật tư" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Chấp nhận Ảnh sản phẩm" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Chấp nhận URL catalog" }),
  ).toHaveCount(0);

  const actionMetrics = await page.evaluate(() => {
    const findButton = (text: string) =>
      [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(text),
      );
    return (
      [
        ["Tìm nguồn web", "rgb(3, 105, 161)"],
        ["Scrape nguồn điểm cao nhất", "rgb(15, 118, 110)"],
        ["Trích xuất AI", "rgb(109, 40, 217)"],
        ["Xem trước & lưu /materials", "rgb(4, 120, 87)"],
      ] as const
    ).map(([label, expected]) => {
      const button = findButton(label);
      return {
        label,
        expected,
        color: button ? getComputedStyle(button).backgroundColor : null,
        height: button?.getBoundingClientRect().height ?? 0,
      };
    });
  });
  for (const metric of actionMetrics) {
    expect(metric.color).toBe(metric.expected);
    expect(metric.height).toBeGreaterThanOrEqual(44);
  }

  const toolbarLayout = await page.evaluate(() => {
    const bounds = (label: string) => {
      const element = document.querySelector<HTMLElement>(
        `[role="group"][aria-label="${label}"]`,
      );
      const rect = element?.getBoundingClientRect();
      return rect
        ? { top: rect.top, bottom: rect.bottom, width: rect.width }
        : null;
    };
    const actionGroup = document.querySelector<HTMLElement>(
      '[role="group"][aria-label="Thao tác hàng loạt"]',
    );
    const actionButtons = actionGroup
      ? [...actionGroup.querySelectorAll("button")].map((button) => {
          const rect = button.getBoundingClientRect();
          return { top: rect.top, width: rect.width };
        })
      : [];
    return {
      filters: bounds("Bộ lọc trạng thái"),
      selection: bounds("Chọn dòng hàng loạt"),
      actions: bounds("Thao tác hàng loạt"),
      actionButtons,
    };
  });
  expect(toolbarLayout.filters).not.toBeNull();
  expect(toolbarLayout.selection).not.toBeNull();
  expect(toolbarLayout.actions).not.toBeNull();
  expect(toolbarLayout.selection!.top).toBeGreaterThan(
    toolbarLayout.filters!.top,
  );
  expect(toolbarLayout.actions!.top).toBeGreaterThan(
    toolbarLayout.selection!.top,
  );
  expect(toolbarLayout.actionButtons).toHaveLength(4);
  expect(
    new Set(toolbarLayout.actionButtons.map((button) => button.top)).size,
  ).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 760, height: 900 });
  const stacked = await page
    .locator(".profile-review-layout")
    .evaluate((layout) => {
      const children = [...layout.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      return children.length >= 2
        ? children[1]!.getBoundingClientRect().top >
            children[0]!.getBoundingClientRect().top
        : false;
    });
  expect(stacked).toBe(true);

  await page.setViewportSize({ width: 375, height: 812 });
  const phoneActionRows = await page
    .getByRole("group", { name: "Thao tác hàng loạt" })
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().top),
    );
  expect(new Set(phoneActionRows).size).toBe(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("PDF source attaches catalog evidence without invoking AI", async ({
  page,
}) => {
  const seed = await createProfileSeed({ catalogAttached: false });
  try {
    await test.step("chọn nguồn PDF", async () => {
      await openReview(page, seed);
      await page
        .getByRole("button", { name: `Chọn nguồn web ${seed.pdfTitle}` })
        .click();
      await expect(
        page.getByRole("button", { name: "Dùng catalog PDF" }),
      ).toBeVisible();
    });
    const procedures: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/trpc/")) procedures.push(request.url());
    });
    await test.step("gắn URL catalog", async () => {
      const attached = page.waitForResponse(
        (response) =>
          response.url().includes("attachCatalogPdfSource") &&
          response.status() === 200,
      );
      await page.getByRole("button", { name: "Dùng catalog PDF" }).click();
      await attached;
      await expect(
        page.getByRole("textbox", {
          name: "URL catalog, mỗi dòng một URL PDF",
        }),
      ).toHaveValue(seed.pdfUrl);
    });
    expect(
      procedures.some((url) => url.includes("attachCatalogPdfSource")),
    ).toBe(true);
    expect(procedures.some((url) => url.includes("startSearchJob"))).toBe(
      false,
    );
    expect(procedures.some((url) => url.includes("startScrapeJob"))).toBe(
      false,
    );
  } finally {
    await page.close();
    await cleanupProfileSeed(seed);
  }
});

test("changing the selected source does not revert to the first result", async ({
  page,
}) => {
  const seed = await createProfileSeed({ catalogAttached: false });
  try {
    await seedCurrentSearchRun(seed);
    await openReview(page, seed);
    const firstSource = page.getByRole("button", {
      name: `Chọn nguồn web ${seed.htmlTitle}`,
    });
    const alternateSource = page.getByRole("button", {
      name: `Chọn nguồn web ${seed.pdfTitle}`,
    });
    await expect(firstSource).toHaveAttribute("aria-pressed", "true");

    const persisted = page.waitForResponse(
      (response) =>
        response.url().includes("updateItemReviewDecision") &&
        response.status() === 200,
    );
    await alternateSource.click();
    await persisted;
    await expect(alternateSource).toHaveAttribute("aria-pressed", "true");
    await expect(firstSource).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    await page.getByRole("button", { name: /Tự tìm & điền/ }).click();
    await expect(
      page.getByRole("button", {
        name: `Chọn nguồn web ${seed.pdfTitle}`,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const [item] = await sql<
      { review_decision_json: Record<string, unknown> }[]
    >`
      select review_decision_json
      from excel_workspace_items
      where id = ${seed.itemId}
    `;
    expect(item?.review_decision_json.selectedSearchCandidateKey).toBe(
      `web:${seed.pdfUrl}`,
    );
  } finally {
    await page.close();
    await cleanupProfileSeed(seed);
  }
});

test("changing a different material does not jump back to the deep-linked first row", async ({
  page,
}) => {
  const seed = await createProfileSeed({ catalogAttached: false });
  try {
    const second = await addSecondProfileItem(seed);
    await page.goto(`/material-profiles/${seed.workspaceId}?row=2`);
    await page.getByRole("button", { name: /Tự tìm & điền/ }).click();
    const secondRow = page.getByRole("button").filter({ hasText: second.name });
    await secondRow.click();
    await expect(secondRow).toHaveAttribute("aria-pressed", "true");

    const persisted = page.waitForResponse(
      (response) =>
        response.url().includes("updateItemReviewDecision") &&
        response.status() === 200,
    );
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().includes("materialProfile.get?") &&
        response.status() === 200,
    );
    await page
      .getByRole("button", { name: `Chọn nguồn web ${second.pdfTitle}` })
      .click();
    await persisted;
    await refreshed;
    await expect(
      page.getByRole("button", { name: `Chọn nguồn web ${second.pdfTitle}` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(secondRow).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.close();
    await cleanupProfileSeed(seed);
  }
});

test("two HTML source cards can scrape in parallel", async ({ page }) => {
  const seed = await createProfileSeed({ catalogAttached: false });
  try {
    await addSecondHtmlSource(seed);
    const pendingRoutes: Route[] = [];
    let releaseRequests: () => void = () => undefined;
    const releaseGate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    await page.route(
      "**/api/trpc/materialProfile.startScrapeJob**",
      async (route) => {
        pendingRoutes.push(route);
        await releaseGate;
        await route.abort("aborted");
      },
    );
    await openReview(page, seed);
    const scrapeButtons = page.getByRole("button", {
      name: "Scrape nguồn này",
    });
    await expect(scrapeButtons).toHaveCount(2);

    await scrapeButtons.nth(0).click();
    await expect(scrapeButtons).toHaveCount(1);
    await scrapeButtons.click();
    await expect.poll(() => pendingRoutes.length).toBe(2);

    await expect
      .poll(() =>
        page.getByRole("button", { name: /Đang chờ|Đang scrape/ }).count(),
      )
      .toBe(2);
    releaseRequests();
    await page.unrouteAll({ behavior: "wait" });
  } finally {
    await page.close();
    await cleanupProfileSeed(seed);
  }
});

test("persisted scrape retains multiple products and restores separate drafts", async ({
  page,
}) => {
  const seed = await createProfileSeed({ catalogAttached: false });
  try {
    await test.step("khôi phục picker từ job đang chờ duyệt", async () => {
      await seedAwaitingProductSelection(seed);
      await openReview(page, seed);
      await page.getByRole("button", { name: "Chọn sản phẩm" }).click();
      await expect(
        page.getByText(`Máy bơm ${seed.marker} B`, { exact: true }),
      ).toBeVisible();
    });

    await test.step("mở lại trang và chọn sản phẩm B", async () => {
      await page.reload();
      await page.getByRole("button", { name: /Tự tìm & điền/ }).click();
      await page.getByRole("button", { name: "Chọn sản phẩm" }).click();
      const productName = page.getByText(`Máy bơm ${seed.marker} B`, {
        exact: true,
      });
      const productCard = scrapedProductCard(page, `Máy bơm ${seed.marker} B`);
      await expect(productName).toBeVisible();
      const selected = page.waitForResponse(
        (response) =>
          response.url().includes("selectScrapedProduct") &&
          response.status() === 200,
      );
      await productCard
        .getByRole("button", { name: "Chọn sản phẩm này" })
        .click();
      await selected;
      await expect(
        page.getByRole("columnheader", { name: "Sau (Scrape)" }),
      ).toBeVisible();
      await expect(page.getByLabel("Sau (Scrape) Tên vật tư")).toHaveValue(
        `Máy bơm ${seed.marker} B`,
      );
      await expect(productCard).toContainText("Đang xem");
      await expect(
        page.getByText(`Máy bơm ${seed.marker} A`, { exact: true }),
      ).toBeVisible();
    });

    await test.step("giữ B, chọn A và khôi phục bản nháp riêng", async () => {
      const productA = scrapedProductCard(page, `Máy bơm ${seed.marker} A`);
      const productB = scrapedProductCard(page, `Máy bơm ${seed.marker} B`);
      const selectedA = page.waitForResponse(
        (response) =>
          response.url().includes("selectScrapedProduct") &&
          response.status() === 200,
      );
      await productA.getByRole("button", { name: "Chọn sản phẩm này" }).click();
      await selectedA;
      await expect(productA).toContainText("Đang xem");
      await expect(productB).toContainText("Đã chọn");

      const manufacturer = page.getByLabel("Sau (Scrape) Nhà sản xuất");
      await manufacturer.fill(`Nhà sản xuất A ${seed.marker}`);
      const activatedB = page.waitForResponse(
        (response) =>
          response.url().includes("activateScrapedProduct") &&
          response.status() === 200,
      );
      await productB.getByRole("button", { name: "Xem kết quả" }).click();
      await activatedB;
      await expect(productB).toContainText("Đang xem");
      await expect(productA).toContainText("Đã chọn");
      await manufacturer.fill(`Nhà sản xuất B ${seed.marker}`);
      const activatedA = page.waitForResponse(
        (response) =>
          response.url().includes("activateScrapedProduct") &&
          response.status() === 200,
      );
      await productA.getByRole("button", { name: "Xem kết quả" }).click();
      await activatedA;
      await expect(manufacturer).toHaveValue(`Nhà sản xuất A ${seed.marker}`);

      await page.reload();
      await page.getByRole("button", { name: /Tự tìm & điền/ }).click();
      await page.getByRole("button", { name: "Xem sản phẩm" }).click();
      await expect(page.getByLabel("Sau (Scrape) Nhà sản xuất")).toHaveValue(
        `Nhà sản xuất A ${seed.marker}`,
      );
    });

    await test.step("bỏ riêng sản phẩm không làm đổi sản phẩm đang xem", async () => {
      const productA = scrapedProductCard(page, `Máy bơm ${seed.marker} A`);
      const productB = scrapedProductCard(page, `Máy bơm ${seed.marker} B`);
      await productB.getByRole("button", { name: "Bỏ" }).click();
      await expect(productA).toContainText("Đang xem");
      await expect(page.getByLabel("Sau (Scrape) Nhà sản xuất")).toHaveValue(
        `Nhà sản xuất A ${seed.marker}`,
      );

      const reselectedB = page.waitForResponse(
        (response) =>
          response.url().includes("selectScrapedProduct") &&
          response.status() === 200,
      );
      await productB.getByRole("button", { name: "Chọn sản phẩm này" }).click();
      await reselectedB;
      await expect(productB).toContainText("Đang xem");
      await expect(productA).toContainText("Đã chọn");

      const reactivatedA = page.waitForResponse(
        (response) =>
          response.url().includes("activateScrapedProduct") &&
          response.status() === 200,
      );
      await productA.getByRole("button", { name: "Xem kết quả" }).click();
      await reactivatedA;
      await expect(productA).toContainText("Đang xem");
      await productA.getByRole("button", { name: "Bỏ" }).click();
      await expect(
        page.getByRole("columnheader", { name: "Sau (Scrape)" }),
      ).toBeHidden();
      await expect(productB).toContainText("Đã chọn");
    });

    await test.step("ghi kết quả scrape tách biệt khỏi AI", async () => {
      await expect
        .poll(async () => {
          const [item] = await sql<
            { review_decision_json: Record<string, unknown> }[]
          >`
            select review_decision_json
            from excel_workspace_items
            where id = ${seed.itemId}
          `;
          return Array.isArray(item?.review_decision_json.scrapeResults);
        })
        .toBe(true);
      const [item] = await sql<
        { review_decision_json: Record<string, unknown> }[]
      >`
        select review_decision_json
        from excel_workspace_items
        where id = ${seed.itemId}
      `;
      expect(item?.review_decision_json.aiSearchCandidates).toBeUndefined();
      expect(item?.review_decision_json.selectedScrapeProductKey).toBeNull();
    });
  } finally {
    await page.close();
    await cleanupProfileSeed(seed);
  }
});

test("bulk preview is editable, commits explicitly, and can be undone", async ({
  page,
  profileSeed,
}) => {
  await openReview(page, profileSeed);
  await page.getByRole("checkbox", { name: "Chọn dòng 2" }).check();
  await page
    .getByRole("button", { name: "Xem trước & lưu /materials (1)" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/material-profiles/${profileSeed.workspaceId}/save-batches/[0-9a-f-]+$`,
    ),
  );

  const include = page.getByRole("checkbox", { name: "Dùng dòng 2" });
  let updated = page.waitForResponse(
    (response) =>
      response.url().includes("updateMaterialSavePreviewRow") &&
      response.status() === 200,
  );
  await include.click();
  await updated;
  await expect(include).not.toBeChecked();
  await expect(page.getByText("Đã loại", { exact: true }).last()).toBeVisible();
  updated = page.waitForResponse(
    (response) =>
      response.url().includes("updateMaterialSavePreviewRow") &&
      response.status() === 200,
  );
  await include.click();
  await updated;
  await expect(include).toBeChecked();
  await expect(page.getByText("Tạo mới", { exact: true }).last()).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Xác nhận lưu" }).click();
  await expect(
    page.getByText("Đã hoàn tất lưu đợt này vào /materials."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hoàn tác đợt lưu" }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const [material] = await sql<{ count: number }[]>`
        select count(*)::int as count from materials
        where code = ${profileSeed.code} and deleted_at is null
      `;
      return material?.count ?? 0;
    })
    .toBe(1);

  await page.getByRole("button", { name: "Hoàn tác đợt lưu" }).click();
  await expect(page.getByText("Đã hoàn tác 1 dòng.")).toBeVisible();
  await expect
    .poll(async () => {
      const [material] = await sql<{ count: number }[]>`
        select count(*)::int as count from materials
        where code = ${profileSeed.code} and deleted_at is not null
      `;
      return material?.count ?? 0;
    })
    .toBe(1);
});
