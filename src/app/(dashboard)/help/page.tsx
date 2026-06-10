import Image from "next/image";
import Link from "next/link";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { helpSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

export const metadata = createPageMetadata({
  title: "Hướng dẫn sử dụng",
  description:
    "Hướng dẫn setup, tìm kiếm BidWinner, Smart View, workflow, import vật tư và vận hành BidTool v3.",
  path: "/help",
  keywords: ["hướng dẫn BidTool", "setup BidTool", "quy trình đấu thầu"],
});

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
  visual?: HelpVisual;
};

type TaskFlow = {
  title: string;
  body: string;
  href: string;
  cta: string;
  signal: string;
};

type PageDirectoryItem = {
  href: string;
  title: string;
  body: string;
};

type HelpVisual =
  | "local-stack"
  | "source-matrix"
  | "import-pipeline"
  | "local-commands"
  | "troubleshooting";

type SourceMatrixRow = {
  mode: string;
  exact: string;
  local: string;
  watch: string;
};

type HelpMetric = {
  value: string;
  label: string;
  body: string;
};

type FlowNode = {
  step: string;
  label: string;
  body: string;
};

type CommandCard = {
  command: string;
  when: string;
  result: string;
};

type TroubleshootingCard = {
  symptom: string;
  checks: string[];
  action: string;
};

const quickLinks: HelpLink[] = [
  { href: "/dashboard", label: "Tổng quan" },
  { href: "/search", label: "Tìm kiếm" },
  { href: "/documents", label: "Documents" },
  { href: "/import-mapping", label: "Import & Mapping" },
  { href: "/materials", label: "Vật tư" },
  { href: "/workflows", label: "Workflows" },
  { href: "/settings", label: "Cài đặt" },
];

const taskFlow: TaskFlow[] = [
  {
    title: "1. Kiểm tra trạng thái",
    body: "Mở Tổng quan để xem cảnh báo, workflow gần nhất và dữ liệu đang theo dõi.",
    href: "/dashboard",
    cta: "Tổng quan",
    signal: "Dùng khi vừa mở app hoặc cần biết có việc gì cần xử lý.",
  },
  {
    title: "2. Tìm và lưu nguồn thầu",
    body: "Dùng Tìm kiếm để lọc BidWinner public, lưu Smart View hoặc đưa gói vào Watchlist.",
    href: "/search",
    cta: "Tìm kiếm",
    signal: "Dùng khi cần tìm cơ hội, KHLCNT hoặc dự án mới.",
  },
  {
    title: "3. Tự động hóa cảnh báo",
    body: "Biến Smart View ổn định thành workflow, sau đó xử lý kết quả trong Trung tâm thông báo.",
    href: "/workflows",
    cta: "Workflows",
    signal: "Dùng khi bộ lọc đã ổn và cần nhắc tự động.",
  },
  {
    title: "4. Nhập và chuẩn hóa vật tư",
    body: "Dùng Import & Mapping hoặc nhập catalog để preview Excel/CSV trước khi đưa vào danh mục.",
    href: "/import-mapping",
    cta: "Import & Mapping",
    signal: "Dùng khi có file vật tư hoặc catalog cần chuẩn hóa.",
  },
];

const helpMetrics: HelpMetric[] = [
  {
    value: "5",
    label: "chế độ nguồn thầu",
    body: "Gói thầu, địa phương, ngành nghề & địa phương, KHLCNT và dự án.",
  },
  {
    value: "4",
    label: "khối vận hành",
    body: "Tìm kiếm, Smart View, workflow cảnh báo và notification queue.",
  },
  {
    value: "2",
    label: "luồng nhập vật tư",
    body: "Import & Mapping cho không gian mới và nhập catalog hàng loạt.",
  },
  {
    value: "1",
    label: "máy local",
    body: "Thiết kế hiện tại là single-user, chạy với Postgres cục bộ.",
  },
];

const flowNodes: FlowNode[] = [
  {
    step: "01",
    label: "Tìm nguồn",
    body: "Chọn mode BidWinner, lọc theo nhu cầu và kiểm tra banner nguồn.",
  },
  {
    step: "02",
    label: "Lưu tiêu chí",
    body: "Lưu Smart View hoặc đưa dòng cụ thể vào Watchlist.",
  },
  {
    step: "03",
    label: "Tự động hóa",
    body: "Tạo workflow từ Smart View, chạy thủ công hoặc để theo lịch.",
  },
  {
    step: "04",
    label: "Xử lý",
    body: "Đọc notification, mở detail page và quyết định bước tiếp theo.",
  },
  {
    step: "05",
    label: "Chuẩn hóa vật tư",
    body: "Preview Excel/CSV, map dữ liệu và đưa vật tư sạch vào catalog.",
  },
];

const localStackLayers: FlowNode[] = [
  {
    step: "UI",
    label: "Browser hoặc Electron",
    body: "Người dùng thao tác dashboard, help, search, import và catalog vật tư.",
  },
  {
    step: "API",
    label: "Next.js + tRPC",
    body: "Router xử lý tìm kiếm, vật tư, workflow và notification.",
  },
  {
    step: "DB",
    label: "PostgreSQL",
    body: "Lưu tender, Smart View, Watchlist, workflow và catalog vật tư.",
  },
  {
    step: "WEB",
    label: "Nguồn public",
    body: "BidWinner public là nguồn dữ liệu chính cho tìm kiếm và theo dõi.",
  },
];

const sourceMatrixRows: SourceMatrixRow[] = [
  {
    mode: "Gói thầu",
    exact: "Từ khóa, tỉnh, lĩnh vực, ngân sách, ngày đăng.",
    local: "Match score và tinh chỉnh trong cửa sổ kết quả đã tải.",
    watch: "Phù hợp nhất để lưu Smart View và tạo workflow.",
  },
  {
    mode: "Theo địa phương",
    exact: "Một tỉnh/thành theo endpoint public của BidWinner.",
    local: "Từ khóa, ngân sách, ngày và điểm phù hợp.",
    watch: "Chỉ chọn một tỉnh để tránh hiểu sai phạm vi nguồn.",
  },
  {
    mode: "Ngành nghề & địa phương",
    exact: "Taxonomy ngành nghề public từ BidWinner.",
    local: "Kết quả package được refine trong app.",
    watch: "Dùng để khám phá taxonomy, không coi như tổng toàn nguồn.",
  },
  {
    mode: "KHLCNT",
    exact: "Danh sách kế hoạch và phân trang từ trang public.",
    local: "Từ khóa, tỉnh, ngân sách, ngày, lĩnh vực và HTLCNT.",
    watch: "Dùng khi cần theo dõi kế hoạch trước gói thầu cụ thể.",
  },
  {
    mode: "Dự án",
    exact: "Payload dự án đầu tư phát triển public.",
    local: "Từ khóa, tỉnh, nhóm dự án, ngân sách và ngày.",
    watch: "Dùng để phát hiện pipeline trước khi có KHLCNT liên quan.",
  },
];

const importPipeline: FlowNode[] = [
  {
    step: "Import",
    label: "Chọn nguồn",
    body: "Upload `.xlsx` hoặc dán CSV từ catalog vật tư có sẵn.",
  },
  {
    step: "Preview",
    label: "Kiểm tra dữ liệu",
    body: "Xem header, số dòng đọc được, mapping gợi ý và các dòng mẫu.",
  },
  {
    step: "Map",
    label: "Ánh xạ cột",
    body: "Ghép tên vật tư, đơn vị, thông số, NCC, xuất xứ và đơn giá.",
  },
  {
    step: "Save",
    label: "Nhập catalog",
    body: "Chỉ lưu khi preview hợp lệ; dòng trùng name + unit được bỏ qua.",
  },
];

const localCommands: CommandCard[] = [
  {
    command: "bun run dev:install",
    when: "Máy mới hoặc clone mới.",
    result: "Cài deps, tạo `.env` nếu thiếu, bật Docker và áp migrations.",
  },
  {
    command: "bun run dev:run",
    when: "Mỗi ngày làm việc.",
    result: "Kiểm tra env, bật Postgres và mở Next dev server.",
  },
  {
    command: "bun run dev:update",
    when: "Sau khi đã `git pull`.",
    result: "Cập nhật deps, đảm bảo services chạy và áp migrations mới.",
  },
  {
    command: "bun run db:migrate",
    when: "Khi schema hoặc migration bị lệch.",
    result: "Áp migration Drizzle vào database local hiện tại.",
  },
  {
    command: "bun run dev:kill",
    when: "Port hoặc process local bị kẹt.",
    result:
      "Dừng server/Docker compose theo hướng stop-only, không xóa volume.",
  },
];

const troubleshootingCards: TroubleshootingCard[] = [
  {
    symptom: "Trang không mở",
    checks: [
      "Terminal server còn chạy?",
      "Port 3000 có bị chiếm?",
      "Docker đã bật?",
    ],
    action: "Chạy `bun run dev:kill`, sau đó chạy lại `bun run dev:run`.",
  },
  {
    symptom: "Docker hoặc database lỗi",
    checks: ["Postgres container", "Docker daemon", "Database migration"],
    action: "Bật Docker Desktop rồi chạy lại `bun run dev:run`.",
  },
  {
    symptom: "Schema warning",
    checks: [
      "Có migration mới?",
      "Database local có cũ hơn code?",
      "Pull code vừa xong?",
    ],
    action: "Chạy `bun run dev:update` hoặc riêng `bun run db:migrate`.",
  },
  {
    symptom: "Tìm sản phẩm không ra",
    checks: [
      "Từ khóa quá hẹp?",
      "Nguồn BidWinner có dữ liệu?",
      "Bộ lọc quá chặt?",
    ],
    action:
      "Bật Docker Desktop, chạy lại `bun run dev:run`, sau đó tìm lại với ít filter hơn.",
  },
  {
    symptom: "Import Excel lỗi",
    checks: [
      "File có đúng `.xlsx`?",
      "Sheet/header có đúng dữ liệu?",
      "Có dòng thiếu tên hoặc đơn vị?",
    ],
    action:
      "Mở `/materials/import`, xem preview sau upload và chỉnh file trước khi nhập lại.",
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
    href: "/documents",
    title: "Documents",
    body: "Hub hồ sơ thầu, file import và các bản ghi liên quan cần mở cùng tài liệu.",
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
    href: "/import-mapping",
    title: "Import & Mapping",
    body: "Không gian mới cho luồng nhập và ánh xạ dữ liệu vật tư.",
  },
  {
    href: "/materials",
    title: "Sản phẩm / vật tư",
    body: "Catalog nội bộ để nhập, sửa, chuẩn hóa đơn vị, giá và link nguồn.",
  },
  {
    href: "/materials/scrape",
    title: "Scrape shop",
    body: "Preview URL shop để kiểm tra sản phẩm, giá và nguồn trước khi nhập catalog.",
  },
  {
    href: "/settings",
    title: "Cài đặt",
    body: "Cấu hình desktop client và các thiết lập vận hành liên quan.",
  },
];

const sections: Section[] = [
  {
    id: "bat-dau",
    eyebrow: "Khởi động",
    title: "Lần đầu mở app",
    intro:
      "BidTool chạy cục bộ với Next.js, Bun và PostgreSQL trong Docker. Luồng chuẩn là cài một lần, sau đó dùng lệnh chạy hằng ngày.",
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
    visual: "local-stack",
    image: {
      src: "/help/dashboard-overview.png",
      alt: "Màn hình tổng quan BidTool với KPI, cảnh báo và workflow gần đây",
      caption: "Tổng quan là nơi kiểm tra nhanh dữ liệu, cảnh báo và workflow.",
    },
  },
  {
    id: "cap-nhat-hang-ngay",
    eyebrow: "Vận hành",
    title: "Chạy và cập nhật hằng ngày",
    intro:
      "Dùng các lệnh cục bộ để đồng bộ dependencies, đảm bảo Postgres đang chạy và áp migrations mới trước khi thao tác dữ liệu thật.",
    steps: [
      "Mỗi ngày làm việc, chạy `bun run dev:run`.",
      "Sau khi kéo code mới bằng `git pull`, chạy `bun run dev:update`.",
      "Nếu chỉ nghi ngờ thiếu schema, chạy riêng `bun run db:migrate`.",
      "Khi lệnh đang chạy, chờ terminal hoàn tất trước khi chạy lệnh khác.",
    ],
    notes: [
      "`dev:update` không tự chạy `git pull`; kéo code trước để tránh ghi đè thay đổi local ngoài ý muốn.",
      "Các lệnh vận hành cục bộ chỉ khả dụng trong môi trường development.",
    ],
    visual: "local-commands",
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
    visual: "source-matrix",
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
    id: "import-mapping",
    eyebrow: "Import",
    title: "Import & Mapping",
    intro:
      "Import & Mapping là trang mới cho luồng nhập dữ liệu và ánh xạ catalog vật tư. Catalog hiện vẫn nhập thực tế qua `/materials/import` với preview sau upload.",
    steps: [
      "Mở `/import-mapping` khi cần không gian riêng cho luồng import/mapping mới.",
      "Mở `/materials/import` để upload `.xlsx` hoặc dán CSV catalog.",
      "Sau khi chọn file Excel, xem preview header, mapping gợi ý, cảnh báo và 10 dòng mẫu trước khi nhập.",
      "Kiểm tra các cột bắt buộc như tên vật tư và đơn vị; bổ sung thông số, NCC, xuất xứ và đơn giá nếu có.",
      "Bấm nhập khi preview hợp lệ; dòng trùng name + unit sẽ được bỏ qua để giữ catalog sạch.",
    ],
    notes: [
      "Preview giúp kiểm tra dữ liệu trước khi ghi vào catalog.",
      "File `.xls` cũ cần chuyển sang `.xlsx` trước khi upload.",
    ],
    links: [
      { href: "/import-mapping", label: "Mở Import & Mapping" },
      { href: "/materials/import", label: "Nhập catalog" },
      { href: "/materials/scrape", label: "Scrape shop" },
    ],
    visual: "import-pipeline",
  },
  {
    id: "vat-tu",
    eyebrow: "Catalog",
    title: "Sản phẩm / vật tư",
    intro:
      "Danh mục vật tư là catalog nội bộ dùng để chuẩn hóa tên, đơn vị, giá tham khảo và nguồn sản phẩm.",
    steps: [
      "Mở `/materials` để kiểm tra danh sách vật tư đã có.",
      "Tạo vật tư thủ công khi cần một item chuẩn trước khi nhập hàng loạt.",
      "Dùng trang nhập hàng loạt nếu đã có sheet catalog riêng.",
      "Mở chi tiết vật tư để cập nhật thông số, link nhà cung cấp hoặc nguồn giá.",
      "Dùng catalog này làm nguồn chuẩn cho các luồng nhập và mapping tiếp theo.",
    ],
    notes: [
      "Xóa vật tư khỏi catalog không ảnh hưởng đến file nguồn đã upload.",
      "Giữ tên, đơn vị và nguồn giá nhất quán để workbook export dễ kiểm tra.",
    ],
    links: [
      { href: "/materials", label: "Mở Vật tư" },
      { href: "/materials/import", label: "Nhập catalog" },
      { href: "/materials/scrape", label: "Scrape shop" },
    ],
    image: {
      src: "/help/materials.png",
      alt: "Trang Sản phẩm vật tư hiển thị catalog nội bộ",
      caption:
        "Catalog vật tư là lớp chuẩn hóa trước khi dùng dữ liệu cho các bước sau.",
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
      "Nếu Postgres chưa chạy, bật Docker Desktop rồi chạy lại `bun run dev:run`.",
      "Nếu báo thiếu biến môi trường, so sánh `.env` với `.env.example` và bổ sung giá trị còn thiếu.",
      "Nếu dashboard cảnh báo schema, chạy `bun run dev:update` hoặc `bun run db:migrate`.",
      "Nếu port hoặc process local bị kẹt, chạy `bun run dev:kill`. Lệnh này chỉ dừng Docker, không xóa container hoặc volume.",
      "Nếu một lệnh vận hành đang chạy, chờ terminal hoàn tất trước khi chạy lệnh khác.",
    ],
    notes: [
      "Không đóng terminal hoặc PowerShell đang chạy server khi vẫn đang dùng app.",
      'Demo seed chỉ chạy khi `ENABLE_DEMO_SEED="true"` trong `.env`.',
    ],
    visual: "troubleshooting",
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

function FlowMap() {
  return (
    <div className="rounded-2xl border border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-teal-50 p-3">
      <div className="grid gap-2 md:grid-cols-5">
        {flowNodes.map((node, index) => (
          <div key={node.step} className="relative">
            {index > 0 ? (
              <div
                aria-hidden
                className="absolute top-5 -left-3 hidden h-px w-6 bg-cyan-300 md:block"
              />
            ) : null}
            <div className="h-full rounded-xl border border-cyan-200 bg-white/85 p-3 shadow-sm">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cyan-900 text-[11px] font-bold text-white">
                {node.step}
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-950">
                {node.label}
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {node.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocalStackVisual() {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
        Sơ đồ chạy local
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        {localStackLayers.map((layer) => (
          <div
            key={layer.step}
            className="rounded-xl border border-slate-200 bg-white p-3"
          >
            <span className="inline-flex rounded-full bg-slate-900 px-2 py-1 text-[10px] font-bold tracking-wide text-white">
              {layer.step}
            </span>
            <h3 className="mt-2 text-sm font-bold text-slate-950">
              {layer.label}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {layer.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceMatrixVisual() {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
      <div className="bg-slate-900 px-3 py-2 text-xs font-bold tracking-wide text-white uppercase">
        Ma trận độ chính xác nguồn BidWinner
      </div>
      <div className="overflow-x-auto bg-white">
        <table className="min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2 font-bold">Mode</th>
              <th className="px-3 py-2 font-bold">Từ nguồn public</th>
              <th className="px-3 py-2 font-bold">Tinh lọc trong app</th>
              <th className="px-3 py-2 font-bold">Cách dùng đúng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sourceMatrixRows.map((row) => (
              <tr key={row.mode}>
                <th className="w-36 px-3 py-3 text-sm font-bold text-slate-950">
                  {row.mode}
                </th>
                <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                  {row.exact}
                </td>
                <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                  {row.local}
                </td>
                <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                  {row.watch}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportPipelineVisual() {
  return (
    <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
      <p className="text-xs font-bold tracking-wide text-emerald-800 uppercase">
        Pipeline import
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {importPipeline.map((step, index) => (
          <div
            key={step.step}
            className="rounded-xl border border-emerald-200 bg-white p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-slate-950">
                {step.step}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-2 text-sm font-bold text-slate-900">
              {step.label}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              <InlineText text={step.body} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocalCommandsVisual() {
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      {localCommands.map((item) => (
        <div
          key={item.command}
          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          <code className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-900">
            {item.command}
          </code>
          <p className="mt-2 text-xs font-bold text-slate-500 uppercase">
            Khi dùng
          </p>
          <p className="mt-1 text-sm leading-5 text-slate-700">
            <InlineText text={item.when} />
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500 uppercase">
            Kết quả
          </p>
          <p className="mt-1 text-sm leading-5 text-slate-700">
            <InlineText text={item.result} />
          </p>
        </div>
      ))}
    </div>
  );
}

function TroubleshootingVisual() {
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      {troubleshootingCards.map((card) => (
        <div
          key={card.symptom}
          className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"
        >
          <h3 className="text-sm font-bold text-slate-950">{card.symptom}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
            {card.checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
          <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-700">
            <span className="font-bold text-amber-800">Cách xử lý: </span>
            <InlineText text={card.action} />
          </p>
        </div>
      ))}
    </div>
  );
}

function SectionVisual({ visual }: { visual?: HelpVisual }) {
  switch (visual) {
    case "local-stack":
      return <LocalStackVisual />;
    case "source-matrix":
      return <SourceMatrixVisual />;
    case "import-pipeline":
      return <ImportPipelineVisual />;
    case "local-commands":
      return <LocalCommandsVisual />;
    case "troubleshooting":
      return <TroubleshootingVisual />;
    default:
      return null;
  }
}

export const dynamic = "force-dynamic";

export default function HelpPage() {
  return (
    <DashboardShell
      title="Trợ giúp & Hướng dẫn"
      description="Hướng dẫn vận hành BidTool v3 từ lúc mở app, tìm gói thầu, lưu bộ lọc, nhập catalog đến vận hành cục bộ."
      sectionNavItems={helpSectionNavItems}
      sectionNavTitle="Mục trợ giúp chính"
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
                  mở Import & Mapping hoặc catalog Vật tư.
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

          <section className="panel overflow-hidden">
            <div className="grid gap-0 2xl:grid-cols-[1fr_360px]">
              <div className="p-4 sm:p-5">
                <p className="section-title">Bản đồ nhanh</p>
                <h2 className="mt-1 text-lg font-bold text-slate-950">
                  BidTool gom việc đấu thầu thành một luồng khép kín
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Bắt đầu từ dữ liệu public, lưu tiêu chí cần theo dõi, tự động
                  tạo cảnh báo, rồi dùng import catalog để chuẩn hóa bảng vật
                  tư.
                </p>
                <div className="mt-4">
                  <FlowMap />
                </div>
              </div>

              <div className="border-t border-slate-200 bg-slate-50 p-4 sm:p-5 2xl:border-t-0 2xl:border-l">
                <p className="section-title">Tín hiệu chính</p>
                <div className="mt-3 grid gap-2">
                  {helpMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-black text-cyan-900">
                          {metric.value}
                        </span>
                        <span className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                          {metric.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {metric.body}
                      </p>
                    </div>
                  ))}
                </div>
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
                    <span className="mt-3 block rounded-lg bg-slate-50 px-2 py-2 text-[11px] leading-4 font-semibold text-slate-500">
                      {item.signal}
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
                <div className="min-w-0 p-4 sm:p-5">
                  <p className="section-title">{section.eyebrow}</p>
                  <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">
                    {section.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    <InlineText text={section.intro} />
                  </p>

                  <SectionVisual visual={section.visual} />

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
