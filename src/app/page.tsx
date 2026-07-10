import Link from "next/link";

import { Logo } from "~/app/_components/brand/logo";
import { createPageMetadata } from "~/app/_lib/seo";

const installerUrl =
  "https://github.com/iouthnamain/bidtoolv3/releases/download/v0.1.0/BidTool.v3.Setup.0.1.0.exe";
const releaseUrl =
  "https://github.com/iouthnamain/bidtoolv3/releases/tag/v0.1.0";

const workflowSteps = [
  {
    number: "01",
    title: "Tìm gói thầu",
    description: "Tập trung thông báo và dữ liệu cần theo dõi.",
  },
  {
    number: "02",
    title: "Chuẩn hóa vật tư",
    description: "Nhập, làm sạch và đối chiếu danh mục.",
  },
  {
    number: "03",
    title: "Theo dõi quy trình",
    description: "Giữ trạng thái BidWinner trong một bàn điều hành.",
  },
] as const;

export const metadata = createPageMetadata({
  title: "BidTool v3 — Bàn điều hành hồ sơ thầu",
  description:
    "Tìm kiếm cơ hội, chuẩn hóa danh mục vật tư và theo dõi quy trình BidWinner trong một bàn điều hành.",
  path: "/",
});

export default function Home() {
  return (
    <div className="bg-surface-canvas text-ink-1 min-h-screen">
      <header className="border-line bg-surface-1 border-b">
        <div className="mx-auto flex min-h-20 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Logo
            href="/"
            ariaLabel="BidTool v3 — trang chủ"
            tagline="Procurement OS"
            className="-ml-1 min-h-11"
          />
          <Link
            href="/dashboard"
            className="border-line-strong bg-surface-1 text-ink-1 hover:bg-surface-3 focus-visible:ring-ring focus-visible:ring-offset-surface-1 inline-flex min-h-11 items-center justify-center rounded border px-4 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Mở bảng điều hành
          </Link>
        </div>
      </header>

      <main>
        <section
          aria-labelledby="hero-title"
          className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:py-20"
        >
          <div className="flex min-w-0 flex-col justify-center lg:col-span-7">
            <p className="text-brand text-xs font-bold tracking-[0.14em] uppercase">
              BidTool v3 · Procurement OS
            </p>
            <h1
              id="hero-title"
              className="text-ink-1 mt-5 max-w-4xl text-[40px] leading-[44px] font-bold tracking-[-0.035em] lg:text-[64px] lg:leading-[68px]"
            >
              Từ gói thầu đến phương án dự thầu — trong một bàn điều hành.
            </h1>
            <p className="text-ink-2 mt-6 max-w-2xl text-[17px] leading-7 sm:text-[18px]">
              Tìm kiếm cơ hội, chuẩn hóa danh mục vật tư và theo dõi quy trình
              BidWinner mà không phải ghép nhiều bảng tính rời rạc.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a
                href={installerUrl}
                target="_blank"
                rel="noreferrer"
                className="bg-brand text-surface-1 hover:bg-ink-1 focus-visible:ring-ring focus-visible:ring-offset-surface-canvas inline-flex min-h-11 items-center justify-center rounded px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Tải cho Windows · v0.1.0
                <span className="sr-only"> (mở trong cửa sổ mới)</span>
              </a>
              <Link
                href="/dashboard"
                className="border-line-strong bg-surface-1 text-ink-1 hover:bg-surface-3 focus-visible:ring-ring focus-visible:ring-offset-surface-canvas inline-flex min-h-11 items-center justify-center rounded border px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Mở bảng điều hành
              </Link>
            </div>
          </div>

          <aside
            aria-labelledby="operations-title"
            className="border-brand bg-surface-1 min-w-0 border-t-4 p-5 shadow-[var(--shadow-raised)] sm:p-7 lg:col-span-5 lg:p-8"
          >
            <div className="border-line flex items-start justify-between gap-4 border-b pb-5">
              <div>
                <p className="text-ink-3 text-xs font-bold tracking-[0.12em] uppercase">
                  Hồ sơ vận hành
                </p>
                <h2
                  id="operations-title"
                  className="text-ink-1 mt-2 text-xl font-semibold tracking-tight"
                >
                  Bàn điều hành hồ sơ
                </h2>
              </div>
              <span className="border-line-strong bg-surface-2 text-ink-2 shrink-0 border px-2.5 py-1 text-xs font-semibold">
                Sơ đồ tĩnh
              </span>
            </div>

            <ol className="mt-2" aria-label="Sơ đồ vận hành BidTool">
              <li className="border-line grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b py-5">
                <span className="text-brand text-xs font-bold tabular-nums">
                  01
                </span>
                <div>
                  <p className="text-ink-1 text-sm font-semibold tracking-[0.08em] uppercase">
                    Nguồn dữ liệu
                  </p>
                  <p className="text-ink-2 mt-1 text-sm leading-6">
                    Thông báo thầu và dữ liệu cần theo dõi
                  </p>
                </div>
              </li>
              <li className="border-line grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b py-5">
                <span className="text-brand text-xs font-bold tabular-nums">
                  02
                </span>
                <div>
                  <p className="text-ink-1 text-sm font-semibold tracking-[0.08em] uppercase">
                    Danh mục vật tư
                  </p>
                  <p className="text-ink-2 mt-1 text-sm leading-6">
                    Nhập, làm sạch và đối chiếu danh mục
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-5">
                <span className="text-brand text-xs font-bold tabular-nums">
                  03
                </span>
                <div>
                  <p className="text-ink-1 text-sm font-semibold tracking-[0.08em] uppercase">
                    Quy trình BidWinner
                  </p>
                  <p className="text-ink-2 mt-1 text-sm leading-6">
                    Trạng thái được gom về một luồng xử lý
                  </p>
                </div>
              </li>
            </ol>

            <p className="border-line text-ink-3 border-t pt-4 text-xs leading-5">
              Sơ đồ vận hành tĩnh · không phải dữ liệu trực tiếp
            </p>
          </aside>
        </section>

        <section
          aria-labelledby="workflow-title"
          className="border-line bg-surface-1 border-y"
        >
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-14">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end lg:gap-12">
              <div>
                <p className="text-brand text-xs font-bold tracking-[0.14em] uppercase">
                  Một luồng công việc
                </p>
                <h2
                  id="workflow-title"
                  className="text-ink-1 mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
                >
                  Từ phát hiện đến theo dõi
                </h2>
              </div>
              <p className="text-ink-2 max-w-2xl text-sm leading-6 lg:justify-self-end">
                Giữ dữ liệu thầu, danh mục vật tư và trạng thái xử lý trên cùng
                một đường đi có thứ tự.
              </p>
            </div>

            <ol className="border-line mt-8 border-y md:grid md:grid-cols-3">
              {workflowSteps.map((step, index) => (
                <li
                  key={step.number}
                  className="border-line relative grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b py-6 last:border-b-0 md:block md:border-r md:border-b-0 md:px-6 md:first:pl-0 md:last:border-r-0 md:last:pr-0"
                >
                  <span className="text-brand text-sm font-bold tabular-nums">
                    {step.number}
                  </span>
                  <div className="min-w-0 md:mt-8">
                    <h3 className="text-ink-1 text-base font-semibold">
                      {step.title}
                    </h3>
                    <p className="text-ink-2 mt-2 text-sm leading-6">
                      {step.description}
                    </p>
                  </div>
                  {index < workflowSteps.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="text-ink-3 absolute right-0 bottom-0 text-lg md:top-5 md:-right-1 md:bottom-auto"
                    >
                      <span className="md:hidden">↓</span>
                      <span className="hidden md:inline">→</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="bg-surface-2">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center lg:px-8">
          <div>
            <h2 className="text-ink-1 text-base font-semibold">
              Windows v0.1.0
            </h2>
            <p className="text-ink-2 mt-2 max-w-3xl text-sm leading-6">
              Tệp cài đặt được cung cấp qua GitHub Releases. Bản hiện tại chưa
              ký mã; Windows SmartScreen có thể hiển thị cảnh báo khi mở.
            </p>
          </div>
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand decoration-line-strong hover:text-ink-1 focus-visible:ring-ring focus-visible:ring-offset-surface-2 inline-flex min-h-11 items-center justify-center justify-self-start rounded px-1 text-sm font-semibold underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none md:justify-self-end"
          >
            Xem ghi chú phát hành
            <span className="sr-only"> (mở trong cửa sổ mới)</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
