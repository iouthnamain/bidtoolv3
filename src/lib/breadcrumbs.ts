/**
 * Pure breadcrumb trail builder.
 *
 * Derives a breadcrumb trail from a pathname using a static route-label
 * registry. Kept free of React/Next imports so it can be unit-tested in the
 * node environment and reused anywhere.
 *
 * Patterns use `:param` for dynamic segments (e.g. `/materials/:id`). Literal
 * routes always win over `:param` matches at the same depth, so `/materials/new`
 * resolves to "Thêm thủ công" rather than the dynamic detail label.
 */

export type Breadcrumb = {
  /** Cumulative href for this crumb (the literal path, not the pattern). */
  href: string;
  /** Display label. */
  label: string;
  /** True for the final crumb (the current page); rendered as plain text. */
  isCurrent: boolean;
  /** The matched route pattern, e.g. `/materials/:id`. */
  pattern: string;
  /** The captured dynamic segment value when the pattern has a `:param`. */
  param?: string;
};

const HOME = { href: "/dashboard", label: "Tổng quan" } as const;

/**
 * Maps known route patterns to breadcrumb labels. Labels mirror the sidebar and
 * section-nav wording so the trail stays consistent with the rest of the UI.
 */
const ROUTE_LABELS: Record<string, string> = {
  // Search
  "/search": "Tìm kiếm",
  "/search/packages": "Gói thầu",
  "/search/packages/location": "Theo địa phương",
  "/search/packages/area": "Ngành & địa phương",
  "/search/plans": "KHLCNT",
  "/search/projects": "Dự án",

  // Documents
  "/documents": "Tài liệu",

  // Materials
  "/materials": "Sản phẩm / vật tư",
  "/materials/new": "Thêm thủ công",
  "/materials/import": "Nhập catalog",
  "/materials/enrich": "Làm giàu vật tư",
  "/materials/enrich/jobs/:jobId": "Chi tiết job làm giàu",
  "/materials/scrape": "Quét cửa hàng",
  "/materials/scrape/jobs/:jobId": "Chi tiết job",
  "/materials/:id": "Chi tiết vật tư",
  "/materials/:id/prices": "Nguồn giá",
  "/materials/:id/documents": "Thư viện catalog PDF",
  "/materials/:id/edit": "Chỉnh sửa",

  // Material profiles
  "/material-profiles": "Hồ sơ vật tư",
  "/material-profiles/:id": "Chi tiết hồ sơ",

  // Enrich
  "/enrich": "Đối chiếu & điền Excel",
  "/enrich/jobs": "Job nghiên cứu",
  "/enrich/jobs/:jobId": "Chi tiết job",

  // Catalog PDFs
  "/catalog-pdfs": "Thư viện catalog PDF",
  "/catalog-pdfs/new": "Thêm tài liệu",
  "/catalog-pdfs/:id": "Chi tiết tài liệu",

  // Saved items
  "/saved-items": "Bộ lọc & theo dõi",
  "/saved-items/smart-views": "Bộ lọc thông minh",
  "/saved-items/watchlist": "Danh sách theo dõi",

  // Workflows
  "/workflows": "Quy trình",
  "/workflows/health": "Trạng thái",
  "/workflows/alerts": "Thông báo",
  "/workflows/:id": "Chi tiết workflow",
  "/workflows/:id/edit": "Cấu hình",
  "/workflows/:id/runs": "Lịch sử chạy",

  // Activity
  "/notifications": "Thông báo",

  // Help
  "/help": "Trợ giúp",
  "/help/:slug": "Chủ đề",

  // Chat
  "/chat": "Thử nghiệm chat",

  // Settings
  "/settings": "Cài đặt",
  "/settings/ai": "OpenRouter",
  "/settings/desktop": "Ứng dụng desktop",
  "/settings/updates": "Cập nhật",

  // Source detail pages (reached from search results)
  "/package-details/:externalId": "Chi tiết gói thầu",
  "/plan-details/:externalId": "Chi tiết KHLCNT",
  "/project-details/:externalId": "Chi tiết dự án",
};

const TEMPLATES = Object.keys(ROUTE_LABELS).map((pattern) => ({
  pattern,
  segments: pattern.split("/").filter(Boolean),
}));

function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/)[0] ?? "";
  if (pathOnly === "" || pathOnly === "/") {
    return "/";
  }
  return pathOnly.replace(/\/+$/, "") || "/";
}

function humanizeSegment(segment: string): string {
  if (/^\d+$/.test(segment)) {
    return "Chi tiết";
  }
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function matchPrefix(
  prefixSegments: string[],
): { pattern: string; param?: string } | null {
  // Literal routes take precedence over `:param` patterns at the same depth.
  const literal = `/${prefixSegments.join("/")}`;
  if (ROUTE_LABELS[literal] !== undefined) {
    return { pattern: literal };
  }

  for (const tpl of TEMPLATES) {
    if (tpl.segments.length !== prefixSegments.length) {
      continue;
    }

    let param: string | undefined;
    let matches = true;
    for (let i = 0; i < tpl.segments.length; i++) {
      const templateSeg = tpl.segments[i]!;
      const actualSeg = prefixSegments[i]!;
      if (templateSeg.startsWith(":")) {
        param = actualSeg;
        continue;
      }
      if (templateSeg !== actualSeg) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return { pattern: tpl.pattern, param };
    }
  }

  return null;
}

/**
 * Builds the breadcrumb trail for a pathname.
 *
 * Returns an empty array for the dashboard root (and unknown top-level routes)
 * so callers can hide the breadcrumb bar when there is nothing meaningful to
 * show. Otherwise the trail is prefixed with a "Tổng quan" home crumb and the
 * final crumb is flagged `isCurrent`.
 */
export function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  const path = normalizePathname(pathname);
  if (path === "/" || path === "/dashboard") {
    return [];
  }

  const segments = path.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [];

  for (let depth = 1; depth <= segments.length; depth++) {
    const prefix = segments.slice(0, depth);
    const match = matchPrefix(prefix);
    if (!match) {
      continue;
    }

    crumbs.push({
      href: `/${prefix.join("/")}`,
      label: ROUTE_LABELS[match.pattern]!,
      isCurrent: false,
      pattern: match.pattern,
      param: match.param,
    });
  }

  // Ensure the current page is always represented, even if its leaf segment is
  // not in the registry — fall back to a humanized label.
  const fullHref = `/${segments.join("/")}`;
  const last = crumbs[crumbs.length - 1];
  if (last?.href !== fullHref) {
    crumbs.push({
      href: fullHref,
      label: humanizeSegment(segments[segments.length - 1]!),
      isCurrent: false,
      pattern: fullHref,
    });
  }

  if (crumbs.length === 0) {
    return [];
  }

  crumbs[crumbs.length - 1]!.isCurrent = true;

  return [
    {
      href: HOME.href,
      label: HOME.label,
      isCurrent: false,
      pattern: "/dashboard",
    },
    ...crumbs,
  ];
}
