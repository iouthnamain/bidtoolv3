import { QueryObserver } from "@tanstack/react-query";
import {
  createTRPCQueryUtils,
  createTRPCReact,
  getQueryKey,
} from "@trpc/react-query";
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
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: mocks.useUtils,
    materialControl: {
      createProject: { useMutation: mocks.createProject },
      createPlan: { useMutation: mocks.createPlan },
      createRequirement: { useMutation: mocks.createRequirement },
    },
  },
}));

const api = createTRPCReact<AppRouter>();
const trpcClient = api.createClient({ links: [] });
const material = api.materialControl;
const projectId = 17;
const planId = 23;
const now = "2026-11-19T00:00:00Z";
let cache: ReturnType<typeof createQueryClient>;

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

  renderToStaticMarkup(<MaterialControlProjectCreateClient />);
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

  renderToStaticMarkup(<MaterialControlPlanCreateForm projectId={projectId} />);
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
    renderToStaticMarkup(
      <MaterialControlRequirementCreateForm planId={planId} />,
    );
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
