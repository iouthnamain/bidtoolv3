import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

function collectFiles(dir = SRC): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (
      (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) &&
      !fullPath.endsWith(".test.ts") &&
      !fullPath.endsWith(".test.tsx")
    ) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const STYLE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/bg-gradient-to-br from-blue-50 to-white/g, "bg-blue-50"],
  [/bg-gradient-to-br from-cyan-50 via-white to-teal-50/g, "bg-blue-50"],
  [
    /bg-gradient-to-r from-white via-blue-50 to-emerald-50/g,
    "bg-white",
  ],
  [
    /bg-gradient-to-r from-slate-50 via-white to-blue-50/g,
    "bg-slate-50",
  ],
  [/bg-gradient-to-b from-white to-slate-50\/50/g, "bg-white"],
  [/bg-gradient-to-b from-slate-50 to-white/g, "bg-slate-50"],
  [/ sm:min-h-44\b/g, ""],
  [/ sm:min-h-40\b/g, ""],
  [/ sm:min-h-48\b/g, ""],
  [/ sm:gap-3 sm:py-6\b/g, ""],
  [/ sm:px-5\b/g, ""],
  [/tone: "sky"/g, 'tone: "blue"'],
  [/tone="sky"/g, 'tone="blue"'],
  [/tone === "sky"/g, 'tone === "blue"'],
  [/\| "sky"/g, '| "blue"'],
  [/sky: \{/g, "blue: {"],
  [/"sky"\s*\|/g, '"blue" |'],
];

const VI_REPLACEMENTS: Array<[string, string]> = [
  ['"Smart Views & Watchlist"', '"Bộ lọc thông minh & theo dõi"'],
  ['"Smart Views"', '"Bộ lọc thông minh"'],
  ['"Smart View"', '"Bộ lọc thông minh"'],
  ['"Watchlist"', '"Danh sách theo dõi"'],
  ['"Catalog PDFs"', '"Thư viện catalog PDF"'],
  ['"Thêm Catalog PDF"', '"Thêm tài liệu catalog PDF"'],
  ['"Chi tiết Catalog PDF"', '"Chi tiết tài liệu catalog PDF"'],
  ['>Catalog PDFs<', ">Thư viện catalog PDF<"],
  ['>Watchlist<', ">Danh sách theo dõi<"],
  ['>Smart Views<', ">Bộ lọc thông minh<"],
  ['"Preview & export"', '"Xem trước & xuất"'],
  ['"Map & chỉnh sheet"', '"Ánh xạ & chỉnh sheet"'],
  ['"AI search"', '"Tìm kiếm AI"'],
  ['"Catalog URLs"', '"URL catalog"'],
  ['"Upload Excel"', '"Tải file Excel"'],
  ['>Upload file Excel<', ">Tải file Excel<"],
  ['>Upload Excel<', ">Tải file Excel<"],
  ['"Workbook edit warnings"', '"Cảnh báo chỉnh sửa workbook"'],
  ['"Deleted in export preview"', '"Đã xóa trong bản xem trước xuất"'],
  ['"Checklist"', '"Danh sách kiểm tra"'],
  ['>Documents<', ">Tài liệu<"],
  ['"Administration"', '"Quản trị"'],
  ['>Preview<', ">Xem trước<"],
  ['"Dev preview"', '"Xem trước dev"'],
  ['>Manual<', ">Thủ công<"],
  ['>Metadata<', ">Siêu dữ liệu<"],
  ['>Products<', ">Sản phẩm<"],
  ['>Links<', ">Liên kết<"],
  ['"Header CSV"', '"Tiêu đề CSV"'],
  ['>Server<', ">Máy chủ<"],
  ['"Base URL"', '"URL gốc"'],
  ['>Base URL<', ">URL gốc<"],
  ['"API key"', '"Khóa API"'],
  ['>API key<', ">Khóa API<"],
  ['>Mode<', ">Chế độ<"],
  ['>RBAC<', ">Phân quyền<"],
  ['>Link<', ">Liên kết<"],
  ['>Text<', ">Nội dung<"],
  ['>Host<', ">Máy chủ<"],
  ['>Key<', ">Khóa<"],
  ['>URL<', ">URL<"],
  [
    '"Không gian quản lý tập trung vào user, tenant và cấu hình. Các tác vụ nghiệp vụ được cố ý ẩn khỏi dashboard này."',
    '"Không gian quản lý tập trung vào người dùng, tổ chức và cấu hình. Các tác vụ nghiệp vụ được cố ý ẩn khỏi bảng điều khiển này."',
  ],
  [
    '"Role, khóa/mở khóa và tenant assignment."',
    '"Vai trò, khóa/mở khóa và gán tổ chức."',
  ],
  [
    '"Không thấy Operations nav: search, materials, scrape, enrich, workflow."',
    '"Không thấy menu vận hành: tìm kiếm, vật tư, quét shop, làm giàu, quy trình."',
  ],
  ['value: version?.current ?? "N/A"', 'value: version?.current ?? "Không có"'],
  [
    '"user, tenant, cập nhật và tham chiếu quyền vào một nơi rõ ràng."',
    '"người dùng, tổ chức, cập nhật và tham chiếu quyền vào một nơi rõ ràng."',
  ],
  ['label: "Tên Smart View"', 'label: "Tên bộ lọc thông minh"'],
  ['htmlFor="smart-view-name"', 'htmlFor="smart-view-name"'],
  ['"Chưa có preview"', '"Chưa có bản xem trước"'],
  ['"Chưa có workbook"', '"Chưa có workbook"'],
  ['title: "Workflow tự động"', 'title: "Quy trình tự động"'],
];

function applyReplacements(content: string): string {
  let next = content;
  for (const [pattern, replacement] of STYLE_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  for (const [from, to] of VI_REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  return next;
}

let changed = 0;
for (const file of collectFiles()) {
  const original = readFileSync(file, "utf8");
  const updated = applyReplacements(original);
  if (updated !== original) {
    writeFileSync(file, updated);
    changed += 1;
  }
}

console.log(`Finish migration updated ${changed} files.`);
