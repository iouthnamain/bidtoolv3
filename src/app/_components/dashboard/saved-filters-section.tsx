"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Edit3,
  ExternalLink,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import {
  buildSearchHref,
  summarizeSearchCriteria,
} from "~/lib/search-criteria";
import { SEARCH_MODE_LABELS } from "~/lib/search-modes";
import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { type RouterOutputs, api } from "~/trpc/react";

type SavedFilterItem = RouterOutputs["search"]["listSavedFilters"][number];
type SavedFilterNotificationFrequency =
  SavedFilterItem["notificationFrequency"];

const notificationFrequencyLabels: Record<
  SavedFilterNotificationFrequency,
  string
> = {
  daily: "Hằng ngày",
  weekly: "Hằng tuần",
};

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Thời điểm không hợp lệ";
  }

  return dateTimeFormatter.format(parsed);
}

export function buildSavedFilterHref(
  filter: {
    mode: SavedFilterItem["mode"];
    criteria: SavedFilterItem["criteria"];
  },
  options?: {
    savedFilterId?: number;
  },
) {
  return buildSearchHref({
    mode: filter.mode,
    criteria: filter.criteria,
    savedFilterId: options?.savedFilterId ?? null,
  });
}

function renderCriteriaList(filter: {
  mode: SavedFilterItem["mode"];
  criteria: SavedFilterItem["criteria"];
}) {
  return summarizeSearchCriteria(filter.mode, filter.criteria);
}

function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded border border-slate-400 bg-slate-50 px-3 py-4 text-sm text-slate-600">
      {message}
    </div>
  );
}

export function SavedFiltersSection() {
  const router = useRouter();
  const utils = api.useUtils();
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedFilterItem | null>(
    null,
  );
  const savedFiltersQuery = api.search.listSavedFilters.useQuery(undefined, {
    retry: false,
  });

  const deleteSavedFilter = api.search.deleteSavedFilter.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setDeleteTarget(null);
      toast.success("Đã xóa bộ lọc thông minh.");
      await utils.search.listSavedFilters.invalidate();
    },
    onError: (error) => {
      const message = error.message || "Không thể xóa bộ lọc thông minh.";
      setActionError(message);
      toast.error(message);
      setDeleteTarget(null);
    },
  });

  const createWorkflow = api.workflow.createFromSavedFilter.useMutation({
    onSuccess: async (workflow) => {
      setActionError(null);
      toast.success("Đã tạo workflow từ bộ lọc thông minh.");
      await Promise.all([utils.workflow.list.invalidate()]);
      if (workflow) {
        router.push(`/workflows/${workflow.id}`);
      }
    },
    onError: (error) => {
      const message =
        error.message || "Không thể tạo workflow từ bộ lọc thông minh hiện tại.";
      setActionError(message);
      toast.error(message);
    },
  });

  const savedFilters = savedFiltersQuery.data ?? [];

  const handleDeleteSavedFilter = (filter: SavedFilterItem) => {
    setDeleteTarget(filter);
  };

  return (
    <div className="">
    <section className="panel p-2">
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Xóa bộ lọc thông minh "${deleteTarget?.name ?? ""}"?`}
        description="Workflow đã tạo từ bộ lọc thông minh này vẫn được giữ nguyên và không bị thay đổi."
        confirmLabel="Xóa"
        variant="danger"
        isLoading={deleteSavedFilter.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteSavedFilter.mutate({ id: deleteTarget.id });
        }}
        onCancel={() => setDeleteTarget(null)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-400 pb-3">
        <div>
          <h2 className="text-sm font-bold">Bộ lọc thông minh</h2>
          <p className="mt-1 text-xs text-slate-700">
            Quản lý bộ lọc đã lưu, mở lại vào trang tìm kiếm để chỉnh sửa và tạo
            workflow cảnh báo mới.
          </p>
        </div>
        <Badge count={savedFilters.length} className="stat-value font-extrabold" />
      </div>

      <div className="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-800">
        Workflow tạo từ bộ lọc thông minh sẽ sao chép điều kiện tại thời điểm tạo.
        Chỉnh sửa hoặc xóa bộ lọc thông minh không làm thay đổi workflow đã có.
      </div>

      {actionError ? (
        <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </div>
      ) : null}

      {savedFiltersQuery.isPending ? (
        <LoadingPanel message="Đang tải bộ lọc thông minh…" />
      ) : savedFiltersQuery.error ? (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="font-semibold">Không tải được bộ lọc thông minh</p>
          <p className="mt-1 text-xs leading-relaxed">
            {savedFiltersQuery.error.message}
          </p>
          <p className="mt-2 text-xs text-amber-800">
            Nếu bạn vừa pull code mới, hãy chạy `bun run db:migrate` rồi tải lại
            trang này.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => savedFiltersQuery.refetch()}
            >
              Thử lại
            </Button>
            <Link
              href="/search/packages"
              className="inline-flex items-center justify-center gap-1.5 rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 transition-colors duration-0 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              Mở trang Tìm kiếm
            </Link>
          </div>
        </div>
      ) : savedFilters.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="Chưa có bộ lọc thông minh nào"
          description="Tạo bộ lọc trong trang Tìm kiếm để lưu lại điều kiện thường dùng và dùng lại sau này."
          cta={
            <Link
              href="/search/packages"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition-colors duration-0 hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Search className="h-4 w-4" aria-hidden />
              Đến trang Tìm kiếm
            </Link>
          }
        />
      ) : (
        <ul className="mt-3 space-y-3">
          {savedFilters.map((filter) => {
            const criteria = renderCriteriaList(filter);
            const workflowCreateLoading =
              createWorkflow.isPending &&
              createWorkflow.variables?.savedFilterId === filter.id;
            const deleteLoading =
              deleteSavedFilter.isPending &&
              deleteSavedFilter.variables?.id === filter.id;
            const hasBeenEdited = filter.updatedAt !== filter.createdAt;

            return (
              <li
                key={filter.id}
                className="rounded border border-slate-400 bg-slate-50/70 p-4 transition-colors duration-0 hover:bg-slate-100/80 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm leading-tight font-semibold [overflow-wrap:anywhere] text-slate-900">
                        {filter.name}
                      </p>
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        {SEARCH_MODE_LABELS[filter.mode]}
                      </span>
                      <span className="rounded-full border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {
                          notificationFrequencyLabels[
                            filter.notificationFrequency
                          ]
                        }
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700">
                      <span>ID #{filter.id}</span>
                      <span>Tạo {formatDateTime(filter.createdAt)}</span>
                      <span>
                        {hasBeenEdited
                          ? `Cập nhật ${formatDateTime(filter.updatedAt)}`
                          : "Chưa chỉnh sửa sau khi tạo"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {criteria.map((chip) => (
                    <span
                      key={`${filter.id}-${chip}`}
                      className="inline-flex rounded-full border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-1 text-xs font-medium text-slate-600"
                    >
                      {chip}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={buildSavedFilterHref(filter)}
                    className="inline-flex items-center justify-center gap-1.5 rounded bg-blue-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors duration-0 hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    Áp dụng
                  </Link>
                  <Link
                    href={buildSavedFilterHref(filter, {
                      savedFilterId: filter.id,
                    })}
                    className="inline-flex items-center justify-center gap-1.5 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden />
                    Chỉnh sửa
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={workflowCreateLoading}
                    leftIcon={<Play className="h-3.5 w-3.5" />}
                    onClick={() =>
                      createWorkflow.mutate({ savedFilterId: filter.id })
                    }
                  >
                    Tạo workflow
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={deleteLoading}
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => handleDeleteSavedFilter(filter)}
                  >
                    Xóa
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
    </div>
  );
}
