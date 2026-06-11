import type { PageSectionNavItem } from "~/app/_components/dashboard/page-section-nav";

export const searchSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/search#search-modes",
    label: "Chế độ nguồn",
    description: "Gói thầu, tỉnh, ngành nghề, KHLCNT hoặc dự án.",
    icon: "search",
  },
  {
    href: "/search#search-filters",
    label: "Bộ lọc",
    description: "Từ khóa, địa phương, ngân sách, ngày và match score.",
    icon: "sliders",
  },
  {
    href: "/search#search-results",
    label: "Kết quả",
    description: "Phân trang, lưu dòng chọn và mở detail nguồn.",
    icon: "table",
  },
  {
    href: "/saved-items#smart-views",
    label: "Smart Views",
    description: "Áp lại bộ lọc đã lưu hoặc tạo workflow.",
    icon: "bookmark",
  },
];

export const savedItemsSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/saved-items#smart-views",
    label: "Smart Views",
    description: "Bộ lọc đã lưu để dùng lại và tự động hóa.",
    icon: "bookmark",
  },
  {
    href: "/saved-items#watchlist",
    label: "Watchlist",
    description: "Các gói, KHLCNT và dự án cần quay lại.",
    icon: "bell",
  },
  {
    href: "/search",
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
    href: "/workflows#workflow-list",
    label: "Danh sách",
    description: "Tạo, lọc, chạy thử và mở từng workflow.",
    icon: "workflow",
  },
  {
    href: "/workflows#workflow-health",
    label: "Trạng thái",
    description: "Active, paused, lỗi gần nhất và workflow chưa chạy.",
    icon: "activity",
  },
  {
    href: "/workflows#workflow-notifications",
    label: "Thông báo",
    description: "Cảnh báo gần đây sinh ra từ workflow.",
    icon: "bell",
  },
  {
    href: "/saved-items#smart-views",
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
    href: "#workflow-overview",
    label: "Tổng quan",
    description: "Trạng thái, lần chạy gần nhất và hành động nhanh.",
    icon: "eye",
  },
  {
    href: "#workflow-edit",
    label: "Cấu hình",
    description: "Sửa trigger, criteria và trạng thái hoạt động.",
    icon: "pencil",
  },
  {
    href: "#workflow-runs",
    label: "Lịch sử",
    description: "Log chạy, kết quả và thông điệp lỗi.",
    icon: "history",
  },
];

export const materialsSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/materials#material-summary",
    label: "Tổng quan",
    description: "Số vật tư, đơn giá, nguồn và category.",
    icon: "bar-chart",
    tone: "sky",
  },
  {
    href: "/materials#material-catalog",
    label: "Danh mục",
    description: "Tìm, chọn, mở chi tiết và xóa vật tư.",
    icon: "boxes",
    tone: "slate",
  },
  {
    href: "/materials/new",
    label: "Thêm thủ công",
    description: "Tạo một vật tư chuẩn cho catalog.",
    icon: "plus",
    tone: "emerald",
  },
  {
    href: "/materials/scrape",
    label: "Scrape shop",
    description: "Preview URL shop rồi nhập sản phẩm vào catalog.",
    icon: "search",
    tone: "violet",
  },
  {
    href: "/materials/import",
    label: "Import & Mapping",
    description: "Upload Excel hoặc dán CSV để nhập và map catalog.",
    icon: "sheet",
    tone: "amber",
  },
  {
    href: "/materials/import",
    label: "Nhập hàng loạt",
    description: "Upload Excel hoặc dán CSV.",
    icon: "upload",
    tone: "rose",
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
    href: "#material-overview",
    label: "Tổng quan",
    description: "Mã, giá, nguồn và trạng thái dữ liệu.",
    icon: "eye",
    tone: "sky",
  },
  {
    href: "#material-prices",
    label: "Nguồn giá",
    description: "Nhà cung cấp, URL, giá và ghi chú.",
    icon: "link",
    tone: "emerald",
  },
  {
    href: "#material-documents",
    label: "Catalog PDFs",
    description: "Tài liệu catalog gắn với vật tư.",
    icon: "file",
    tone: "violet",
  },
  {
    href: "#material-edit",
    label: "Chỉnh sửa",
    description: "Thông tin catalog, nguồn giá và metadata.",
    icon: "pencil",
    tone: "amber",
  },
];

export const catalogPdfSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/catalog-pdfs#catalog-pdf-create",
    label: "Thêm tài liệu",
    description: "Tạo từ URL PDF hoặc upload tệp.",
    icon: "plus",
    tone: "emerald",
  },
  {
    href: "/catalog-pdfs#catalog-pdf-list",
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
    href: "/saved-items#watchlist",
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
    href: "#settings-overview",
    label: "Tổng quan",
    description: "Các nhóm cấu hình hiện có trong BidTool.",
    icon: "settings",
  },
  {
    href: "#desktop-client",
    label: "Desktop client",
    description: "Cấu hình cách Electron kết nối server.",
    icon: "monitor",
  },
  {
    href: "#desktop-server",
    label: "Server URL",
    description: "Trỏ Electron tới server on-prem hoặc local.",
    icon: "server",
  },
  {
    href: "#desktop-config",
    label: "Cấu hình hiện tại",
    description: "Nguồn cấu hình, server và trạng thái editable.",
    icon: "settings",
  },
];

export const sourceDetailSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/search",
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
    href: "#bat-dau",
    label: "Bắt đầu",
    description: "Cài đặt, mở app và kiểm tra dashboard.",
    icon: "home",
  },
  {
    href: "#tim-kiem",
    label: "Tìm kiếm",
    description: "Nguồn BidWinner, Smart View và Watchlist.",
    icon: "search",
  },
  {
    href: "#import-mapping",
    label: "Import",
    description: "Nhập Excel/CSV, preview và catalog vật tư.",
    icon: "sheet",
  },
  {
    href: "#khac-phuc-loi",
    label: "Khắc phục lỗi",
    description: "Docker, env, migration và server local.",
    icon: "warning",
  },
];
