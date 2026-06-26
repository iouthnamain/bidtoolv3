import {
  can as canPure,
  type Permission,
  type Role,
} from "~/lib/permissions";

export type NavIconName =
  | "dashboard"
  | "search"
  | "excel"
  | "enrich"
  | "documents"
  | "materials"
  | "jobs"
  | "saved"
  | "workflow"
  | "notification"
  | "help"
  | "chat"
  | "settings"
  | "admin";

export type RoleSurfaceNavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  roles: readonly Role[];
  permission?: Permission;
  badgeCount?: number;
  subItems?: RoleSurfaceSubNavItem[];
};

export type RoleSurfaceSubNavItem = {
  href: string;
  label: string;
  roles?: readonly Role[];
  permission?: Permission;
};

export type RoleSurfaceNavSection = {
  id: string;
  title: string;
  roles: readonly Role[];
  items: RoleSurfaceNavItem[];
};

export type RoleCapability = {
  label: string;
  tone: "blue" | "emerald" | "amber" | "violet" | "rose" | "slate";
  landingPath: string;
  summary: string;
  see: readonly string[];
  do: readonly string[];
  cannot: readonly string[];
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Quản trị",
  manager: "Quản lý",
  staff: "Nhân viên",
  customer: "Khách hàng",
};

export const ROLE_CAPABILITIES: Record<Role, RoleCapability> = {
  admin: {
    label: ROLE_LABELS.admin,
    tone: "blue",
    landingPath: "/admin",
    summary: "Toàn quyền vận hành và quản trị hệ thống.",
    see: ["Toàn bộ dashboard nội bộ", "Vận hành", "Quản trị", "Hoạt động"],
    do: [
      "Quản lý người dùng và tổ chức",
      "Cấu hình AI, cập nhật và desktop",
      "Thực hiện mọi tác vụ vận hành",
    ],
    cannot: ["Không có giới hạn trong UI nội bộ"],
  },
  manager: {
    label: ROLE_LABELS.manager,
    tone: "violet",
    landingPath: "/manager",
    summary: "Quản trị người dùng, tổ chức và cấu hình; không làm nghiệp vụ.",
    see: ["Điều hành", "Hoạt động", "Trợ giúp"],
    do: ["Quản lý user", "Quản lý tenant", "Cấu hình AI"],
    cannot: [
      "Không tạo/sửa vật tư",
      "Không chạy scrape, enrich, workflow",
      "Không vào khu vực admin-only",
    ],
  },
  staff: {
    label: ROLE_LABELS.staff,
    tone: "emerald",
    landingPath: "/staff",
    summary: "Làm toàn bộ tác vụ nghiệp vụ; không quản trị hệ thống.",
    see: ["Vận hành", "Hoạt động", "Trợ giúp"],
    do: [
      "Tìm kiếm, lưu watchlist và smart view",
      "Quản lý vật tư, catalog, workflow",
      "Chạy scrape, enrich và nghiên cứu Excel",
    ],
    cannot: ["Không quản lý user/tenant", "Không cấu hình AI hoặc cập nhật"],
  },
  customer: {
    label: ROLE_LABELS.customer,
    tone: "amber",
    landingPath: "/portal",
    summary: "Cổng khách hàng chỉ để xem dữ liệu thuộc tổ chức của mình.",
    see: ["Thông báo", "Job nghiên cứu", "Job làm giàu", "Danh sách theo dõi tenant"],
    do: ["Xem tiến độ và kết quả được chia sẻ"],
    cannot: ["Không vào dashboard nội bộ", "Không tạo/sửa/chạy tác vụ"],
  },
};

const INTERNAL_ROLES = ["admin", "manager", "staff"] as const;
const OPERATIONS_ROLES = ["admin", "staff"] as const;
const GOVERNANCE_ROLES = ["admin", "manager"] as const;

export const NAV_SECTIONS: RoleSurfaceNavSection[] = [
  {
    id: "home",
    title: "Tổng quan",
    roles: INTERNAL_ROLES,
    items: [
      {
        href: "/admin",
        label: "Bảng điều khiển quản trị",
        icon: "admin",
        roles: ["admin"],
      },
      {
        href: "/manager",
        label: "Bảng điều khiển quản lý",
        icon: "settings",
        roles: ["manager"],
      },
      {
        href: "/staff",
        label: "Bảng điều khiển nhân viên",
        icon: "dashboard",
        roles: ["staff"],
      },
    ],
  },
  {
    id: "operations",
    title: "Vận hành",
    roles: OPERATIONS_ROLES,
    items: [
      {
        href: "/search/packages",
        label: "Tìm kiếm",
        icon: "search",
        roles: OPERATIONS_ROLES,
        subItems: [
          { href: "/search/packages", label: "Gói thầu" },
          { href: "/search/packages/location", label: "Theo địa phương" },
          { href: "/search/packages/area", label: "Ngành & địa phương" },
          { href: "/search/plans", label: "KHLCNT" },
          { href: "/search/projects", label: "Dự án" },
        ],
      },
      {
        href: "/documents",
        label: "Tài liệu",
        icon: "documents",
        roles: OPERATIONS_ROLES,
      },
      {
        href: "/materials",
        label: "Sản phẩm / vật tư",
        icon: "materials",
        roles: OPERATIONS_ROLES,
        subItems: [
          { href: "/materials", label: "Danh mục" },
          {
            href: "/materials/new",
            label: "Thêm thủ công",
            permission: "material:write",
          },
          {
            href: "/materials/import",
            label: "Nhập sheet",
            permission: "material:write",
          },
          {
            href: "/materials/scrape",
            label: "Quét cửa hàng",
            permission: "scrape:run",
          },
        ],
      },
      {
        href: "/material-profiles",
        label: "Hồ sơ vật tư",
        icon: "materials",
        roles: OPERATIONS_ROLES,
      },
      {
        href: "/enrich",
        label: "Đối chiếu Excel",
        icon: "enrich",
        roles: OPERATIONS_ROLES,
        subItems: [
          { href: "/enrich", label: "Đối chiếu & điền" },
          {
            href: "/enrich/jobs",
            label: "Job nghiên cứu",
            permission: "excelResearch:run",
          },
        ],
      },
      {
        href: "/jobs",
        label: "Danh sách job",
        icon: "jobs",
        roles: OPERATIONS_ROLES,
      },
      {
        href: "/catalog-pdfs",
        label: "Thư viện catalog PDF",
        icon: "documents",
        roles: OPERATIONS_ROLES,
        subItems: [
          { href: "/catalog-pdfs", label: "Thư viện" },
          {
            href: "/catalog-pdfs/new",
            label: "Thêm tài liệu",
            permission: "catalog:write",
          },
        ],
      },
      {
        href: "/saved-items",
        label: "Bộ lọc & theo dõi",
        icon: "saved",
        roles: OPERATIONS_ROLES,
        subItems: [
          { href: "/saved-items/smart-views", label: "Bộ lọc thông minh" },
          { href: "/saved-items/watchlist", label: "Danh sách theo dõi" },
        ],
      },
      {
        href: "/workflows",
        label: "Quy trình",
        icon: "workflow",
        roles: OPERATIONS_ROLES,
        subItems: [
          { href: "/workflows", label: "Danh sách" },
          { href: "/workflows/health", label: "Trạng thái" },
          { href: "/workflows/alerts", label: "Thông báo" },
        ],
      },
    ],
  },
  {
    id: "administration",
    title: "Quản trị",
    roles: ["admin"],
    items: [
      {
        href: "/admin",
        label: "Quản trị",
        icon: "admin",
        roles: ["admin"],
        subItems: [
          { href: "/settings/users", label: "Người dùng" },
          { href: "/settings/tenants", label: "Tổ chức" },
          { href: "/settings/ai", label: "Nhà cung cấp AI" },
          {
            href: "/settings/updates",
            label: "Cập nhật",
            permission: "onprem:admin",
          },
          { href: "/settings/desktop", label: "Ứng dụng desktop" },
        ],
      },
    ],
  },
  {
    id: "governance",
    title: "Điều hành",
    roles: GOVERNANCE_ROLES,
    items: [
      {
        href: "/settings",
        label: "Cài đặt",
        icon: "settings",
        roles: GOVERNANCE_ROLES,
        subItems: [
          { href: "/settings", label: "Tóm tắt" },
          {
            href: "/settings/users",
            label: "Người dùng",
            permission: "users:manage",
          },
          {
            href: "/settings/tenants",
            label: "Tổ chức",
            permission: "users:manage",
          },
          {
            href: "/settings/ai",
            label: "Nhà cung cấp AI",
            permission: "settings:manage",
          },
          { href: "/settings/desktop", label: "Ứng dụng desktop", roles: ["admin"] },
          {
            href: "/settings/updates",
            label: "Cập nhật",
            permission: "onprem:admin",
          },
        ],
      },
    ],
  },
  {
    id: "activity",
    title: "Hoạt động",
    roles: INTERNAL_ROLES,
    items: [
      {
        href: "/notifications",
        label: "Thông báo",
        icon: "notification",
        roles: INTERNAL_ROLES,
      },
    ],
  },
  {
    id: "support",
    title: "Hỗ trợ",
    roles: INTERNAL_ROLES,
    items: [
      {
        href: "/help",
        label: "Trợ giúp",
        icon: "help",
        roles: INTERNAL_ROLES,
        subItems: [
          { href: "/help", label: "Tổng quan" },
          { href: "/help/vai-tro", label: "Vai trò & quyền" },
          { href: "/help/bat-dau", label: "Bắt đầu" },
          { href: "/help/cap-nhat-hang-ngay", label: "Vận hành" },
          { href: "/help/tim-kiem", label: "Tìm kiếm" },
          { href: "/help/smart-view", label: "Bộ lọc thông minh" },
          { href: "/help/quy-trinh", label: "Quy trình" },
          { href: "/help/thong-bao", label: "Thông báo" },
          { href: "/help/import-mapping", label: "Nhập & ánh xạ" },
          { href: "/help/vat-tu", label: "Vật tư" },
          { href: "/help/khac-phuc-loi", label: "Khắc phục lỗi" },
        ],
      },
      {
        href: "/chat",
        label: "Thử nghiệm chat",
        icon: "chat",
        roles: OPERATIONS_ROLES,
        permission: "ai:run",
      },
    ],
  },
];

export function getRoleLandingPath(role: Role | null | undefined): string {
  if (!role) return "/dashboard";
  return ROLE_CAPABILITIES[role].landingPath;
}

export function roleCan(
  role: Role | null | undefined,
  permission: Permission | undefined,
): boolean {
  return !permission || canPure(role, permission);
}

export function canSeeNavItem(
  role: Role | null | undefined,
  item: Pick<RoleSurfaceNavItem, "roles" | "permission">,
  can: (permission: Permission) => boolean = (permission) =>
    canPure(role, permission),
): boolean {
  if (!role) return true;
  return item.roles.includes(role) && (!item.permission || can(item.permission));
}

export function canSeeSubNavItem(
  role: Role | null | undefined,
  item: RoleSurfaceSubNavItem,
  can: (permission: Permission) => boolean = (permission) =>
    canPure(role, permission),
): boolean {
  if (!role) return true;
  return (
    (!item.roles || item.roles.includes(role)) &&
    (!item.permission || can(item.permission))
  );
}

export function buildNavSections(
  role: Role | null | undefined,
  can: (permission: Permission) => boolean = (permission) =>
    canPure(role, permission),
): RoleSurfaceNavSection[] {
  if (!role) {
    return NAV_SECTIONS.filter((section) => section.id !== "administration");
  }

  return NAV_SECTIONS.flatMap((section) => {
    if (!section.roles.includes(role)) return [];

    const items = section.items.flatMap((item) => {
      if (!canSeeNavItem(role, item, can)) return [];

      const subItems = item.subItems?.filter((subItem) =>
        canSeeSubNavItem(role, subItem, can),
      );

      return [{ ...item, subItems }];
    });

    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

const ROUTE_RULES: Array<{
  prefixes: readonly string[];
  roles: readonly Role[];
  permission?: Permission;
}> = [
  {
    prefixes: [
      "/search",
      "/documents",
      "/materials",
      "/material-profiles",
      "/enrich",
      "/jobs",
      "/catalog-pdfs",
      "/saved-items",
      "/workflows",
      "/import-mapping",
      "/research-enrich",
      "/package-details",
      "/plan-details",
      "/project-details",
      "/chat",
    ],
    roles: OPERATIONS_ROLES,
  },
  { prefixes: ["/admin"], roles: ["admin"] },
  { prefixes: ["/manager"], roles: ["manager"] },
  { prefixes: ["/staff"], roles: ["staff"] },
  { prefixes: ["/settings/users", "/settings/tenants"], roles: GOVERNANCE_ROLES },
  {
    prefixes: ["/settings/ai"],
    roles: GOVERNANCE_ROLES,
    permission: "settings:manage",
  },
  { prefixes: ["/settings/updates"], roles: ["admin"], permission: "onprem:admin" },
  { prefixes: ["/settings/desktop"], roles: ["admin"] },
  {
    prefixes: ["/dashboard", "/notifications", "/help", "/settings"],
    roles: INTERNAL_ROLES,
  },
];

export function canAccessRoute(
  role: Role | null | undefined,
  pathname: string,
  can: (permission: Permission) => boolean = (permission) =>
    canPure(role, permission),
): boolean {
  if (!role) return true;
  if (role === "customer") return pathname.startsWith("/portal");

  const rule = ROUTE_RULES.find((candidate) =>
    candidate.prefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ),
  );

  if (!rule) return true;
  return rule.roles.includes(role) && (!rule.permission || can(rule.permission));
}
