import { SEARCH_ENTITY_LABELS } from "~/lib/search-modes";

import type { SearchResult } from "./search-types";

const LOCAL_REFINEMENT_LABELS = {
  keyword: "từ khóa",
  provinces: "tỉnh/thành",
  packageCategories: "lĩnh vực gói",
  classifyIds: "ngành nghề",
  budget: "ngân sách",
  publishedAt: "ngày",
  minMatchScore: "match score",
  planFields: "lĩnh vực KHLCNT",
  procurementMethods: "HTLCNT",
  projectGroups: "nhóm dự án",
} as const;

export function SourceMetaBanner({ result }: { result: SearchResult }) {
  const exactFields = result.sourceMeta.exactFields
    .map((field) => LOCAL_REFINEMENT_LABELS[field])
    .join(", ");
  const localFields = result.localRefinement.fields
    .map((field) => LOCAL_REFINEMENT_LABELS[field])
    .join(", ");

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <p>
          Nguồn public:{" "}
          <a
            href={result.sourceMeta.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-sky-700 hover:underline"
          >
            {result.sourceMeta.pageUrl}
          </a>
        </p>
        <p className="mt-1">
          Chính xác từ nguồn:{" "}
          {exactFields.length > 0 ? exactFields : "phân trang/tổng số cơ bản"}
        </p>
        <p className="mt-1">
          Tinh lọc trong app: {localFields.length > 0 ? localFields : "không có"}
        </p>
      </div>

      {result.sourceMeta.notices.map((notice) => (
        <div
          key={notice}
          className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
        >
          {notice}
        </div>
      ))}

      {result.windowTruncated ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Bộ lọc đang chạy trên {result.scannedCount.toLocaleString("vi-VN")}{" "}
          mục đầu của nguồn (giới hạn để giữ tốc độ). Nguồn còn nhiều dữ liệu
          hơn — hãy thu hẹp bộ lọc hoặc dùng tiêu chí lấy chính xác từ nguồn để
          không bỏ sót.
        </div>
      ) : null}

      {result.warning ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {result.warning}
        </div>
      ) : null}
    </div>
  );
}

export function ResultMatchSummary({ result }: { result: SearchResult }) {
  const entityLabel =
    SEARCH_ENTITY_LABELS[result.items[0]?.entityType ?? "package"];
  const count = result.visibleCount.toLocaleString("vi-VN");

  if ((result.items[0]?.entityType ?? "package") !== "package") {
    return (
      <div className="border-l-4 border-sky-400 bg-white px-4 py-3 text-sm font-medium text-sky-600">
        Tìm thấy{" "}
        <span className="text-emerald-600">
          {count} {entityLabel.toLowerCase()}
        </span>{" "}
        phù hợp với bộ lọc đang áp dụng.
      </div>
    );
  }

  return (
    <div className="border-l-4 border-sky-400 bg-white px-4 py-3 text-sm font-medium">
      <span className="text-sky-600">Tìm thấy </span>
      <span className="text-emerald-600">{count} gói thầu </span>
      <span className="text-emerald-600">chưa đóng thầu </span>
      <span className="text-sky-600">trong tên gói thầu | bên mời thầu </span>
      <span className="text-emerald-600">tại các tỉnh thành phố </span>
      <span className="text-sky-600">bạn lựa chọn</span>
    </div>
  );
}
