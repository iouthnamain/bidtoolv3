import { Loader2 } from "lucide-react";

import { Badge, Button } from "~/app/_components/ui";
import type { AiSearchStoredResult } from "~/lib/materials/enrich-gap-fill";
import {
  FIELD_LABELS,
  FILLABLE_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";

export function AiResultsPanel({
  result,
  status,
  onApply,
  isApplying,
}: {
  result?: AiSearchStoredResult;
  status?: "idle" | "pending" | "done" | "error";
  onApply?: () => void;
  isApplying?: boolean;
}) {
  if (status === "pending") {
    return (
      <div className="rounded border border-slate-400 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Đang tìm bằng AI…
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Tìm AI thất bại.
      </div>
    );
  }

  if (!result) {
    return null;
  }

  const fieldEntries = FILLABLE_FIELDS.filter(
    (field) => (result.fields[field]?.trim() ?? "").length > 0,
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">Từ AI</p>
        {onApply && fieldEntries.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onApply}
            disabled={isApplying}
          >
            {isApplying ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            Áp dụng vào dòng
          </Button>
        ) : null}
      </div>

      <div className="rounded border border-slate-500 bg-white p-2.5 shadow-[var(--shadow-flat)]">
        <Badge tone="info">Từ AI</Badge>

        {fieldEntries.length > 0 ? (
          <table className="mt-2 w-full text-xs">
            <tbody>
              {fieldEntries.map((field) => (
                <tr key={field} className="border-t border-slate-100">
                  <td className="py-1 pr-2 font-semibold text-slate-700">
                    {FIELD_LABELS[field]}
                  </td>
                  <td className="py-1 text-slate-900">
                    {result.fields[field]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-xs text-slate-600">
            AI không trích xuất được trường nào.
          </p>
        )}

        {result.evidence.length > 0 ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700">Bằng chứng</p>
            {result.evidence.slice(0, 6).map((item, index) => (
              <div
                key={`${item.field}-${item.sourceUrl ?? index}`}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
              >
                <p className="font-semibold text-slate-700">
                  {FIELD_LABELS[item.field as FillableField] ?? item.field}
                </p>
                <p className="mt-0.5 text-slate-600">{item.snippet}</p>
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-blue-700 hover:underline"
                  >
                    {item.sourceUrl}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {result.sourceUrls.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-700">Nguồn</p>
            <ul className="mt-1 space-y-1">
              {result.sourceUrls.slice(0, 6).map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-700 hover:underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
