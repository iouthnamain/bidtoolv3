// Run against the owned, credential-free local app described in README.md.
import assert from "node:assert/strict";
import { writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const flag = process.argv[2];
assert.ok(
  flag === "true" || flag === "false",
  "Expected legacy flag true or false",
);
const output = fileURLToPath(new URL(".", import.meta.url));
const origin = "http://127.0.0.1:31427";
const command = "BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update";
const browser = await chromium.launch({ headless: false, channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
  recordVideo: { dir: output, size: { width: 1280, height: 900 } },
});
const externalRequests = [];
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  externalRequests.push(route.request().url());
  return route.abort();
});
try {
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${origin}/settings/updates`);
  const section = page.locator("#about-version");
  await section.getByText(command, { exact: true }).waitFor();
  const status = await page.evaluate(async () =>
    (await fetch("/api/version")).json(),
  );
  assert.equal(status.surface, "onprem");
  assert.equal(status.canApplyInApp, false);
  assert.equal(status.updateAvailable, true);
  assert.equal(status.updateCommand, command);
  assert.equal(
    await section
      .getByText("Sao chép lệnh và chạy trên máy chủ hosting Docker stack.")
      .count(),
    1,
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  const requestsBeforeApply = requests.length;
  await section
    .getByRole("button", { name: "Áp dụng cập nhật", exact: true })
    .click();
  await page
    .getByText("Đã sao chép lệnh cập nhật vào clipboard.", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    command,
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  const applyMutationRequests = requests
    .slice(requestsBeforeApply)
    .filter((url) => url.includes("applyOnPremUpdate"));
  assert.deepEqual(applyMutationRequests, []);
  await section.screenshot({ path: `${output}legacy-${flag}.png` });
  const accessibility = await section.ariaSnapshot();
  const rejected = await page.evaluate(async () => {
    const response = await fetch("/api/trpc/version.applyOnPremUpdate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { version: "0.2.0" } }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(rejected.status, 501);
  assert.equal(rejected.body.error.json.data.code, "NOT_IMPLEMENTED");
  assert.match(rejected.body.error.json.message, /không được hỗ trợ/);
  // Keep stable evidence; omit Next's development stack and machine-specific path.
  delete status.manifestUrl;
  const evidence = {
    legacyFlag: flag,
    capturedAt: new Date().toISOString(),
    status,
    clipboard: command,
    updateClick: { mutationRequests: applyMutationRequests, dialogs: 0 },
    legacyMutation: {
      httpStatus: rejected.status,
      code: rejected.body.error.json.data.code,
      message: rejected.body.error.json.message,
    },
    externalBrowserRequestsBlocked: externalRequests,
    accessibility,
  };
  await writeFile(
    `${output}legacy-${flag}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await page.close();
  await context.close();
  await rename(await page.video().path(), `${output}legacy-${flag}.webm`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await context.close();
  await browser.close();
}
