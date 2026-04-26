import Image from "next/image";
import Link from "next/link";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";

type HelpLink = {
  href: string;
  label: string;
};

type HelpImage = {
  src: string;
  alt: string;
  caption: string;
};

type Section = {
  id: string;
  title: string;
  eyebrow: string;
  intro: string;
  steps?: string[];
  notes?: string[];
  links?: HelpLink[];
  image?: HelpImage;
};

const quickLinks: HelpLink[] = [
  { href: "/dashboard", label: "Tổng quan" },
  { href: "/search", label: "Tìm kiếm" },
  { href: "/saved-items", label: "Smart Views" },
  { href: "/excel-workspace", label: "Excel" },
  { href: "/maintenance", label: "Bảo trì" },
];

const sections: Section[] = [
  {
    id: "bat-dau",
    eyebrow: "Khởi động",
    title: "Lần đầu mở app",
    intro:
      "BidTool chạy cục bộ với Next.js, Bun, PostgreSQL và SearXNG trong Docker. Luồng chuẩn là cài một lần, sau đó dùng lệnh chạy hằng ngày.",
    steps: [
      "Cài Bun và Docker Desktop trên máy Windows hoặc máy dev đang dùng.",
      "Mở project trong terminal và chạy `bun run dev:install` cho lần setup đầu tiên.",
      "Khi setup xong, chạy `bun run dev:run` để mở server phát triển.",
      "Mở `http://localhost:3000/dashboard` để kiểm tra dashboard đã tải được.",
    ],
    notes: [
      "Lệnh install tạo `.env` từ `.env.example` nếu file `.env` chưa tồn tại.",
      "Nếu Docker chưa chạy, bật Docker Desktop trước rồi chạy lại lệnh.",
    ],
    links: [{ href: "/dashboard", label: "Mở Tổng quan" }],
    image: {
      src: "/help/dashboard-overview.png",
      alt: "Màn hình tổng quan BidTool với KPI, cảnh báo và workflow gần đây",
      caption: "Tổng quan là nơi kiểm tra nhanh dữ liệu, cảnh báo và workflow.",
    },
  },
  {
    id: "windows-launch",
    eyebrow: "Windows",
    title: "Mở nhanh bằng file `.bat`",
    intro:
      "Trên Windows, có thể dùng file launcher ở thư mục gốc để mở app từ File Explorer và đi thẳng vào trang bảo trì.",
    steps: [
      "Double-click `launch-maintenance.bat` để khởi động app và tự mở `/maintenance` khi server sẵn sàng.",
      "Sau khi đã `git pull`, double-click `update-maintenance.bat` để chạy update rồi mở lại app.",
      "Giữ cửa sổ PowerShell đang chạy server trong nền trong suốt thời gian sử dụng.",
      "Nếu trình duyệt chưa tự mở sau vài phút, mở thủ công `http://localhost:3000/maintenance`.",
    ],
    notes: [
      "Launcher vẫn cần Bun có trong PATH và Docker Desktop đang chạy.",
      "Nếu dependencies chưa có, launcher tự rơi về luồng install-plus-run.",
    ],
    links: [{ href: "/maintenance", label: "Mở Bảo trì" }],
  },
  {
    id: "cap-nhat-hang-ngay",
    eyebrow: "Vận hành",
    title: "Chạy và cập nhật hằng ngày",
    intro:
      "Dùng các lệnh bảo trì để đồng bộ dependencies, đảm bảo Postgres + SearXNG đang chạy và áp migrations mới trước khi thao tác dữ liệu thật.",
    steps: [
      "Mỗi ngày làm việc, chạy `bun run dev:run` hoặc dùng `launch-maintenance.bat`.",
      "Sau khi kéo code mới bằng `git pull`, chạy `bun run dev:update` hoặc dùng `update-maintenance.bat`.",
      "Nếu chỉ nghi ngờ thiếu schema, mở `/maintenance` và bấm `Áp migrations`.",
      "Khi lệnh đang chạy, chờ trạng thái về `Sẵn sàng` trước khi bấm lệnh khác.",
    ],
    notes: [
      "`dev:update` không tự chạy `git pull`; kéo code trước để tránh ghi đè thay đổi local ngoài ý muốn.",
      "Các lệnh maintenance chỉ khả dụng trong môi trường development.",
    ],
    image: {
      src: "/help/maintenance-status.png",
      alt: "Trang bảo trì hiển thị trạng thái sẵn sàng và các nút chạy setup update migration",
      caption:
        "Trang Bảo trì giúp chạy các lệnh cục bộ mà không rời trình duyệt.",
    },
  },
  {
    id: "tim-kiem",
    eyebrow: "Nguồn thầu",
    title: "Tìm kiếm gói thầu",
    intro:
      "Trang Tìm kiếm lấy dữ liệu realtime từ BidWinner, sau đó cho phép tinh lọc cục bộ trên trang kết quả hiện tại.",
    steps: [
      "Chọn Tỉnh/Thành và phân trang để truy vấn trực tiếp nguồn BidWinner.",
      "Nhập từ khóa, lĩnh vực, ngân sách hoặc điểm match tối thiểu để tinh lọc trên dữ liệu đang xem.",
      "Dùng sắp xếp theo ngày đăng để ưu tiên gói mới.",
      "Chọn các gói phù hợp rồi bấm lưu vào DB; hệ thống dedup theo `externalId`.",
    ],
    notes: [
      "Khi banner tinh lọc xuất hiện, kết quả khớp có thể vẫn nằm ở trang nguồn khác.",
      "Nếu BidWinner chậm hoặc lỗi, thử giảm bộ lọc hoặc chuyển trang sau vài giây.",
    ],
    links: [{ href: "/search", label: "Mở Tìm kiếm" }],
    image: {
      src: "/help/search-filters.png",
      alt: "Trang tìm kiếm BidTool với bộ lọc BidWinner và kết quả gói thầu",
      caption:
        "Tách rõ bộ lọc nguồn và tinh lọc cục bộ để tránh hiểu sai tổng kết quả.",
    },
  },
  {
    id: "smart-view",
    eyebrow: "Theo dõi",
    title: "Smart Views & Watchlist",
    intro:
      "Smart View lưu lại bộ lọc để dùng lại hoặc làm đầu vào cho workflow. Watchlist lưu từng gói thầu cụ thể cần theo dõi.",
    steps: [
      "Từ trang Tìm kiếm, đặt tên Smart View và chọn tần suất thông báo.",
      "Mở `/saved-items` để xem lại Smart View hoặc Watchlist đã lưu.",
      "Dùng link từ Smart View để áp lại bộ lọc lên trang Tìm kiếm.",
      "Tạo workflow từ Smart View nếu muốn tự động nhận cảnh báo gói mới.",
    ],
    notes: [
      "Smart View lưu tiêu chí, không lưu toàn bộ kết quả realtime tại thời điểm tạo.",
      "Watchlist phù hợp với gói đã xác định và cần quay lại sau.",
    ],
    links: [{ href: "/saved-items", label: "Mở Smart Views" }],
  },
  {
    id: "quy-trinh",
    eyebrow: "Tự động hóa",
    title: "Workflows và thông báo",
    intro:
      "Workflow chạy theo lịch hoặc chạy thủ công để tìm gói thầu mới khớp Smart View và tạo cảnh báo trong trung tâm thông báo.",
    steps: [
      "Tạo workflow từ một Smart View đã lưu.",
      "Kiểm tra trạng thái active/paused trên danh sách workflow.",
      "Mở chi tiết workflow để xem lịch sử chạy và thông điệp lỗi nếu có.",
      "Vào `/notifications` để xử lý cảnh báo được tạo từ workflow.",
    ],
    notes: [
      "Nếu workflow không tạo cảnh báo mới, có thể tiêu chí chưa có kết quả mới so với lần chạy trước.",
      "Tạm dừng workflow khi bộ lọc chưa ổn để tránh tạo cảnh báo nhiễu.",
    ],
    links: [
      { href: "/workflows", label: "Mở Workflows" },
      { href: "/notifications", label: "Mở Thông báo" },
    ],
  },
  {
    id: "excel-workspace",
    eyebrow: "Excel",
    title: "Không gian Excel",
    intro:
      "Excel Workspace biến file sản phẩm bất kỳ thành workbook đã bổ sung thông tin match, nguồn chứng cứ và dữ liệu xuất.",
    steps: [
      "Tạo workspace mới, đặt tên dễ nhận biết và upload file `.xls` hoặc `.xlsx`.",
      "Chọn sheet, map cột sản phẩm/spec/đơn vị/số lượng/giá/vendor/origin.",
      "Review và sửa dòng đã parse trước khi tìm nguồn web.",
      "Ở bước Find, chọn candidate phù hợp hoặc tạo manual match.",
      "Khi mọi dòng đã matched/manual, export file enriched `.xlsx`.",
    ],
    notes: [
      "Hệ thống không tự chọn candidate thay người dùng.",
      "SearXNG chỉ cần khi chạy luồng tìm web cho sản phẩm.",
    ],
    links: [{ href: "/excel-workspace", label: "Mở Không gian Excel" }],
    image: {
      src: "/help/excel-workspace.png",
      alt: "Không gian Excel với danh sách workspace và trạng thái xử lý",
      caption: "Workspace giữ file gốc và tạo file enriched mới khi export.",
    },
  },
  {
    id: "khac-phuc-loi",
    eyebrow: "Hỗ trợ",
    title: "Khắc phục lỗi thường gặp",
    intro:
      "Khi app không mở hoặc dữ liệu chưa đúng, ưu tiên kiểm tra các phần phụ thuộc cục bộ trước: Docker, `.env`, migration và trạng thái server.",
    steps: [
      "Nếu Docker lỗi, bật Docker Desktop rồi chạy lại `bun run dev:run`.",
      "Nếu Postgres hoặc SearXNG chưa chạy, mở `/maintenance` và bấm `Khởi động Docker`.",
      "Nếu báo thiếu biến môi trường, so sánh `.env` với `.env.example` và bổ sung giá trị còn thiếu.",
      "Nếu dashboard cảnh báo schema, chạy `bun run dev:update` hoặc `bun run db:migrate`.",
      "Nếu port hoặc process local bị kẹt, mở `/maintenance` và dùng `Dừng toàn bộ`, hoặc chạy `bun run dev:kill`. Lệnh này chỉ dừng Docker, không xóa container hoặc volume.",
      "Nếu một tab maintenance đang chạy lệnh, chờ trạng thái về sẵn sàng trước khi chạy lệnh khác.",
    ],
    notes: [
      "Không đóng terminal hoặc PowerShell đang chạy server khi vẫn đang dùng app.",
      'Demo seed chỉ chạy khi `ENABLE_DEMO_SEED="true"` trong `.env`.',
    ],
    links: [{ href: "/maintenance", label: "Mở Bảo trì" }],
  },
  {
    id: "phim-tat",
    eyebrow: "Thao tác nhanh",
    title: "Phím tắt",
    intro:
      "Một vài phím tắt giúp thao tác nhanh hơn khi làm việc lâu trong dashboard.",
    notes: [
      "Ctrl/Cmd + B: thu gọn hoặc mở thanh bên.",
      "Esc: đóng menu mobile hoặc hộp thoại đang mở.",
      "Enter trong các ô tìm kiếm: áp dụng bộ lọc đang soạn.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default function HelpPage() {
  return (
    <DashboardShell
      title="Trợ giúp & Hướng dẫn"
      description="Hướng dẫn vận hành BidTool v3 từ lúc mở app, tìm gói thầu, lưu bộ lọc, chạy Excel workspace đến bảo trì cục bộ."
    >
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
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
                className="rounded-md px-2 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="panel p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="section-title">Lối tắt</p>
                <h2 className="mt-1 text-lg font-bold text-slate-950">
                  Các điểm bắt đầu phổ biến
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  Nếu mới mở app, bắt đầu ở Tổng quan hoặc Bảo trì. Nếu đang làm
                  việc với nguồn thầu, đi thẳng vào Tìm kiếm hoặc Smart Views.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    {link.label} →
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {sections.map((section) => (
            <article
              key={section.id}
              id={section.id}
              className="panel scroll-mt-6 overflow-hidden"
            >
              <div className="grid gap-0 xl:grid-cols-[1fr_420px]">
                <div className="p-4 sm:p-5">
                  <p className="section-title">{section.eyebrow}</p>
                  <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">
                    {section.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {section.intro}
                  </p>

                  {section.steps && section.steps.length > 0 ? (
                    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
                      {section.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  ) : null}

                  {section.notes && section.notes.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                        Lưu ý
                      </p>
                      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-6 text-slate-600">
                        {section.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {section.links && section.links.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {section.links.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="inline-flex items-center rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                        >
                          {link.label} →
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>

                {section.image ? (
                  <figure className="border-t border-slate-200 bg-slate-50 p-3 xl:border-t-0 xl:border-l">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <Image
                        src={section.image.src}
                        alt={section.image.alt}
                        width={1440}
                        height={900}
                        className="h-auto w-full"
                        sizes="(min-width: 1280px) 420px, 100vw"
                      />
                    </div>
                    <figcaption className="mt-2 text-xs leading-5 text-slate-500">
                      {section.image.caption}
                    </figcaption>
                  </figure>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
