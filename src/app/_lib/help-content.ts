// Help documentation content — extracted from help page.
export type HelpLink = {
  href: string;
  label: string;
};

export type HelpImage = {
  src: string;
  alt: string;
  caption: string;
};

export type Section = {
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

export type TaskFlow = {
  title: string;
  body: string;
  href: string;
  cta: string;
  signal: string;
};

export type PageDirectoryItem = {
  href: string;
  title: string;
  body: string;
};

export type HelpVisual =
  | "local-stack"
  | "source-matrix"
  | "import-pipeline"
  | "local-commands"
  | "troubleshooting";

export type SourceMatrixRow = {
  mode: string;
  exact: string;
  local: string;
  watch: string;
};

export type HelpMetric = {
  value: string;
  label: string;
  body: string;
};

export type FlowNode = {
  step: string;
  label: string;
  body: string;
};

export type CommandCard = {
  command: string;
  when: string;
  result: string;
};

export type TroubleshootingCard = {
  symptom: string;
  checks: string[];
  action: string;
};

export const quickLinks: HelpLink[] = [
  { href: "/dashboard", label: "Tổng quan" },
  { href: "/search/packages", label: "Tìm kiếm" },
  { href: "/documents", label: "Documents" },
  { href: "/import-mapping", label: "Import & Mapping" },
  { href: "/materials", label: "Vật tư" },
  { href: "/workflows", label: "Workflows" },
  { href: "/settings", label: "Cài đặt" },
];

export const taskFlow: TaskFlow[] = [
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
    href: "/search/packages",
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

export const helpMetrics: HelpMetric[] = [
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

export const flowNodes: FlowNode[] = [
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

export const localStackLayers: FlowNode[] = [
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

export const sourceMatrixRows: SourceMatrixRow[] = [
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

export const importPipeline: FlowNode[] = [
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

export const localCommands: CommandCard[] = [
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

export const troubleshootingCards: TroubleshootingCard[] = [
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

export const pageDirectory: PageDirectoryItem[] = [
  {
    href: "/dashboard",
    title: "Tổng quan",
    body: "KPI, cảnh báo mới nhất, workflow gần đây và lối đi nhanh theo tác vụ.",
  },
  {
    href: "/search/packages",
    title: "Tìm kiếm",
    body: "Hub BidWinner public cho gói thầu, địa phương, ngành nghề, KHLCNT và dự án.",
  },
  {
    href: "/saved-items/smart-views",
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
    href: "/materials/import",
    title: "Import & Mapping",
    body: "Upload Excel hoặc dán CSV, xem preview và nhập hàng loạt catalog vật tư.",
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

export const sections: Section[] = [
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
      "Smart View và workflow giờ lưu kèm `mode`, nên khi mở lại sẽ quay đúng tab tương ứng trên `/search/packages` và các route con.",
      "Nếu BidWinner chậm hoặc lỗi, thử giảm bộ lọc hoặc chuyển trang sau vài giây.",
    ],
    links: [{ href: "/search/packages", label: "Mở Tìm kiếm" }],
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
      "Mở `/saved-items/smart-views` hoặc `/saved-items/watchlist` để xem lại Smart View hoặc Watchlist đã lưu.",
      "Dùng link từ Smart View để áp lại bộ lọc lên trang Tìm kiếm.",
      "Tạo workflow từ Smart View nếu muốn tự động nhận cảnh báo gói mới.",
    ],
    notes: [
      "Smart View lưu tiêu chí, không lưu toàn bộ kết quả realtime tại thời điểm tạo.",
      "Watchlist phù hợp với gói đã xác định và cần quay lại sau.",
    ],
    links: [{ href: "/saved-items/smart-views", label: "Mở Smart Views" }],
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
      "Danh mục vật tư là catalog nội bộ dùng để chuẩn hóa tên, đơn vị, đơn giá và nguồn sản phẩm.",
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

export const HELP_SECTION_SLUGS = sections.map((section) => section.id);

export function getHelpSection(slug: string) {
  return sections.find((section) => section.id === slug) ?? null;
}
