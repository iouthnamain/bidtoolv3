"use client";

import { useState } from "react";
import {
  Check,
  CheckSquare,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";

import { Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type MatchDecisionRow =
  RouterOutputs["material"]["listPendingMatches"]["items"][number];

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export function MatchReviewClient() {
  const [minConfidence, setMinConfidence] = useState(0);
  const toast = useToast();
  const utils = api.useUtils();

  const { data, isLoading } = api.material.listPendingMatches.useQuery(
    { limit: 50, offset: 0, minConfidence: minConfidence || undefined },
    { refetchInterval: 10_000 },
  );

  const acceptMutation = api.material.acceptMatch.useMutation({
    onSuccess: () => {
      toast.success("Đã chấp nhận ghép.");
      void utils.material.listPendingMatches.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = api.material.rejectMatch.useMutation({
    onSuccess: () => {
      toast.success("Đã từ chối ghép.");
      void utils.material.listPendingMatches.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkAcceptMutation = api.material.bulkAcceptMatches.useMutation({
    onSuccess: (result) => {
      toast.success(`Đã chấp nhận ${result.accepted} mục.`);
      void utils.material.listPendingMatches.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  if (isLoading) {
    return (
      <div className="panel p-5 text-sm text-slate-600">
        <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
        Đang tải…
      </div>
    );
  }

  if (items.length === 0 && minConfidence === 0) {
    return (
      <div className="panel p-5">
        <EmptyState
          title="Không có mục chờ xét duyệt"
          description="Khi import sản phẩm từ shop scrape, các ứng viên ghép tương tự sẽ xuất hiện ở đây."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="match-confidence-filter" className="text-sm font-medium text-slate-700">
            Lọc độ tin cậy ≥
          </label>
          <input
            id="match-confidence-filter"
            type="range"
            min={0}
            max={100}
            step={5}
            value={minConfidence * 100}
            onChange={(e) => setMinConfidence(Number(e.target.value) / 100)}
            className="w-32 max-w-full"
          />
          <span className="w-10 text-sm text-slate-600 tabular-nums">
            {(minConfidence * 100).toFixed(0)}%
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
          <span className="text-sm text-slate-500">
            {total} mục chờ duyệt
          </span>
          <Button
            size="sm"
            onClick={() => bulkAcceptMutation.mutate({ minConfidence: 0.85 })}
            disabled={bulkAcceptMutation.isPending}
          >
            <CheckSquare className="mr-1 h-3.5 w-3.5" />
            Duyệt tất cả ≥ 85%
          </Button>
        </div>
      </div>

      <div className="panel divide-y divide-slate-100">
        {items.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">
            Không có mục nào đạt ngưỡng độ tin cậy đã chọn. Giảm bộ lọc để xem
            thêm.
          </div>
        ) : (
          items.map((item) => (
            <MatchRow
              key={item.id}
              item={item}
              onAccept={() =>
                acceptMutation.mutate({
                  decisionId: item.id,
                  materialId: item.matchedMaterialId!,
                })
              }
              onReject={() => rejectMutation.mutate({ decisionId: item.id })}
              isAccepting={acceptMutation.isPending}
              isRejecting={rejectMutation.isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MatchRow({
  item,
  onAccept,
  onReject,
  isAccepting,
  isRejecting,
}: {
  item: MatchDecisionRow;
  onAccept: () => void;
  onReject: () => void;
  isAccepting: boolean;
  isRejecting: boolean;
}) {
  const confidence = item.confidence;
  const topCandidate = (item.candidatesJson as Array<{
    materialId: number;
    name: string;
    unit: string;
    score: number;
  }>)[0];

  return (
    <div className="p-4 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={confidence} />
          <span className="text-xs text-slate-400">→</span>
        </div>
        <div className="text-sm">
          <span className="font-medium text-slate-800">
            {item.scrapedName || "(không có tên)"}
          </span>
          {item.scrapedUnit ? (
            <span className="ml-1.5 text-slate-500">
              ({item.scrapedUnit})
            </span>
          ) : null}
        </div>
        {item.scrapedSourceUrl ? (
          <a
            href={item.scrapedSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline truncate max-w-xs"
          >
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            {safeHostname(item.scrapedSourceUrl)}
          </a>
        ) : null}
        {topCandidate ? (
          <div className="mt-2 pl-3 border-l-2 border-slate-200">
            <div className="text-xs text-slate-500 mb-0.5">
              Ứng viên ghép:
            </div>
            <div className="text-sm text-slate-700">
              {topCandidate.name}
              <span className="ml-1.5 text-slate-400">
                ({topCandidate.unit})
              </span>
            </div>
          </div>
        ) : null}
        {item.reasoning ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.reasoning
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
              .map((signal, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600"
                >
                  {signal}
                </span>
              ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 shrink-0 pt-1">
        <Button
          size="sm"
          onClick={onAccept}
          disabled={isAccepting || !item.matchedMaterialId}
          title="Chấp nhận ghép"
          aria-label="Chấp nhận ghép"
          className="bg-green-600 text-white hover:bg-green-700"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={onReject}
          disabled={isRejecting}
          title="Từ chối, tạo vật tư mới"
          aria-label="Từ chối, tạo vật tư mới"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function confidenceColorClass(confidence: number): string {
  if (confidence >= 0.8) return "bg-green-50 text-green-700 border-green-200";
  if (confidence >= 0.6) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = (confidence * 100).toFixed(0);

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded border ${confidenceColorClass(confidence)}`}
    >
      {pct}%
    </span>
  );
}
