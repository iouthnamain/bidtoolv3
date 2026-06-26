import { ExternalLink, Loader2 } from "lucide-react";

import { Badge } from "~/app/_components/ui";
import type { WebLinkResult } from "~/lib/materials/enrich-gap-fill";

export function WebResultsPanel({
  links,
  status,
}: {
  links: WebLinkResult[];
  status?: "idle" | "pending" | "done" | "error";
}) {
  if (status === "pending") {
    return (
      <div className="rounded border border-slate-400 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Đang tìm liên kết web…
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Không tìm được liên kết web.
      </div>
    );
  }

  if (links.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-slate-700">Từ web</p>
      <div className="space-y-2">
        {links.map((link) => (
          <div
            key={link.url}
            className="rounded border border-slate-500 bg-white p-2.5 shadow-[var(--shadow-flat)]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Từ web</Badge>
              {link.domain ? (
                <span className="text-xs text-slate-500">{link.domain}</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {link.title || link.url}
            </p>
            {link.snippet ? (
              <p className="mt-1 text-xs text-slate-600">{link.snippet}</p>
            ) : null}
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              Mở liên kết
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
