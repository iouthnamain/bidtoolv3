export const SEARCH_MODE_VALUES = [
  "package_keyword",
  "package_location",
  "package_area_location",
  "plan",
  "project",
] as const;

export type SearchMode = (typeof SEARCH_MODE_VALUES)[number];

export const SEARCH_ENTITY_TYPE_VALUES = [
  "package",
  "plan",
  "project",
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPE_VALUES)[number];

export const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  package_keyword: "Gói thầu",
  package_location: "Theo địa phương",
  package_area_location: "Ngành nghề & địa phương",
  plan: "KHLCNT",
  project: "Dự án",
};

export const SEARCH_MODE_DESCRIPTIONS: Record<SearchMode, string> = {
  package_keyword:
    "Tìm gói thầu từ nguồn BidWinner public, sau đó tinh lọc cục bộ theo từ khóa, lĩnh vực, ngân sách, ngày đăng và match score.",
  package_location:
    "Chế độ tỉnh/thành trước tiên: truy vấn trực tiếp BidWinner public theo một địa phương, rồi tinh lọc thêm trong app.",
  package_area_location:
    "Dùng taxonomy công khai Ngành nghề & địa phương của BidWinner, sau đó tinh lọc cục bộ trên cửa sổ gói thầu đang tải.",
  plan: "Đọc payload công khai của trang Kế hoạch LCNT để lấy tổng nguồn chính xác, rồi tinh lọc cục bộ theo tiêu chí đã chọn.",
  project:
    "Đọc payload công khai của trang Dự án đầu tư phát triển, kèm liên kết KHLCNT liên quan trong cùng cửa sổ dữ liệu.",
};

export const SEARCH_ENTITY_LABELS: Record<SearchEntityType, string> = {
  package: "Gói thầu",
  plan: "KHLCNT",
  project: "Dự án",
};

export const WATCHLIST_TYPE_LABELS = {
  package: "Gói thầu",
  plan: "KHLCNT",
  project: "Dự án",
  inviter: "Bên mời thầu",
  competitor: "Đối thủ",
  commodity: "Hàng hóa",
} as const;

export function getSearchEntityType(mode: SearchMode): SearchEntityType {
  if (mode === "plan") {
    return "plan";
  }

  if (mode === "project") {
    return "project";
  }

  return "package";
}

export function isPackageSearchMode(mode: SearchMode): boolean {
  return getSearchEntityType(mode) === "package";
}
