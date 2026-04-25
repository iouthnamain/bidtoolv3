"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

type PackageDetailsPageClientProps = {
  externalId: string;
  sourceUrl?: string;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("vi-VN");
}

function detectDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "-";
  }
}

function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "-";
  }

  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 1) {
    return "< 1 phút";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 1) {
    return `${totalMinutes} phút`;
  }

  return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
}

function EvidenceBlock(props: { title: string; items: string[] }) {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3">
      <summary className="cursor-pointer text-sm font-medium text-amber-800">
        {props.title}
      </summary>
      <ul className="mt-2 space-y-1.5 text-xs text-amber-900">
        {props.items.map((item, index) => (
          <li
            key={`${props.title}-${index}-${item}`}
            className="rounded border border-amber-200 bg-white/70 px-2 py-1.5"
          >
            {item}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PackageDetailsPageClient({
  externalId,
  sourceUrl,
}: PackageDetailsPageClientProps) {
  const [details] = api.search.getPackageDetails.useSuspenseQuery({
    externalId,
    sourceUrl: sourceUrl?.trim() ? sourceUrl : undefined,
  });

  const showCommodityEvidence =
    details.requiredTablesEvidence.commodityCategories.length > 0 &&
    details.requiredTables.commodityCategories.length < 2;
  const showTbmtEvidence =
    details.requiredTablesEvidence.tenderNoticeContents.length > 0 &&
    details.requiredTables.tenderNoticeContents.length < 2;
  const showInvitationEvidence =
    details.requiredTablesEvidence.invitationDocuments.length > 0 &&
    details.requiredTables.invitationDocuments.length < 2;
  const showLotEvidence =
    details.requiredTablesEvidence.lotList.length > 0 &&
    details.requiredTables.lotList.length < 2;

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.14em] text-slate-500 uppercase">
              Source URL
            </p>
            <a
              href={details.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-sm font-medium break-all text-sky-700 hover:underline"
            >
              {details.sourceUrl}
            </a>
            <p className="mt-2 text-xs text-slate-500">
              Domain: {detectDomain(details.sourceUrl)} • Cập nhật:{" "}
              {formatDateTime(details.fetchedAt)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Cache: {details.extractionMeta.fromCache ? "hit" : "miss"}
              {details.extractionMeta.cacheAgeMs !== null
                ? ` • Tuổi cache: ${formatDurationMs(details.extractionMeta.cacheAgeMs)}`
                : ""}
            </p>
          </div>

          <Link
            href="/search"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Quay lại Search
          </Link>
        </div>

        <h2 className="mt-3 text-lg font-semibold text-slate-900">
          {details.pageTitle}
        </h2>
        {details.extractionMeta.sectionsDetected.length > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Sections detect được:{" "}
            {details.extractionMeta.sectionsDetected.join(" • ")}
          </p>
        ) : null}
        {details.extractionMeta.warnings.length > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold tracking-[0.12em] text-amber-800 uppercase">
              Cảnh báo extraction
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-900">
              {details.extractionMeta.warnings.map((warning, index) => (
                <li key={`warning-${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <article className="panel p-4">
          <p className="text-xs tracking-[0.14em] text-slate-500 uppercase">
            Products (heuristic)
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {details.products.length}
          </p>
        </article>
        <article className="panel p-4">
          <p className="text-xs tracking-[0.14em] text-slate-500 uppercase">
            Available links
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {details.links.length}
          </p>
        </article>
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-semibold">Danh mục hàng hóa</h3>
        {details.requiredTables.commodityCategories.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Không tìm thấy dữ liệu cho bảng Danh mục hàng hóa.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {details.requiredTables.commodityCategories.map((item, index) => (
              <li
                key={`commodity-${index}-${item}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
              >
                {item}
              </li>
            ))}
          </ul>
        )}
        {showCommodityEvidence ? (
          <EvidenceBlock
            title="Evidence thô (Danh mục hàng hóa)"
            items={details.requiredTablesEvidence.commodityCategories}
          />
        ) : null}
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-semibold">Nội dung TBMT</h3>
        {details.requiredTables.tenderNoticeContents.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Không tìm thấy dữ liệu cho bảng Nội dung TBMT.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {details.requiredTables.tenderNoticeContents.map((item, index) => (
              <li
                key={`tbmt-${index}-${item}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
              >
                {item}
              </li>
            ))}
          </ul>
        )}
        {showTbmtEvidence ? (
          <EvidenceBlock
            title="Evidence thô (Nội dung TBMT)"
            items={details.requiredTablesEvidence.tenderNoticeContents}
          />
        ) : null}
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-semibold">Hồ sơ mời thầu</h3>
        {details.requiredTables.invitationDocuments.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Không tìm thấy dữ liệu cho bảng Hồ sơ mời thầu.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 bg-slate-100 text-left text-xs tracking-wide text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2">Tên hiển thị</th>
                  <th className="px-3 py-2">Loại</th>
                  <th className="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {details.requiredTables.invitationDocuments.map((doc) => (
                  <tr key={`${doc.href}-${doc.text}`}>
                    <td className="max-w-[320px] px-3 py-2 align-top">
                      {doc.text}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {doc.kind === "file" ? "File" : "Trang"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <a
                        href={doc.href}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-sky-700 hover:underline"
                      >
                        {doc.href}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showInvitationEvidence ? (
          <EvidenceBlock
            title="Evidence thô (Hồ sơ mời thầu)"
            items={details.requiredTablesEvidence.invitationDocuments}
          />
        ) : null}
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-semibold">Danh sách các lô</h3>
        {details.requiredTables.lotList.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Không tìm thấy dữ liệu cho bảng Danh sách các lô.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {details.requiredTables.lotList.map((item, index) => (
              <li
                key={`lot-${index}-${item}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
              >
                {item}
              </li>
            ))}
          </ul>
        )}
        {showLotEvidence ? (
          <EvidenceBlock
            title="Evidence thô (Danh sách các lô)"
            items={details.requiredTablesEvidence.lotList}
          />
        ) : null}
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-semibold">Danh sách products</h3>
        {details.products.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Không tìm thấy products theo heuristic trên trang nguồn.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {details.products.map((item, index) => (
              <li
                key={`${item.source}-${item.text}-${index}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-sm text-slate-900">{item.text}</p>
                <p className="mt-1 text-[11px] tracking-[0.12em] text-slate-500 uppercase">
                  Nguồn parse: {item.source}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel p-4">
        <h3 className="text-lg font-semibold">Danh sách links khả dụng</h3>
        {details.links.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Không tìm thấy link hợp lệ trên trang nguồn.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 bg-slate-100 text-left text-xs tracking-wide text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2">Text</th>
                  <th className="px-3 py-2">Host</th>
                  <th className="px-3 py-2">Loại</th>
                  <th className="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {details.links.map((link) => (
                  <tr key={`${link.href}-${link.text}`}>
                    <td className="max-w-[320px] px-3 py-2 align-top">
                      {link.text}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {link.host}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          link.kind === "file"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : link.isExternal
                              ? "border-sky-200 bg-sky-50 text-sky-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {link.kind === "file"
                          ? "File"
                          : link.isExternal
                            ? "External"
                            : "Internal"}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-sky-700 hover:underline"
                      >
                        {link.href}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
