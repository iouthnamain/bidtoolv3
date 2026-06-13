"use client";

import { useEffect, useState } from "react";

import { Button } from "~/app/_components/ui";
import { parseCsvList } from "~/lib/search-criteria";
import { SEARCH_MODE_LABELS, type SearchMode } from "~/lib/search-modes";
import { normalizeWorkflowFilterConfig } from "~/lib/workflow-config";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkflowDetail = NonNullable<RouterOutputs["workflow"]["getById"]>;

function parseIntegerCsvList(value: string) {
  return parseCsvList(value)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function joinList(values: string[]) {
  return values.join(", ");
}

function joinIntegerList(values: number[]) {
  return values.join(", ");
}

export function WorkflowDetailEditClient({
  workflowId,
  initialWorkflow,
}: {
  workflowId: number;
  initialWorkflow: WorkflowDetail;
}) {
  const workflowQuery = api.workflow.getById.useQuery(
    { id: workflowId },
    { initialData: initialWorkflow },
  );
  const utils = api.useUtils();
  const workflow = workflowQuery.data;
  const initialFilterConfig = normalizeWorkflowFilterConfig(
    initialWorkflow.triggerConfig,
  );

  const [name, setName] = useState(initialWorkflow.name);
  const [triggerType, setTriggerType] = useState(initialWorkflow.triggerType);
  const [isActive, setIsActive] = useState(initialWorkflow.isActive);
  const [searchMode, setSearchMode] = useState<SearchMode>(
    initialFilterConfig.searchMode,
  );
  const [keyword, setKeyword] = useState(initialFilterConfig.criteria.keyword);
  const [provinces, setProvinces] = useState(
    joinList(initialFilterConfig.criteria.provinces),
  );
  const [packageCategories, setPackageCategories] = useState(
    joinList(initialFilterConfig.criteria.packageCategories),
  );
  const [classifyIds, setClassifyIds] = useState(
    joinIntegerList(initialFilterConfig.criteria.classifyIds),
  );
  const [planFields, setPlanFields] = useState(
    joinList(initialFilterConfig.criteria.planFields),
  );
  const [procurementMethods, setProcurementMethods] = useState(
    joinList(initialFilterConfig.criteria.procurementMethods),
  );
  const [projectGroups, setProjectGroups] = useState(
    joinList(initialFilterConfig.criteria.projectGroups),
  );
  const [budgetMin, setBudgetMin] = useState(
    initialFilterConfig.criteria.budgetMin?.toString() ?? "",
  );
  const [budgetMax, setBudgetMax] = useState(
    initialFilterConfig.criteria.budgetMax?.toString() ?? "",
  );
  const [publishedFrom, setPublishedFrom] = useState(
    initialFilterConfig.criteria.publishedFrom,
  );
  const [publishedTo, setPublishedTo] = useState(
    initialFilterConfig.criteria.publishedTo,
  );
  const [minMatchScore, setMinMatchScore] = useState(
    String(initialFilterConfig.criteria.minMatchScore),
  );

  useEffect(() => {
    if (!workflow) {
      return;
    }

    const filterConfig = normalizeWorkflowFilterConfig(workflow.triggerConfig);
    setName(workflow.name);
    setTriggerType(workflow.triggerType);
    setIsActive(workflow.isActive);
    setSearchMode(filterConfig.searchMode);
    setKeyword(filterConfig.criteria.keyword);
    setProvinces(joinList(filterConfig.criteria.provinces));
    setPackageCategories(joinList(filterConfig.criteria.packageCategories));
    setClassifyIds(joinIntegerList(filterConfig.criteria.classifyIds));
    setPlanFields(joinList(filterConfig.criteria.planFields));
    setProcurementMethods(joinList(filterConfig.criteria.procurementMethods));
    setProjectGroups(joinList(filterConfig.criteria.projectGroups));
    setBudgetMin(filterConfig.criteria.budgetMin?.toString() ?? "");
    setBudgetMax(filterConfig.criteria.budgetMax?.toString() ?? "");
    setPublishedFrom(filterConfig.criteria.publishedFrom);
    setPublishedTo(filterConfig.criteria.publishedTo);
    setMinMatchScore(String(filterConfig.criteria.minMatchScore));
  }, [workflow]);

  const updateWorkflow = api.workflow.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workflow.getById.invalidate({ id: workflowId }),
        utils.workflow.list.invalidate(),
      ]);
    },
  });

  if (!workflow) {
    return null;
  }

  const filterConfig = normalizeWorkflowFilterConfig(workflow.triggerConfig);

  return (
    <section className="panel p-4">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-sm font-bold">Chỉnh sửa workflow</h2>
        <p className="mt-1 text-xs text-slate-500">
          Form này giữ nguyên trigger type cũ nếu cần, nhưng criteria đã dùng
          chung cho đủ 5 chế độ tìm kiếm.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Tên workflow</span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Loại trigger</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2"
            value={triggerType}
            onChange={(event) =>
              setTriggerType(event.target.value as typeof triggerType)
            }
          >
            <option value="new_search_result">Kết quả tìm kiếm mới</option>
            <option value="new_package">Gói thầu mới</option>
            <option value="schedule">Theo lịch</option>
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Chế độ tìm kiếm</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2"
            value={searchMode}
            onChange={(event) =>
              setSearchMode(event.target.value as SearchMode)
            }
          >
            {(Object.keys(SEARCH_MODE_LABELS) as SearchMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {SEARCH_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Match tối thiểu</span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={minMatchScore}
            onChange={(event) => setMinMatchScore(event.target.value)}
            type="number"
            min={0}
            max={100}
          />
        </label>

        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="font-medium text-slate-700">Từ khóa</span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="ví dụ: thiết bị mạng, vật tư y tế"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">
            Tỉnh / thành (phân tách dấu phẩy)
          </span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={provinces}
            onChange={(event) => setProvinces(event.target.value)}
            placeholder="Đà Nẵng, Hà Nội"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">
            Lĩnh vực gói (phân tách dấu phẩy)
          </span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={packageCategories}
            onChange={(event) => setPackageCategories(event.target.value)}
            placeholder="Y tế, Công nghệ thông tin"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">
            Classify ID (phân tách dấu phẩy)
          </span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={classifyIds}
            onChange={(event) => setClassifyIds(event.target.value)}
            placeholder="1, 12, 145"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">
            Lĩnh vực KHLCNT (phân tách dấu phẩy)
          </span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={planFields}
            onChange={(event) => setPlanFields(event.target.value)}
            placeholder="Xây dựng, Y tế"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">
            HTLCNT (phân tách dấu phẩy)
          </span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={procurementMethods}
            onChange={(event) => setProcurementMethods(event.target.value)}
            placeholder="Đấu thầu rộng rãi"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">
            Nhóm dự án (phân tách dấu phẩy)
          </span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={projectGroups}
            onChange={(event) => setProjectGroups(event.target.value)}
            placeholder="Nhóm A, Nhóm B"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Ngân sách từ</span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={budgetMin}
            onChange={(event) => setBudgetMin(event.target.value)}
            type="number"
            min={0}
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Ngân sách đến</span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={budgetMax}
            onChange={(event) => setBudgetMax(event.target.value)}
            type="number"
            min={0}
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Ngày từ</span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            type="date"
            value={publishedFrom}
            onChange={(event) => setPublishedFrom(event.target.value)}
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-slate-700">Ngày đến</span>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            type="date"
            value={publishedTo}
            onChange={(event) => setPublishedTo(event.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <span className="font-medium text-slate-700">
            Giữ workflow ở trạng thái hoạt động sau khi lưu
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          isLoading={updateWorkflow.isPending}
          onClick={() =>
            updateWorkflow.mutate({
              id: workflow.id,
              name: name.trim(),
              triggerType,
              isActive,
              triggerConfig: {
                searchMode,
                savedFilterId: filterConfig.savedFilterId,
                savedFilterName: filterConfig.savedFilterName,
                notificationFrequency: filterConfig.notificationFrequency,
                criteria: {
                  keyword: keyword.trim(),
                  provinces: parseCsvList(provinces),
                  packageCategories: parseCsvList(packageCategories),
                  classifyIds: parseIntegerCsvList(classifyIds),
                  planFields: parseCsvList(planFields),
                  procurementMethods: parseCsvList(procurementMethods),
                  projectGroups: parseCsvList(projectGroups),
                  budgetMin: budgetMin.trim() ? Number(budgetMin) : null,
                  budgetMax: budgetMax.trim() ? Number(budgetMax) : null,
                  publishedFrom: publishedFrom.trim() || undefined,
                  publishedTo: publishedTo.trim() || undefined,
                  minMatchScore: minMatchScore.trim()
                    ? Number(minMatchScore)
                    : 0,
                },
              },
            })
          }
        >
          Lưu thay đổi
        </Button>
      </div>
    </section>
  );
}
