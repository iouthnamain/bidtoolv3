import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("uploads project evidence by category and downloads the saved file", async ({
  page,
}) => {
  await page.goto("/material-control/projects/new");
  await page.getByLabel("Tên dự án").fill(`Giao nhận ${randomUUID()}`);
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await page.getByRole("link", { name: /^Tài liệu \(/ }).click();

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
  await upload.click();

  await expect(documents.getByText("Đã tải tài liệu lên.")).toBeVisible();
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
  await downloadButton.click();
  await expect(row.getByRole("alert")).toHaveText(
    "Không tải được tệp xuống. Vui lòng thử lại.",
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Biên bản _1.txt");
  expect(await readFile(await download.path())).toEqual(contents);
});
