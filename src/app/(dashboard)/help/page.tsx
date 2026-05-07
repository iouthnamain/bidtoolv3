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

type TaskFlow = {
  title: string;
  body: string;
  href: string;
  cta: string;
};

type PageDirectoryItem = {
  href: string;
  title: string;
  body: string;
};

const quickLinks: HelpLink[] = [
  { href: "/dashboard", label: "Tổng quan" },
  { href: "/search", label: "Tìm kiếm" },
  { href: "/excel-workspace", label: "Excel Workspace" },
  { href: "/materials", label: "Vật tư" },
  { href: "/workflows", label: "Workflows" },
  { href: "/maintenance", label: "Bảo trì" },
];

const taskFlow: TaskFlow[] = [
  {
    title: "1. Kiểm tra trạng thái",
    body: "Mở Tổng quan để xem cảnh báo, workflow gần nhất và dữ liệu đang theo dõi.",
    href: "/dashboard",
    cta: "Tổng quan",
  },
  {
    title: "2. Tìm và lưu nguồn thầu",
    body: "Dùng Tìm kiếm để lọc BidWinner public, lưu Smart View hoặc đưa gói vào Watchlist.",
    href: "/search",
    cta: "Tìm kiếm",
  },
  {
    title: "3. Tự động hóa cảnh báo",
    body: "Biến Smart View ổn định thành workflow, sau đó xử lý kết quả trong Trung tâm thông báo.",
    href: "/workflows",
    cta: "Workflows",
  },
  {
    title: "4. Chuẩn hóa Excel và vật tư",
    body: "Tạo workspace Excel, map cột, đối chiếu catalog vật tư và xuất workbook enriched.",
    href: "/excel-workspace",
    cta: "Excel Workspace",
  },
];

const pageDirectory: PageDirectoryItem[] = [
  {
    href: "/dashboard",
    title: "Tổng quan",
    body: "KPI, cảnh báo mới nhất, workflow gần đây và lối đi nhanh theo tác vụ.",
  },
  {
    href: "/search",
    title: "Tìm kiếm",
    body: "Hub BidWinner public cho gói thầu, địa phương, ngành nghề, KHLCNT và dự án.",
  },
  {
    href: "/saved-items",
    title: "Bộ lọc & Watchlist",
    body: "Quản lý Smart View đã lưu và các package/KHLCNT/dự án cần theo dõi.",
  },
  {
    href: "/workflows",
    title: "Quy trình",
    body: "Tạo, bật/tạm dừng, chạy thủ công và xem lịch sử workflow cảnh báo.",
  },
  {
    href: "/notifications",
    title: "Thông báo",
    body: "Xử lý cảnh báo in-app được tạo từ workflow và đánh dấu đã đọc.",
  },
  {
    href: "/excel-workspace",
    title: "Không gian Excel",
    body: "Upload workbook, map cột, review dòng vật tư, tìm evidence và export.",
  },
  {
    href: "/materials",
    title: "Sản phẩm / vật tư",
    body: "Catalog nội bộ để nhập, sửa, chuẩn hóa đơn vị, giá và link nguồn.",
  },
  {
    href: "/insights",
    title: "Phân tích",
    body: "Tổng quan thị trường và chỉ số vận hành khi dữ liệu đã đủ.",
  },
  {
    href: "/maintenance",
    title: "Bảo trì cục bộ",
    body: "Chạy setup/update/migration và kiểm tra phụ thuộc local trong development.",
  },
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
      "Trang Tìm kiếm giờ là một hub chung cho 5 chế độ BidWinner public: Gói thầu, Theo địa phương, Ngành nghề & địa phương, KHLCNT, và Dự án đầu tư phát triển. Mỗi tab đều hiển thị rõ trường nào lấy chính xác từ nguồn public và trường nào chỉ tinh lọc trong cửa sổ dữ liệu đang tải.",
    steps: [
      "Chọn tab đúng nhu cầu trước: Gói thầu cho tìm kiếm package chung, Theo địa phương cho chế độ province-first, Ngành nghề & địa phương cho taxonomy classify public, KHLCNT cho kế hoạch lựa chọn nhà thầu, và Dự án cho danh sách dự án đầu tư phát triển.",
      "Soạn bộ lọc theo tab đang mở: từ khóa, tỉnh/thành, ngân sách, ngày và các trường đặc thù như HTLCNT, nhóm dự án hoặc classify ngành nghề.",
      "Xem banner nguồn ngay trên kết quả để biết trường nào chạy chính xác trên BidWinner public, trường nào chỉ đang refine trong app, và tab nào bị giới hạn vì BidWinner không public endpoint JSON tương ứng.",
      "Khi đã ưng bộ lọc, bấm Áp dụng bộ lọc rồi lưu Smart View nếu muốn dùng lại hoặc tạo workflow cảnh báo sau này.",
      "Chọn các dòng phù hợp rồi bấm Lưu để persist vào database; package, KHLCNT và dự án đều có detail page riêng trong app.",
    ],
    notes: [
      "Theo địa phương chỉ chọn chính xác một tỉnh/thành tại một thời điểm để bám cách BidWinner public đang hoạt động.",
      "Ngành nghề & địa phương dùng taxonomy public `classifies`, nhưng kết quả tab này vẫn là local refinement trên cửa sổ package public hiện tại vì BidWinner không public endpoint kết quả tương ứng.",
      "KHLCNT và Dự án luôn lấy tổng số/phân trang từ trang public gốc, nhưng các refine như từ khóa, tỉnh, ngân sách, ngày và field đặc thù vẫn chạy trong app.",
      "Smart View và workflow giờ lưu kèm `mode`, nên khi mở lại sẽ quay đúng tab tương ứng trên `/search`.",
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
      "Smart View lưu lại mode + criteria của trang Tìm kiếm để dùng lại hoặc làm đầu vào cho workflow. Watchlist lưu các package, KHLCNT hoặc dự án cụ thể cần theo dõi.",
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
    image: {
      src: "/help/saved-items.png",
      alt: "Trang Bộ lọc và Watchlist hiển thị Smart Views đã lưu",
      caption:
        "Smart Views giữ criteria để áp lại tìm kiếm hoặc làm đầu vào workflow.",
    },
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
    image: {
      src: "/help/workflows.png",
      alt: "Trang Workflow tự động với danh sách trigger và lịch sử chạy",
      caption:
        "Workflow dùng Smart View làm nguồn lọc và sinh cảnh báo khi có kết quả mới.",
    },
  },
  {
    id: "thong-bao",
    eyebrow: "Cảnh báo",
    title: "Trung tâm thông báo",
    intro:
      "Thông báo là hàng chờ xử lý cho cảnh báo workflow. Đây là nơi đọc cảnh báo mới, lọc theo trạng thái và dọn các mục đã xử lý.",
    steps: [
      "Mở `/notifications` sau khi workflow chạy xong hoặc khi KPI dashboard báo có cảnh báo chưa đọc.",
      "Lọc theo chưa đọc/đã đọc hoặc theo mức độ để ưu tiên xử lý.",
      "Mở nguồn liên quan từ thông báo nếu cần kiểm tra package, KHLCNT hoặc dự án.",
      "Đánh dấu đã đọc sau khi đã xử lý để dashboard quay về trạng thái sạch.",
    ],
    notes: [
      "Thông báo phản ánh workflow đã chạy, không thay thế trang Tìm kiếm realtime.",
      "Nếu chưa có workflow active, trang này có thể trống.",
    ],
    links: [{ href: "/notifications", label: "Mở Thông báo" }],
    image: {
      src: "/help/notifications.png",
      alt: "Trung tâm thông báo BidTool với bộ lọc trạng thái cảnh báo",
      caption:
        "Thông báo giúp tách việc cần xử lý khỏi cấu hình Smart View và workflow.",
    },
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
      "Ở bước Find, dùng bộ lọc gợi ý để tinh lọc kết quả. Khi bộ lọc đang bật, bấm `Tìm thêm theo bộ lọc` để tìm web với nhiều kết quả hơn.",
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
    id: "vat-tu",
    eyebrow: "Catalog",
    title: "Sản phẩm / vật tư",
    intro:
      "Danh mục vật tư là catalog nội bộ dùng lại trong Excel Workspace để chuẩn hóa tên, đơn vị, giá tham khảo và nguồn sản phẩm.",
    steps: [
      "Mở `/materials` để kiểm tra danh sách vật tư đã có.",
      "Tạo vật tư thủ công khi cần một item chuẩn trước khi map Excel.",
      "Dùng trang nhập hàng loạt nếu đã có sheet catalog riêng.",
      "Mở chi tiết vật tư để cập nhật thông số, link nhà cung cấp hoặc nguồn giá.",
      "Khi review Excel Workspace, dùng catalog này để chọn sản phẩm nội bộ phù hợp.",
    ],
    notes: [
      "Xóa vật tư khỏi catalog không xóa file workspace đã upload.",
      "Giữ tên, đơn vị và nguồn giá nhất quán để workbook export dễ kiểm tra.",
    ],
    links: [
      { href: "/materials", label: "Mở Vật tư" },
      { href: "/materials/import", label: "Nhập catalog" },
    ],
    image: {
      src: "/help/materials.png",
      alt: "Trang Sản phẩm vật tư hiển thị catalog nội bộ",
      caption:
        "Catalog vật tư là lớp chuẩn hóa trước khi xuất workbook enriched.",
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

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);

  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={`${part}-${index}`}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[0.92em] font-semibold text-slate-800"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

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
                  Nếu mới mở app, bắt đầu ở Tổng quan. Nếu đang làm việc với
                  nguồn thầu, đi thẳng vào Tìm kiếm; nếu đang xử lý bảng vật tư,
                  mở Excel Workspace hoặc catalog Vật tư.
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

          <section className="panel p-4 sm:p-5">
            <p className="section-title">Luồng chuẩn</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Chọn đúng đường đi trước khi thao tác
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {taskFlow.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex min-h-40 flex-col justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 transition-colors duration-150 hover:border-sky-300 hover:bg-sky-50/70 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <span>
                    <span className="block text-sm font-bold text-slate-950">
                      {item.title}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-slate-600">
                      {item.body}
                    </span>
                  </span>
                  <span className="mt-4 text-xs font-bold text-sky-700 group-hover:text-sky-800">
                    {item.cta} →
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="panel p-4 sm:p-5">
            <p className="section-title">Tất cả trang</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Mục đích từng khu vực
            </h2>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {pageDirectory.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition-colors duration-150 hover:border-sky-300 hover:bg-white focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <span className="block text-sm font-bold text-slate-950">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                    {item.body}
                  </span>
                </Link>
              ))}
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
                    <InlineText text={section.intro} />
                  </p>

                  {section.steps && section.steps.length > 0 ? (
                    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
                      {section.steps.map((step) => (
                        <li key={step}>
                          <InlineText text={step} />
                        </li>
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
                          <li key={note}>
                            <InlineText text={note} />
                          </li>
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
