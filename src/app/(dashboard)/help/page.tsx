import Link from "next/link";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";

type Section = {
  id: string;
  title: string;
  intro: string;
  steps?: string[];
  notes?: string[];
  links?: { href: string; label: string }[];
};

const sections: Section[] = [
  {
    id: "tong-quan",
    title: "Tổng quan",
    intro:
      "BidTool v3 hỗ trợ tìm gói thầu trên BidWinner, lưu Smart View, tự động hóa cảnh báo và mở rộng sang sourcing sản phẩm qua Excel.",
    steps: [
      "Trang Tổng quan tổng hợp KPI, cảnh báo mới và workflow chạy gần đây.",
      "Mở các tác vụ chính từ thanh bên: Tìm kiếm, Excel, Bộ lọc & Watchlist, Quy trình.",
      "Theo dõi cảnh báo và lịch sử workflow ở mục Hoạt động.",
    ],
    links: [
      { href: "/dashboard", label: "Mở Tổng quan" },
    ],
  },
  {
    id: "tim-kiem",
    title: "Tìm kiếm gói thầu",
    intro:
      "Bộ tìm kiếm chia rõ hai khu vực: nguồn BidWinner (tìm chính xác) và tinh lọc cục bộ (chỉ áp dụng trên trang đang xem).",
    steps: [
      "Tỉnh/Thành và phân trang chạy trực tiếp trên BidWinner — tổng kết quả là số thực từ nguồn.",
      "Từ khóa, lĩnh vực, ngân sách, điểm match là tinh lọc cục bộ trên trang nguồn hiện tại. Banner sẽ thông báo khi đang dùng tinh lọc.",
      "Sắp xếp theo ngày đăng. Tham số sortBy cũ (budget/title/...) tự động hạ xuống publishedAt và hiển thị thông báo.",
      "Lưu các gói đã chọn vào DB bằng nút 'Lưu X gói đã chọn vào DB' — hệ thống dedup theo externalId của BidWinner.",
    ],
    notes: [
      "Khi banner tinh lọc xuất hiện, có thể còn kết quả khớp ở các trang nguồn khác — chuyển trang để xem thêm.",
    ],
    links: [{ href: "/search", label: "Mở trang Tìm kiếm" }],
  },
  {
    id: "smart-view",
    title: "Smart Views & Watchlist",
    intro:
      "Smart View là bộ lọc đã lưu, có thể gắn tần suất thông báo. Watchlist lưu gói thầu đơn lẻ.",
    steps: [
      "Trên trang Tìm kiếm, đặt tên Smart View + chọn tần suất 'Hằng ngày' hoặc 'Hằng tuần', rồi nhấn 'Lưu bộ lọc'.",
      "Smart View lưu lại keyword, tỉnh/thành, lĩnh vực, ngân sách và điểm match tối thiểu.",
      "Mở Smart View đã lưu từ /saved-items — link tự áp lại đầy đủ tiêu chí lên trang Tìm kiếm.",
      "Tạo workflow từ Smart View để nhận thông báo khi có gói thầu mới khớp tiêu chí.",
    ],
    links: [{ href: "/saved-items", label: "Bộ lọc & Watchlist" }],
  },
  {
    id: "quy-trinh",
    title: "Quy trình tự động (Workflows)",
    intro:
      "Workflow chạy theo lịch (daily/weekly), tìm gói thầu mới khớp Smart View và đẩy cảnh báo vào Thông báo.",
    steps: [
      "Tạo workflow từ một Smart View tại /workflows.",
      "Khi chạy, workflow so sánh kết quả mới với gói thầu đã thấy trước đó và tạo cảnh báo cho phần delta.",
      "Mỗi run được lưu vào lịch sử — kiểm tra ở trang chi tiết workflow.",
      "Tạm dừng/Kích hoạt workflow bằng nút trên card.",
    ],
    links: [{ href: "/workflows", label: "Mở Quy trình" }],
  },
  {
    id: "excel-workspace",
    title: "Không gian Excel — Product sourcing",
    intro:
      "Workspace generic để biến file Excel sản phẩm bất kỳ thành file đã làm giàu với evidence từ web.",
    steps: [
      "Tạo workspace, upload .xls/.xlsx tại bước Import.",
      "Chọn sheet và map cột Product/Spec/Đơn vị/Số lượng/Giá/Vendor/Origin tại bước Map.",
      "Review và sửa từng dòng đã parse trước khi search.",
      "Bước Find: chạy SearXNG cho từng dòng, chọn kết quả phù hợp hoặc Manual match.",
      "Khi mọi dòng đã matched/manual, Export tạo file .xlsx mới giữ cột gốc và phụ thêm matched_* + evidence.",
    ],
    notes: [
      "Hệ thống không tự chọn — bắt buộc người dùng chốt match cho từng dòng.",
      "SearXNG dùng query tiếng Việt 'gia thong so Viet Nam'. Cấu hình base URL ở env.",
    ],
    links: [{ href: "/excel-workspace", label: "Mở Không gian Excel" }],
  },
  {
    id: "thong-bao",
    title: "Thông báo & Cảnh báo",
    intro:
      "Trung tâm cảnh báo từ workflow. Tất cả cảnh báo workflow tạo đều xuất hiện ở đây.",
    steps: [
      "Mở /notifications để xem cảnh báo mới.",
      "Đánh dấu đã xử lý các cảnh báo không còn quan tâm.",
      "Cảnh báo cũng hiện ở thẻ 'Cảnh báo mới' trên Tổng quan.",
    ],
    links: [{ href: "/notifications", label: "Trung tâm cảnh báo" }],
  },
  {
    id: "phim-tat",
    title: "Phím tắt",
    intro: "Một số phím tắt giúp thao tác nhanh hơn.",
    notes: [
      "Ctrl/Cmd + B — thu gọn/mở thanh bên.",
      "Esc — đóng menu hoặc hộp thoại đang mở.",
      "Enter trong các ô tìm kiếm — áp dụng bộ lọc đang soạn.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default function HelpPage() {
  return (
    <DashboardShell
      title="Trợ giúp & Hướng dẫn"
      description="Tóm tắt cách sử dụng các tính năng chính của BidTool v3."
    >
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <nav
            aria-label="Mục lục Trợ giúp"
            className="panel flex flex-col gap-1 p-3"
          >
            <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
              Mục lục
            </p>
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md px-2 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </aside>

        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <article
              key={section.id}
              id={section.id}
              className="panel scroll-mt-6 p-5"
            >
              <h2 className="text-lg font-bold tracking-tight text-slate-900">
                {section.title}
              </h2>
              <p className="mt-2 text-sm text-slate-600">{section.intro}</p>

              {section.steps && section.steps.length > 0 ? (
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                  {section.steps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              ) : null}

              {section.notes && section.notes.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {section.notes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              ) : null}

              {section.links && section.links.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {section.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                    >
                      {link.label} →
                    </Link>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
