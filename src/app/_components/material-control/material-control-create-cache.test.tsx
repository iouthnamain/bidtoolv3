import { QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import {
  createTRPCQueryUtils,
  createTRPCReact,
  getQueryKey,
} from "@trpc/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

import type { AppRouter } from "~/server/api/root";
import { createQueryClient } from "~/trpc/query-client";
import { MaterialControlPlanCreateForm } from "./material-control-plan-create-form";
import { MaterialControlProjectCreateClient } from "./material-control-project-create-client";
import { MaterialControlRequirementCreateForm } from "./material-control-requirement-create-form";

const mocks = vi.hoisted(() => {
  function mutation<T>() {
    return vi.fn((_: { onSuccess: (result: T) => void | Promise<void> }) => ({
      isPending: false,
    }));
  }
  return {
    createProject: mutation<{ id: number; status: "draft" }>(),
    createPlan: mutation<{ projectId: number; status: "draft" }>(),
    createRequirement: mutation<{ planId: number; requiredAt: null }>(),
    useUtils: vi.fn(),
    push: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("~/trpc/react", async () => {
  const { createTRPCReact } = await import("@trpc/react-query");
  const { materialControl } = createTRPCReact<AppRouter>();
  return {
    api: {
      useUtils: mocks.useUtils,
      materialControl: {
        listProjects: materialControl.listProjects,
        listPlanDetails: materialControl.listPlanDetails,
        dashboardSummary: materialControl.dashboardSummary,
        listShortages: materialControl.listShortages,
        getPlanDetail: materialControl.getPlanDetail,
        createProject: { useMutation: mocks.createProject },
        createPlan: { useMutation: mocks.createPlan },
        createRequirement: { useMutation: mocks.createRequirement },
      },
    },
  };
});

const api = createTRPCReact<AppRouter>();
const trpcClient = api.createClient({ links: [] });
const material = api.materialControl;
const projectId = 17;
const planId = 23;
const now = "2026-11-19T00:00:00Z";
let cache: ReturnType<typeof createQueryClient>;

function renderForm(component: ReactNode) {
  return renderToStaticMarkup(
    <QueryClientProvider client={cache}>{component}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cache = createQueryClient();
  mocks.useUtils.mockReturnValue(
    createTRPCQueryUtils({ client: trpcClient, queryClient: cache }),
  );
});

test("creating a project invalidates cached project lists and dashboard before redirecting", async () => {
  const affected = [
    getQueryKey(material.listProjects, { limit: 200 }, "query"),
    getQueryKey(
      material.listProjects,
      { status: "draft", keyword: "Ống" },
      "query",
    ),
    getQueryKey(material.dashboardSummary, undefined, "query"),
    getQueryKey(material.dashboardSummary, { now }, "query"),
    getQueryKey(material.dashboardSummary, { projectId, now }, "query"),
  ];
  const unaffected = [
    getQueryKey(material.listProjects, { status: "active" }, "query"),
    getQueryKey(material.dashboardSummary, { projectId: 1 }, "query"),
  ];
  for (const key of [...affected, ...unaffected]) cache.setQueryData(key, []);

  renderForm(<MaterialControlProjectCreateClient />);
  mocks.push.mockImplementationOnce(() => {
    for (const key of affected)
      expect(cache.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(
        true,
      );
  });
  await mocks.createProject.mock.lastCall?.[0].onSuccess({
    id: projectId,
    status: "draft",
  });

  expect(mocks.push).toHaveBeenCalledWith(
    `/material-control/projects/${projectId}`,
  );
  for (const key of unaffected)
    expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
});

test("creating a plan invalidates the plan lists and dashboard that include it", async () => {
  const affected = [
    getQueryKey(material.listPlanDetails, { projectId }, "query"),
    getQueryKey(material.listPlanDetails, { status: "draft", now }, "query"),
    getQueryKey(material.dashboardSummary, { projectId, now }, "query"),
    getQueryKey(material.dashboardSummary, undefined, "query"),
  ];
  const unaffected = [
    getQueryKey(material.listPlanDetails, { projectId: 1 }, "query"),
    getQueryKey(
      material.listPlanDetails,
      { projectId, status: "active" },
      "query",
    ),
    getQueryKey(material.dashboardSummary, { projectId: 1 }, "query"),
    getQueryKey(material.listShortages, { projectId }, "query"),
  ];
  for (const key of [...affected, ...unaffected]) cache.setQueryData(key, []);

  renderForm(<MaterialControlPlanCreateForm projectId={projectId} />);
  await mocks.createPlan.mock.lastCall?.[0].onSuccess({
    projectId,
    status: "draft",
  });

  for (const key of affected)
    expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of unaffected)
    expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
});

test("returning to a cached project after saving a requirement picks up the new count", async () => {
  let requirementCount = 0;
  const projectPlans = {
    queryKey: getQueryKey(material.listPlanDetails, { projectId }, "query"),
    queryFn: () => [{ requirements: Array.from({ length: requirementCount }) }],
  };
  const planDetail = {
    queryKey: getQueryKey(material.getPlanDetail, { planId }, "query"),
    queryFn: () => ({ plan: { projectId, requirementCount } }),
  };
  const affected = [
    getQueryKey(material.getPlanDetail, { planId, now }, "query"),
    getQueryKey(material.listPlanDetails, { projectId, now }, "query"),
    getQueryKey(material.listPlanDetails, undefined, "query"),
    getQueryKey(material.dashboardSummary, undefined, "query"),
    getQueryKey(material.dashboardSummary, { projectId, now }, "query"),
    getQueryKey(material.listShortages, { projectId, now }, "query"),
    getQueryKey(material.listShortages, undefined, "query"),
  ];
  const unaffected = [
    getQueryKey(material.getPlanDetail, { planId: 1 }, "query"),
    getQueryKey(material.listPlanDetails, { projectId: 1 }, "query"),
    getQueryKey(material.dashboardSummary, { projectId: 1 }, "query"),
    getQueryKey(material.listShortages, { projectId: 1 }, "query"),
    getQueryKey(material.listShortages, { projectId, lateOnly: true }, "query"),
    getQueryKey(material.listStockBalances, { projectId }, "query"),
  ];
  for (const key of [...affected, ...unaffected]) cache.setQueryData(key, []);

  const before = await cache.fetchQuery(projectPlans);
  expect(before[0]?.requirements).toHaveLength(0);

  const observer = new QueryObserver(cache, planDetail);
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await cache.fetchQuery(planDetail);
    renderForm(<MaterialControlRequirementCreateForm planId={planId} />);
    requirementCount = 1;
    await mocks.createRequirement.mock.lastCall?.[0].onSuccess({
      planId,
      requiredAt: null,
    });

    expect(observer.getCurrentResult().data?.plan.requirementCount).toBe(1);
    const after = await cache.fetchQuery(projectPlans);
    expect(after[0]?.requirements).toHaveLength(1);
    for (const key of affected)
      expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unaffected)
      expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
  } finally {
    unsubscribe();
  }
});

test.each(["project", "plan", "requirement"] as const)(
  "a pre-save list response cannot overwrite the cache after creating a %s",
  async (kind) => {
    const queryKey =
      kind === "project"
        ? getQueryKey(material.listProjects, { limit: 200 }, "query")
        : getQueryKey(material.listPlanDetails, { projectId }, "query");
    let finishBeforeSave: (rows: string[]) => void = () => undefined;
    const beforeSave = new Promise<string[]>((resolve) => {
      finishBeforeSave = resolve;
    });
    let saved = false;
    const queryFn = vi.fn(() => (saved ? ["new record"] : beforeSave));
    const opts = { queryKey, queryFn };
    const observer = new QueryObserver(cache, opts);
    const firstLoad = kind === "plan";
    if (!firstLoad) cache.setQueryData(queryKey, []);
    const unsubscribe = observer.subscribe(() => undefined);
    const refresh = firstLoad ? undefined : observer.refetch();
    if (!firstLoad) unsubscribe();
    try {
      expect(queryFn).toHaveBeenCalledTimes(1);
      saved = true;
      let onSuccess;
      if (kind === "project") {
        renderForm(<MaterialControlProjectCreateClient />);
        onSuccess = mocks.createProject.mock.lastCall?.[0].onSuccess({
          id: projectId,
          status: "draft",
        });
      } else if (kind === "plan") {
        renderForm(<MaterialControlPlanCreateForm projectId={projectId} />);
        onSuccess = mocks.createPlan.mock.lastCall?.[0].onSuccess({
          projectId,
          status: "draft",
        });
      } else {
        cache.setQueryData(
          getQueryKey(material.getPlanDetail, { planId }, "query"),
          {
            plan: { projectId },
          },
        );
        renderForm(<MaterialControlRequirementCreateForm planId={planId} />);
        onSuccess = mocks.createRequirement.mock.lastCall?.[0].onSuccess({
          planId,
          requiredAt: null,
        });
      }

      finishBeforeSave([]);
      await Promise.all([onSuccess, refresh]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await cache.fetchQuery(opts)).toEqual(["new record"]);
    } finally {
      unsubscribe();
    }
  },
);
