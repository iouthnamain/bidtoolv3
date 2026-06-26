import type { PageSectionNavItem } from "~/app/_components/dashboard/page-section-nav";

import type { Permission, Role } from "~/lib/permissions";
import { getSearchPathForMode } from "~/lib/search-routes";

export const searchSectionNavItems: PageSectionNavItem[] = [
  {
    href: getSearchPathForMode("package_keyword"),
    label: "Gói thầu",
    description: "Tìm theo từ khóa và bộ lọc package.",
    icon: "search",
  },
  {
    href: getSearchPathForMode("package_location"),
    label: "Theo địa phương",
    description: "Chế độ province-first trên BidWinner.",
    icon: "search",
  },
  {
    href: getSearchPathForMode("package_area_location"),
    label: "Ngành & địa phương",
    description: "Taxonomy classify public.",
    icon: "search",
  },
  {
    href: getSearchPathForMode("plan"),
    label: "KHLCNT",
    description: "Kế hoạch lựa chọn nhà thầu.",
    icon: "search",
  },
  {
    href: getSearchPathForMode("project"),
    label: "Dự án",
    description: "Dự án đầu tư phát triển.",
    icon: "search",
  },
  {
    href: "/saved-items/smart-views",
    label: "Smart Views",
    description: "Áp lại bộ lọc đã lưu hoặc tạo workflow.",
    icon: "bookmark",
  },
];

export const savedItemsSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/saved-items/smart-views",
    label: "Smart Views",
    description: "Bộ lọc đã lưu để dùng lại và tự động hóa.",
    icon: "bookmark",
  },
  {
    href: "/saved-items/watchlist",
    label: "Watchlist",
    description: "Các gói, KHLCNT và dự án cần quay lại.",
    icon: "bell",
  },
  {
    href: "/search/packages",
    label: "Tạo bộ lọc",
    description: "Quay về tìm kiếm để lưu Smart View mới.",
    icon: "search",
  },
  {
    href: "/workflows",
    label: "Tự động hóa",
    description: "Biến Smart View thành workflow cảnh báo.",
    icon: "workflow",
  },
];

export const workflowSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/workflows",
    label: "Danh sách",
    description: "Tạo, lọc, chạy thử và mở từng workflow.",
    icon: "workflow",
  },
  {
    href: "/workflows/health",
    label: "Trạng thái",
    description: "Active, paused, lỗi gần nhất và workflow chưa chạy.",
    icon: "activity",
  },
  {
    href: "/workflows/alerts",
    label: "Thông báo",
    description: "Cảnh báo gần đây sinh ra từ workflow.",
    icon: "bell",
  },
  {
    href: "/saved-items/smart-views",
    label: "Nguồn Smart View",
    description: "Quản lý bộ lọc đầu vào cho workflow.",
    icon: "bookmark",
  },
];

export const workflowDetailSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/workflows",
    label: "Danh sách",
    description: "Quay lại tất cả workflow.",
    icon: "list",
  },
  {
    href: "/workflows/{id}",
    label: "Tổng quan",
    description: "Trạng thái, lần chạy gần nhất và hành động nhanh.",
    icon: "eye",
  },
  {
    href: "/workflows/{id}/edit",
    label: "Cấu hình",
    description: "Sửa trigger, criteria và trạng thái hoạt động.",
    icon: "pencil",
  },
  {
    href: "/workflows/{id}/runs",
    label: "Lịch sử",
    description: "Log chạy, kết quả và thông điệp lỗi.",
    icon: "history",
  },
];

export const materialsSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/materials",
    label: "Danh mục",
    description: "Tìm, chọn, mở chi tiết và xóa vật tư.",
    icon: "boxes",
    tone: "sky",
  },
  {
    href: "/materials/new",
    label: "Thêm thủ công",
    description: "Tạo một vật tư chuẩn cho catalog.",
    icon: "plus",
    tone: "emerald",
  },
  {
    href: "/materials/import",
    label: "Nhập sheet",
    description: "Upload Excel hoặc dán CSV để tạo catalog hàng loạt.",
    icon: "sheet",
    tone: "amber",
  },
  {
    href: "/materials/scrape",
    label: "Quét cửa hàng",
    description: "Preview URL shop rồi nhập sản phẩm vào catalog.",
    icon: "search",
    tone: "violet",
    match: "prefix",
  },
  {
    href: "/materials/enrich",
    label: "Làm giàu",
    description: "Tìm web, bổ sung thông số và catalog PDF cho vật tư.",
    icon: "sparkles",
    tone: "rose",
  },
  {
    href: "/catalog-pdfs",
    label: "Catalog PDFs",
    description: "Thư viện tài liệu catalog gắn với vật tư.",
    icon: "file",
    tone: "slate",
  },
];

export const researchEnrichSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/research-enrich",
    label: "Nghiên cứu Excel",
    description:
      "Tải Excel, chạy job AI nghiên cứu sản phẩm, duyệt kết quả và xuất file.",
    icon: "sheet",
    tone: "violet",
    match: "exact",
  },
  {
    href: "/enrich",
    label: "Đối chiếu & điền",
    description: "Ghép catalog có sẵn và điền các ô trống trong Excel.",
    icon: "sheet",
    tone: "emerald",
  },
  {
    href: "/materials",
    label: "Danh mục vật tư",
    description: "Catalog dùng làm nguồn tham chiếu khi nghiên cứu.",
    icon: "boxes",
    tone: "slate",
  },
];

export const enrichSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/enrich",
    label: "Đối chiếu & điền",
    description: "Tải Excel thiếu trường, ghép catalog, nghiên cứu web và xuất file đã điền.",
    icon: "sheet",
    tone: "emerald",
    match: "exact",
  },
  {
    href: "/enrich/jobs",
    label: "Job nghiên cứu",
    description: "Xem và tiếp tục các job nghiên cứu web đã tạo.",
    icon: "history",
    tone: "violet",
    match: "prefix",
  },
  {
    href: "/materials",
    label: "Danh mục vật tư",
    description: "Nguồn catalog dùng để đối chiếu và điền.",
    icon: "boxes",
    tone: "slate",
  },
  {
    href: "/catalog-pdfs",
    label: "Catalog PDFs",
    description: "Thư viện tài liệu catalog gắn với vật tư.",
    icon: "file",
    tone: "violet",
  },
];

export const materialDetailSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/materials",
    label: "Danh mục",
    description: "Quay lại danh sách vật tư.",
    icon: "boxes",
    tone: "slate",
  },
  {
    href: "/materials/{id}",
    label: "Tổng quan",
    description: "Mã, giá, nguồn và trạng thái dữ liệu.",
    icon: "eye",
    tone: "sky",
  },
  {
    href: "/materials/{id}/prices",
    label: "Nguồn giá",
    description: "Nhà cung cấp, URL, giá và ghi chú.",
    icon: "link",
    tone: "emerald",
  },
  {
    href: "/materials/{id}/documents",
    label: "Catalog PDFs",
    description: "Tài liệu catalog gắn với vật tư.",
    icon: "file",
    tone: "violet",
  },
  {
    href: "/materials/{id}/edit",
    label: "Chỉnh sửa",
    description: "Thông tin catalog, nguồn giá và metadata.",
    icon: "pencil",
    tone: "amber",
  },
];

export const catalogPdfSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/catalog-pdfs/new",
    label: "Thêm tài liệu",
    description: "Tạo từ URL PDF hoặc upload tệp.",
    icon: "plus",
    tone: "emerald",
  },
  {
    href: "/catalog-pdfs",
    label: "Thư viện",
    description: "Tìm, sửa, tải bản cục bộ và gắn vật tư.",
    icon: "file",
    tone: "sky",
  },
  {
    href: "/materials",
    label: "Danh mục vật tư",
    description: "Quay lại danh sách vật tư.",
    icon: "boxes",
    tone: "slate",
  },
];

export const notificationsSectionNavItems: PageSectionNavItem[] = [
  {
    href: "#notification-list",
    label: "Hộp thông báo",
    description: "Lọc chưa đọc, chọn nhiều và dọn cảnh báo.",
    icon: "bell",
  },
  {
    href: "/workflows",
    label: "Workflow nguồn",
    description: "Kiểm tra workflow tạo ra cảnh báo.",
    icon: "workflow",
  },
  {
    href: "/saved-items/watchlist",
    label: "Watchlist",
    description: "Đối chiếu các mục đang theo dõi.",
    icon: "bookmark",
  },
  {
    href: "/dashboard",
    label: "Tổng quan",
    description: "Quay lại KPI và trạng thái hôm nay.",
    icon: "home",
  },
];

export const settingsSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/settings",
    label: "Tóm tắt",
    description: "Phiên bản, môi trường và trạng thái cập nhật.",
    icon: "activity",
  },
  {
    href: "/settings/ai",
    label: "OpenRouter",
    description: "API key và model mặc định cho chat LLM.",
    icon: "settings",
  },
  {
    href: "/settings/users",
    label: "Người dùng",
    description: "Tài khoản, quyền truy cập và trạng thái.",
    icon: "settings",
  },
  {
    href: "/settings/tenants",
    label: "Tổ chức",
    description: "Tổ chức khách hàng (tenant) và thành viên.",
    icon: "settings",
  },
  {
    href: "/settings/desktop",
    label: "Desktop",
    description: "Cấu hình server URL cho Electron.",
    icon: "monitor",
  },
  {
    href: "/settings/updates",
    label: "Cập nhật",
    description: "Áp dụng bản mới và xem ghi chú phát hành.",
    icon: "download",
  },
];

const settingsNavRules: Record<
  string,
  { roles?: readonly Role[]; permission?: Permission }
> = {
  "/settings/ai": {
    roles: ["admin", "manager"],
    permission: "settings:manage",
  },
  "/settings/users": {
    roles: ["admin", "manager"],
    permission: "users:manage",
  },
  "/settings/tenants": {
    roles: ["admin", "manager"],
    permission: "users:manage",
  },
  "/settings/desktop": {
    roles: ["admin"],
  },
  "/settings/updates": {
    roles: ["admin"],
    permission: "onprem:admin",
  },
};

export function getSettingsSectionNavItems(
  role: Role | null | undefined,
  can: (permission: Permission) => boolean,
): PageSectionNavItem[] {
  if (!role) return settingsSectionNavItems;

  return settingsSectionNavItems.filter((item) => {
    const rule = settingsNavRules[item.href];
    if (!rule) return true;
    return (
      (!rule.roles || rule.roles.includes(role)) &&
      (!rule.permission || can(rule.permission))
    );
  });
}

export const sourceDetailSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/search/packages",
    label: "Quay lại Search",
    description: "Trở về kết quả và bộ lọc đang dùng.",
    icon: "search",
  },
  {
    href: "#source-overview",
    label: "Nguồn",
    description: "URL, cache, title và cảnh báo extraction.",
    icon: "link",
  },
  {
    href: "#source-commodity",
    label: "Bảng dữ liệu",
    description: "Hàng hóa, TBMT, hồ sơ mời thầu và lô.",
    icon: "table",
  },
  {
    href: "#source-documents",
    label: "Hồ sơ",
    description: "File hoặc trang Hồ sơ mời thầu trích xuất được.",
    icon: "file",
  },
  {
    href: "#source-products",
    label: "Sản phẩm & link",
    description: "Products heuristic và danh sách link khả dụng.",
    icon: "archive",
  },
];

export const helpSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/help",
    label: "Tổng quan",
    description: "Lối tắt, bản đồ luồng và mục lục chủ đề.",
    icon: "home",
  },
  {
    href: "/help/bat-dau",
    label: "Bắt đầu",
    description: "Cài đặt, mở app và kiểm tra dashboard.",
    icon: "home",
  },
  {
    href: "/help/vai-tro",
    label: "Vai trò & quyền",
    description: "Ranh giới admin, manager, staff và customer.",
    icon: "clipboard",
  },
  {
    href: "/help/tim-kiem",
    label: "Tìm kiếm",
    description: "Nguồn BidWinner, Smart View và Watchlist.",
    icon: "search",
  },
  {
    href: "/help/import-mapping",
    label: "Nhập catalog",
    description: "Nhập Excel/CSV, preview và catalog vật tư.",
    icon: "sheet",
  },
  {
    href: "/help/doi-chieu-dien",
    label: "Đối chiếu & điền",
    description: "Ghép catalog và điền file Excel còn thiếu trường.",
    icon: "sheet",
  },
  {
    href: "/help/khac-phuc-loi",
    label: "Khắc phục lỗi",
    description: "Docker, env, migration và server local.",
    icon: "warning",
  },
];
