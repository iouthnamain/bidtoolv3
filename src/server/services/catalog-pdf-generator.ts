import "server-only";

import { existsSync } from "node:fs";

import type { Browser } from "playwright";
import { launchManagedChromium } from "~/server/services/playwright-chromium-launch";

import { isServerlessRuntime } from "~/server/runtime";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-catalog-pdf-generator");

/**
 * Generates a simple one-page catalog PDF for a material from its (enriched)
 * fields, using headless Chromium's `page.pdf()`. This is the fallback used by
 * the enrichment commit flow when `generatePdfIfMissing` is set and web search
 * found no existing catalog PDF to attach.
 *
 * The browser launch mirrors the shop scraper (system Chrome on-prem, the
 * Sparticuz pack in serverless) but is kept self-contained here: each render
 * launches and closes its own browser. Catalog generation is low-volume (one
 * per committed item, only when no PDF was discovered), so a shared pool is not
 * worth the coupling.
 */

export type CatalogPdfMaterialInput = {
  code: string | null;
  name: string;
  unit: string | null;
  category: string | null;
  specText: string | null;
  manufacturer: string | null;
  originCountry: string | null;
  defaultUnitPrice: number | null;
  sourceUrl: string | null;
};

const SERVERLESS_CHROMIUM_PACK_URL =
  process.env.SERVERLESS_CHROMIUM_PACK_URL ??
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar";

function findSystemBrowserExecutable(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  // Probe the common system locations; if none exist, return undefined and let
  // Playwright fall back to its managed browser download.
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    const { chromium: playwrightCore } = await import("playwright-core");
    return playwrightCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(
        SERVERLESS_CHROMIUM_PACK_URL,
      ),
      headless: true,
    });
  }

  return launchManagedChromium(findSystemBrowserExecutable());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPrice(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return `${value.toLocaleString("vi-VN")} ₫`;
}

function buildCatalogHtml(material: CatalogPdfMaterialInput): string {
  const rows: Array<[string, string | null]> = [
    ["Mã vật tư", material.code],
    ["Nhóm", material.category],
    ["ĐVT", material.unit],
    ["Nhà sản xuất", material.manufacturer],
    ["Xuất xứ", material.originCountry],
    ["Đơn giá", formatPrice(material.defaultUnitPrice)],
    ["Nguồn", material.sourceUrl],
  ];

  const tableRows = rows
    .filter(([, value]) => value != null && value.trim().length > 0)
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value!.trim())}</td></tr>`,
    )
    .join("");

  const spec = material.specText?.trim();
  const specBlock = spec
    ? `<section class="spec"><h2>Thông số kỹ thuật</h2><p>${escapeHtml(spec).replace(/\n/g, "<br>")}</p></section>`
    : "";

  const generatedAt = new Date().toLocaleString("vi-VN");

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    color: #0f172a;
    margin: 0;
    padding: 40px 48px;
    font-size: 13px;
    line-height: 1.5;
  }
  header { border-bottom: 3px solid #6d28d9; padding-bottom: 16px; margin-bottom: 24px; }
  header .eyebrow { color: #6d28d9; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  header h1 { margin: 6px 0 0; font-size: 22px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { width: 30%; color: #475569; font-weight: 600; background: #f8fafc; }
  .spec h2 { font-size: 14px; color: #6d28d9; margin: 0 0 8px; }
  .spec p { margin: 0; white-space: pre-wrap; }
  footer { margin-top: 32px; color: #94a3b8; font-size: 10px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Phiếu thông tin vật tư</div>
    <h1>${escapeHtml(material.name.trim() || "Vật tư")}</h1>
  </header>
  <table><tbody>${tableRows}</tbody></table>
  ${specBlock}
  <footer>Tạo tự động từ dữ liệu làm giàu · ${escapeHtml(generatedAt)}</footer>
</body>
</html>`;
}

/**
 * Render and attach a generated catalog PDF for a material. Returns the PDF
 * bytes. Throws if the browser cannot be launched or rendering fails; callers
 * should treat a failure as non-fatal (the field enrichment commit is
 * independent).
 */
async function _generateCatalogPdf(
  material: CatalogPdfMaterialInput,
): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(buildCatalogHtml(material), {
        waitUntil: "load",
        timeout: 30_000,
      });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

/** Test-only: exposes the pure HTML builder so escaping/field logic can be
 * verified without launching a browser. */
export const buildCatalogHtmlForTest = buildCatalogHtml;

export const generateCatalogPdf = traceFn(log, "generateCatalogPdf", _generateCatalogPdf);
