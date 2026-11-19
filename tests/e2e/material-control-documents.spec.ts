import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function createProject(page: Page) {
  await page.goto("/material-control/projects/new");
  await page.getByLabel("Tên dự án").fill(`Giao nhận ${randomUUID()}`);
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  return page.getByRole("link", { name: /^Tài liệu \(/ });
}

test("uploads project evidence by category and downloads the saved file", async ({
  page,
}) => {
  await (await createProject(page)).click();

  const documents = page.getByRole("region", { name: "Tài liệu dự án" });
  await expect(documents.getByText("Chưa có tài liệu.")).toBeVisible();

  const fileInput = documents.getByLabel("Tệp tài liệu");
  const upload = documents.getByRole("button", {
    name: "Tải lên",
    exact: true,
  });
  await documents
    .getByLabel("Loại tài liệu")
    .selectOption({ label: "Giao nhận" });
  await fileInput.setInputFiles({
    name: "Tệp rỗng.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(0),
  });
  await upload.click();
  await expect(documents.getByRole("alert")).toHaveText(
    "Tệp tải lên không được để trống.",
  );

  const originalName = "Biên bản #1.txt";
  const contents = Buffer.from("Biên bản giao nhận vật tư\n");
  await fileInput.setInputFiles({
    name: originalName,
    mimeType: "text/plain",
    buffer: contents,
  });
  await upload.focus();
  await upload.press("Enter");

  await expect(documents.getByText("Đã tải tài liệu lên.")).toBeVisible();
  await expect(upload).toBeFocused();
  await expect(fileInput).toHaveValue("");
  const row = documents.getByRole("listitem").filter({ hasText: originalName });
  await expect(row).toContainText("Giao nhận");

  const downloadButton = row.getByRole("button", {
    name: `Tải xuống ${originalName}`,
  });
  await page.route(
    /\/api\/trpc\/[^?]*materialControl\.downloadDocument/,
    (route) => route.abort(),
    { times: 1 },
  );
  await downloadButton.focus();
  await downloadButton.press("Enter");
  await expect(row.getByRole("alert")).toHaveText(
    "Không tải được tệp xuống. Vui lòng thử lại.",
  );
  await expect(downloadButton).toBeFocused();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.press("Enter");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Biên bản _1.txt");
  expect(await readFile(await download.path())).toEqual(contents);
});

test("refreshes an empty list that was loading when evidence was attached", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const documentsLink = await createProject(page);
  const href = await documentsLink.getAttribute("href");
  if (!href) throw new Error("Missing project documents link.");

  let initialListFetched = false;
  let releaseInitialList = () => {};
  const initialListGate = new Promise<void>((resolve) => {
    releaseInitialList = resolve;
  });
  await page.route(
    /\/api\/trpc\/[^?]*materialControl\.listDocuments/,
    async (route) => {
      const response = await route.fetch();
      initialListFetched = true;
      await initialListGate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );

  try {
    await page.goto(href);
    await expect.poll(() => initialListFetched).toBe(true);
    const documents = page.getByRole("region", { name: "Tài liệu dự án" });
    await expect(documents.getByText("Đang tải tài liệu…")).toBeVisible();
    await documents.getByLabel("Tệp tài liệu").setInputFiles({
      name: "Ảnh giao nhận.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Kiểm thử danh sách tài liệu\n"),
    });
    await documents
      .getByRole("button", { name: "Tải lên", exact: true })
      .click();

    await expect(documents.getByRole("listitem")).toContainText(
      "Ảnh giao nhận.txt",
    );
    const box = await documents.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390);
  } finally {
    releaseInitialList();
  }
});
