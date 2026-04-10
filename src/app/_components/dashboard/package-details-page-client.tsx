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

export function PackageDetailsPageClient({
  externalId,
  sourceUrl,
}: PackageDetailsPageClientProps) {
  const [details] = api.search.getPackageDetails.useSuspenseQuery({
    externalId,
    sourceUrl: sourceUrl?.trim() ? sourceUrl : undefined,
  });

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Source URL</p>
            <a
              href={details.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-sm font-medium text-sky-700 hover:underline"
            >
              {details.sourceUrl}
            </a>
            <p className="mt-2 text-xs text-slate-500">
              Domain: {detectDomain(details.sourceUrl)} • Cập nhật: {formatDateTime(details.fetchedAt)}
            </p>
          </div>

          <Link
            href="/search"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Quay lại Search
          </Link>
        </div>

        <h2 className="mt-3 text-lg font-semibold text-slate-900">{details.pageTitle}</h2>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <article className="panel p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Products (heuristic)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{details.products.length}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Available links</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{details.links.length}</p>
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
              <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Tên hiển thị</th>
                  <th className="px-3 py-2">Loại</th>
                  <th className="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {details.requiredTables.invitationDocuments.map((doc) => (
                  <tr key={`${doc.href}-${doc.text}`}>
                    <td className="max-w-[320px] px-3 py-2 align-top">{doc.text}</td>
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
                <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">
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
              <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
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
                    <td className="max-w-[320px] px-3 py-2 align-top">{link.text}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{link.host}</td>
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
