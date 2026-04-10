import Link from "next/link";

import { api } from "~/trpc/server";

export default async function Home() {
  const summary = await api.insight.getDashboardSummary();
  const latestAlerts = await api.notification.list({ limit: 3 });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 p-8 text-white shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
            BidTool v3
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Nền tảng điều hành đấu thầu
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-200 sm:text-base">
            Theo dõi cơ hội mới, tự động hóa workflow và tổng hợp insight trên
            một dashboard thống nhất.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              Mở Dashboard
            </Link>
            <Link
              href="/search"
              className="rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Tìm kiếm gói thầu
            </Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">Tổng gói thầu</p>
            <p className="mt-2 text-2xl font-semibold">{summary.totalPackages}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">Cảnh báo chưa đọc</p>
            <p className="mt-2 text-2xl font-semibold">{summary.unreadAlerts}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">Workflow đang bật</p>
            <p className="mt-2 text-2xl font-semibold">{summary.activeWorkflows}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">Tỷ lệ thành công workflow</p>
            <p className="mt-2 text-2xl font-semibold">
              {summary.workflowSuccessRate}%
            </p>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Lối tắt thao tác</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Link
                href="/search"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-100"
              >
                Tạo bộ lọc mới
              </Link>
              <Link
                href="/workflows"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-100"
              >
                Tạo workflow
              </Link>
              <Link
                href="/insights"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-100"
              >
                Xem báo cáo xu hướng
              </Link>
              <Link
                href="/dashboard"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-100"
              >
                Mở trung tâm điều hành
              </Link>
            </div>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Cảnh báo mới nhất</h2>
            <ul className="mt-3 space-y-2">
              {latestAlerts.map((alert) => (
                <li key={alert.id} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">{alert.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{alert.body}</p>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </div>
    </main>
  );
}
