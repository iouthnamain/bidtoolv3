import { describe, expect, it } from "vitest";

import { extractEnrichmentPageText } from "./page-text-extract";

describe("extractEnrichmentPageText", () => {
  it("extracts table rows as label: value pairs", () => {
    const html = `
      <html><body>
        <table>
          <tr><th>Đường kính</th><td>90 mm</td></tr>
          <tr><th>Chiều dài</th><td>6 m</td></tr>
          <tr><th>Tiêu chuẩn</th><td>TCVN 8491</td></tr>
        </table>
      </body></html>
    `;
    const text = extractEnrichmentPageText(html);
    expect(text).toContain("Đường kính: 90 mm");
    expect(text).toContain("Chiều dài: 6 m");
    expect(text).toContain("TCVN 8491");
  });

  it("extracts definition list pairs and spec sections", () => {
    const html = `
      <html><body>
        <section id="specs"><h2>Thông số kỹ thuật</h2>
          <dl>
            <dt>Vật liệu</dt><dd>PVC</dd>
            <dt>Màu sắc</dt><dd>Xám</dd>
          </dl>
        </section>
      </body></html>
    `;
    const text = extractEnrichmentPageText(html);
    expect(text).toContain("Vật liệu: PVC");
    expect(text).toContain("Màu sắc: Xám");
    expect(text).toContain("Thông số kỹ thuật");
  });

  it("respects max length while keeping early spec rows", () => {
    const longValue = "x".repeat(500);
    const html = `
      <table>
        <tr><th>Quan trọng</th><td>${longValue}</td></tr>
      </table>
      <p>${"y".repeat(20_000)}</p>
    `;
    const text = extractEnrichmentPageText(html, 800);
    expect(text.length).toBeLessThanOrEqual(800);
    expect(text).toContain("Quan trọng:");
  });
});
