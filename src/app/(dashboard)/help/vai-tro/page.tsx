import Link from "next/link";

import { createPageMetadata } from "~/app/_lib/seo";
import { Badge } from "~/app/_components/ui";
import {
  ROLE_CAPABILITIES,
  ROLE_LABELS,
} from "~/lib/role-surfaces";
import type { Role } from "~/lib/permissions";

export const metadata = createPageMetadata({
  title: "Vai trò & quyền",
  description:
    "Ma trận vai trò admin, manager, staff và customer trong BidTool.",
  path: "/help/vai-tro",
  noIndex: true,
});

const roleOrder: Role[] = ["admin", "manager", "staff", "customer"];

const toneMap = {
  sky: "border-blue-200 bg-blue-50 text-blue-900",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  violet: "border-violet-200 bg-violet-50 text-violet-900",
  rose: "border-rose-200 bg-rose-50 text-rose-900",
  slate: "border-slate-400 bg-slate-50 text-slate-900",
} as const;

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-600">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function RoleHelpPage() {
  return (
    <article className="space-y-5">
      <Link
        href="/help"
        className="inline-flex min-h-10 items-center text-xs font-semibold text-slate-700 transition-colors duration-0 hover:text-slate-950 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        ← Quay lại mục lục trợ giúp
      </Link>

      <section className="rounded border border-slate-400 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-1">
          <div>
            <p className="section-title">RBAC</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
              Vai trò & quyền trong BidTool
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Trang này giải thích rõ mỗi vai trò được xem gì, được làm gì và bị
              chặn khỏi những khu vực nào. Đây là bản UX: API auth vẫn theo cấu
              hình hiện tại cho đến khi `AUTH_ENABLED` được bật ở một bước sau.
            </p>
          </div>
          <Badge tone="info">4 vai trò</Badge>
        </div>
      </section>

      <section className="grid gap-1 lg:grid-cols-2">
        {roleOrder.map((role) => {
          const capability = ROLE_CAPABILITIES[role];
          return (
            <div
              key={role}
              className={`rounded border p-4 shadow-sm ${toneMap[capability.tone]}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold">{ROLE_LABELS[role]}</h3>
                <Badge tone={role === "customer" ? "warning" : "neutral"}>
                  {capability.landingPath}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6">{capability.summary}</p>
              <div className="mt-4 grid gap-1 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                    Được xem
                  </p>
                  <BulletList items={capability.see} />
                </div>
                <div>
                  <p className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                    Được làm
                  </p>
                  <BulletList items={capability.do} />
                </div>
                <div>
                  <p className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                    Không làm
                  </p>
                  <BulletList items={capability.cannot} />
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </article>
  );
}
