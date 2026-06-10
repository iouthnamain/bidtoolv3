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
    description: "Số vật tư, giá tham khảo, nguồn và category.",
    icon: "bar-chart",
  },
  {
    href: "/materials#material-catalog",
    label: "Danh mục",
    description: "Tìm, chọn, mở chi tiết và xóa vật tư.",
    icon: "boxes",
  },
  {
    href: "/materials/new",
    label: "Thêm thủ công",
    description: "Tạo một vật tư chuẩn cho catalog.",
    icon: "plus",
  },
  {
    href: "/materials/scrape",
    label: "Scrape shop",
    description: "Preview URL shop rồi nhập sản phẩm vào catalog.",
    icon: "search",
  },
  {
    href: "/import-mapping",
    label: "Import & Mapping",
    description: "Không gian mới cho luồng nhập và map dữ liệu.",
    icon: "sheet",
  },
  {
    href: "/materials/import",
    label: "Nhập hàng loạt",
    description: "Upload Excel hoặc dán CSV.",
    icon: "upload",
  },
];

export const materialDetailSectionNavItems: PageSectionNavItem[] = [
  {
    href: "/materials",
    label: "Danh mục",
    description: "Quay lại danh sách vật tư.",
    icon: "boxes",
  },
  {
    href: "#material-overview",
    label: "Tổng quan",
    description: "Mã, giá, nguồn và trạng thái dữ liệu.",
    icon: "eye",
  },
  {
    href: "#material-prices",
    label: "Nguồn giá",
    description: "Nhà cung cấp, URL, giá và ghi chú.",
    icon: "link",
  },
  {
    href: "#material-edit",
    label: "Chỉnh sửa",
    description: "Thông tin catalog, nguồn giá và metadata.",
    icon: "pencil",
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

export const insightsSectionNavItems: PageSectionNavItem[] = [
  {
    href: "#insight-kpis",
    label: "KPI",
    description: "Tổng gói, cảnh báo, workflow và tỉ lệ thành công.",
    icon: "bar-chart",
  },
  {
    href: "#market-trend",
    label: "Xu hướng",
    description: "Biến động gói thầu 7 ngày.",
    icon: "activity",
  },
  {
    href: "#workflow-health",
    label: "Workflow",
    description: "Sức khỏe tự động hóa và trạng thái vận hành.",
    icon: "workflow",
  },
  {
    href: "#top-signals",
    label: "Tín hiệu",
    description: "Bên mời thầu và lĩnh vực nổi bật.",
    icon: "tags",
  },
];

export const maintenanceSectionNavItems: PageSectionNavItem[] = [
  {
    href: "#maintenance-status",
    label: "Trạng thái",
    description: "Tác vụ đang chạy và trạng thái sẵn sàng.",
    icon: "activity",
  },
  {
    href: "#maintenance-services",
    label: "Phiên bản & services",
    description: "Git version, Postgres và Docker status.",
    icon: "server",
  },
  {
    href: "#maintenance-commands",
    label: "Lệnh cục bộ",
    description: "Setup, update, migrate và restart services.",
    icon: "wrench",
  },
  {
    href: "#maintenance-results",
    label: "Kết quả",
    description: "Output gần nhất, exit code và thời gian chạy.",
    icon: "database",
  },
];

export const desktopSectionNavItems: PageSectionNavItem[] = [
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
  {
    href: "/maintenance",
    label: "Bảo trì",
    description: "Kiểm tra local server và lệnh vận hành.",
    icon: "wrench",
  },
  {
    href: "/help#windows-launch",
    label: "Windows",
    description: "Cách mở nhanh bằng file launcher.",
    icon: "file",
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
