import Image from "next/image";
import Link from "next/link";

import { Badge, EmptyState } from "~/app/_components/ui";
import { getDashboardSnapshot } from "~/app/_lib/dashboard-data";

export const dynamic = "force-dynamic";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Chưa chạy";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("vi-VN");
}

function statusLabel(status: string | null | undefined) {
  if (status === "success") return "Thành công";
  if (status === "failed") return "Cần kiểm tra";
  if (status === "running") return "Đang chạy";
  return "Chưa chạy";
}

function statusTone(status: string | null | undefined) {
  if (status === "success") return "success";
  if (status === "failed") return "critical";
  if (status === "running") return "info";
  return "neutral";
}

function ActionIcon({
  name,
}: {
  name: "search" | "excel" | "workflow" | "help";
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "h-5 w-5",
  };

  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.25 4.25" />
      </svg>
    );
  }

  if (name === "excel") {
    return (
      <svg {...common}>
        <path d="M5 4.5h9l5 5v10A1.5 1.5 0 0 1 17.5 21h-12A1.5 1.5 0 0 1 4 19.5V6a1.5 1.5 0 0 1 1-1.5Z" />
        <path d="M14 4.5V10h5" />
        <path d="M8 13h7" />
        <path d="M8 16h7" />
      </svg>
    );
  }

  if (name === "workflow") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <path d="M8.5 6h6" />
        <path d="M15.8 13.4 8.3 16.6" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.6V14" />
      <path d="M12 17.25h.01" />
    </svg>
  );
}

export default async function Home() {
  const { summary, latestAlerts, recentWorkflowRuns, isDegraded } =
    await getDashboardSnapshot();

  const workflowState =
    summary.activeWorkflows > 0 ? "Đang theo dõi" : "Chưa bật workflow";

  const actionLinks = [
    {
      href: "/search",
      label: "Tìm gói thầu",
      body: "Lọc realtime từ BidWinner và lưu gói phù hợp vào DB.",
      icon: "search" as const,
    },
    {
      href: "/excel-workspace",
      label: "Xử lý Excel",
      body: "Import bảng sản phẩm, map cột, chọn evidence và export enriched file.",
      icon: "excel" as const,
    },
    {
      href: "/workflows",
      label: "Tự động hóa",
      body: "Biến Smart View thành workflow cảnh báo gói thầu mới.",
      icon: "workflow" as const,
    },
    {
      href: "/help",
      label: "Hướng dẫn",
      body: "Xem cách setup, vận hành, bảo trì và xử lý lỗi thường gặp.",
      icon: "help" as const,
    },
  ];

  return (
    <main className="min-h-screen px-4 py-5 text-slate-900 sm:py-7">
      <div className="mx-auto w-full max-w-[1440px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label="BidTool v3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-700 via-sky-800 to-teal-800 text-white shadow-sm">
              <ActionIcon name="search" />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight">
                BidTool v3
              </span>
              <span className="block text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                Procurement OS
              </span>
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-1.5 text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Dashboard
            </Link>
            <Link
              href="/help"
              className="rounded-lg px-3 py-1.5 text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Trợ giúp
            </Link>
            <Link
              href="/search"
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-white transition-colors hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Bắt đầu tìm kiếm
            </Link>
          </nav>
        </header>

        <section className="grid overflow-hidden rounded-3xl border border-cyan-200/50 bg-gradient-to-br from-cyan-950 via-sky-950 to-teal-900 text-white shadow-sm lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex flex-col justify-between gap-8 p-6 sm:p-8 lg:p-10">
            <div>
              <p className="text-xs font-semibold tracking-[0.22em] text-cyan-100 uppercase">
                BidTool control room
              </p>
              <h1 className="mt-3 max-w-3xl text-3xl leading-tight font-bold tracking-tight sm:text-5xl">
                Điều hành tìm thầu, cảnh báo và sourcing từ một màn hình.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-cyan-50/90 sm:text-base">
                BidTool gom tìm kiếm BidWinner, Smart View, workflow cảnh báo và
                Excel product sourcing vào một luồng làm việc cục bộ, rõ trạng
                thái và dễ tiếp tục sau mỗi lần mở app.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-cyan-950 focus-visible:outline-none"
                >
                  Mở trung tâm điều hành
                </Link>
                <Link
                  href="/maintenance"
                  className="inline-flex items-center rounded-xl border border-white/40 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-cyan-950 focus-visible:outline-none"
                >
                  Kiểm tra bảo trì
                </Link>
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold text-cyan-100/80">
                  Gói đang theo dõi
                </dt>
                <dd className="mt-1 text-3xl font-bold tabular-nums">
                  {summary.totalPackages}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-cyan-100/80">
                  Cảnh báo mới
                </dt>
                <dd className="mt-1 text-3xl font-bold tabular-nums">
                  {summary.unreadAlerts}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-cyan-100/80">
                  Workflow
                </dt>
                <dd className="mt-1 text-sm font-bold">{workflowState}</dd>
              </div>
            </dl>
          </div>

          <figure className="border-t border-white/15 bg-white/8 p-4 lg:border-t-0 lg:border-l">
            <div className="overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl shadow-cyan-950/30">
              <Image
                src="/help/dashboard-overview.png"
                alt="Ảnh chụp màn hình dashboard BidTool"
                width={1440}
                height={900}
                priority
                className="h-auto w-full"
                sizes="(min-width: 1024px) 54vw, 100vw"
              />
            </div>
            <figcaption className="mt-3 text-xs leading-5 text-cyan-50/80">
              Dashboard thật của BidTool với KPI, cảnh báo và trạng thái
              workflow gần đây.
            </figcaption>
          </figure>
        </section>

        {isDegraded ? (
          <section className="panel border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Không tải được dữ liệu dashboard từ database. Kiểm tra Postgres và
            chạy migration trước khi dùng dữ liệu thật.
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {actionLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="panel group flex min-h-36 flex-col justify-between gap-5 p-4 transition-colors duration-150 hover:border-sky-300 hover:bg-sky-50/60 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-sky-700 transition-colors group-hover:border-sky-200">
                <ActionIcon name={item.icon} />
              </span>
              <span>
                <span className="block text-sm font-bold text-slate-950">
                  {item.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-600">
                  {item.body}
                </span>
              </span>
            </Link>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <article className="panel p-4">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="section-title">Cần chú ý</p>
                <h2 className="mt-1 text-base font-bold text-slate-950">
                  Cảnh báo mới nhất
                </h2>
              </div>
              <Link
                href="/notifications"
                className="text-xs font-bold text-sky-700 hover:underline"
              >
                Xem tất cả
              </Link>
            </div>

            {latestAlerts.length === 0 ? (
              <EmptyState
                className="mt-3"
                title="Không có cảnh báo mới"
                description="Khi workflow phát hiện gói mới, cảnh báo sẽ xuất hiện ở đây."
              />
            ) : (
              <ul className="mt-3 space-y-2">
                {latestAlerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-bold [overflow-wrap:anywhere] text-slate-950">
                        {alert.title}
                      </p>
                      <Badge
                        tone={
                          alert.severity === "high"
                            ? "critical"
                            : alert.severity === "medium"
                              ? "warning"
                              : "info"
                        }
                      >
                        {alert.severity === "high"
                          ? "Cao"
                          : alert.severity === "medium"
                            ? "Trung bình"
                            : "Thấp"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {alert.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="panel p-4">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="section-title">Tự động hóa</p>
                <h2 className="mt-1 text-base font-bold text-slate-950">
                  Workflow gần đây
                </h2>
              </div>
              <Link
                href="/workflows"
                className="text-xs font-bold text-sky-700 hover:underline"
              >
                Quản lý
              </Link>
            </div>

            {recentWorkflowRuns.length === 0 ? (
              <EmptyState
                className="mt-3"
                title="Chưa có workflow chạy"
                description="Tạo workflow từ Smart View để tự động nhận cảnh báo."
              />
            ) : (
              <ul className="mt-3 space-y-2">
                {recentWorkflowRuns.slice(0, 3).map((workflow) => (
                  <li
                    key={workflow.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-bold [overflow-wrap:anywhere] text-slate-950">
                        {workflow.name}
                      </p>
                      <Badge tone={statusTone(workflow.latestRun?.status)}>
                        {statusLabel(workflow.latestRun?.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(workflow.latestRun?.startedAt)}
                    </p>
                    {workflow.latestRun?.message ? (
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {workflow.latestRun.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}
