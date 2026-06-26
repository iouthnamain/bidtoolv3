import Link from "next/link";

import {
  helpMetrics,
  pageDirectory,
  quickLinks,
  sections,
  taskFlow,
} from "~/app/_lib/help-content";
import { FlowMap } from "~/app/_components/dashboard/help-visuals";

export function HelpIndexContent() {
  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="section-title">Lối tắt</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Các điểm bắt đầu phổ biến
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Nếu mới mở app, bắt đầu ở Tổng quan. Nếu đang làm việc với nguồn
              thầu, đi thẳng vào Tìm kiếm; nếu đang xử lý bảng vật tư, mở Import
              & Mapping hoặc catalog Vật tư.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex min-h-10 items-center rounded border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-0 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {link.label} →
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="grid gap-0 2xl:grid-cols-[1fr_360px]">
          <div className="p-4">
            <p className="section-title">Bản đồ nhanh</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              BidTool gom việc đấu thầu thành một luồng khép kín
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Bắt đầu từ dữ liệu public, lưu tiêu chí cần theo dõi, tự động tạo
              cảnh báo, rồi dùng import catalog để chuẩn hóa bảng vật tư.
            </p>
            <div className="mt-4">
              <FlowMap />
            </div>
          </div>

          <div className="border-t border-slate-400 bg-slate-50 p-4 2xl:border-t-0 2xl:border-l">
            <p className="section-title">Tín hiệu chính</p>
            <div className="mt-3 grid gap-2">
              {helpMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded border border-slate-400 bg-white px-3 py-3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-cyan-900">
                      {metric.value}
                    </span>
                    <span className="text-xs font-bold tracking-wide text-slate-700 uppercase">
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

      <section className="panel p-4">
        <p className="section-title">Luồng chuẩn</p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">
          Chọn đúng đường đi trước khi thao tác
        </h2>
        <div className="mt-4 grid gap-1 md:grid-cols-2 xl:grid-cols-4">
          {taskFlow.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex flex-col justify-between rounded border border-slate-400 bg-white px-3 py-3 transition-colors duration-0 hover:border-blue-300 hover:bg-blue-50/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-40"
            >
              <span>
                <span className="block text-sm font-bold text-slate-950">
                  {item.title}
                </span>
                <span className="mt-2 block text-xs leading-5 text-slate-600">
                  {item.body}
                </span>
                <span className="mt-3 block rounded bg-slate-50 px-2 py-2 text-xs leading-4 font-semibold text-slate-700">
                  {item.signal}
                </span>
              </span>
              <span className="mt-4 text-xs font-bold text-blue-700 group-hover:text-blue-800">
                {item.cta} →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel p-4">
        <p className="section-title">Tất cả trang</p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">
          Mục đích từng khu vực
        </h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {pageDirectory.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded border border-slate-400 bg-slate-50 px-3 py-3 transition-colors duration-0 hover:border-blue-300 hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
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

      <section className="panel p-4">
        <p className="section-title">Chủ đề trợ giúp</p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">
          Mở từng hướng dẫn chi tiết
        </h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {sections.map((section) => (
            <Link
              key={section.id}
              href={`/help/${section.id}`}
              className="rounded border border-slate-400 bg-white px-3 py-3 transition-colors duration-0 hover:border-blue-300 hover:bg-blue-50/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <span className="block text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                {section.eyebrow}
              </span>
              <span className="mt-1 block text-sm font-bold text-slate-950">
                {section.title}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-600">
                {section.intro}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
