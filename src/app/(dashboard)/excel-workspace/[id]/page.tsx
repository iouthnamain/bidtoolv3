import { notFound, redirect } from "next/navigation";

import {
  excelWorkspaceSteps,
  isExcelWorkspaceStepAccessible,
  type ExcelWorkspaceStepId,
} from "~/lib/excel-workspace-steps";
import { ExcelWorkspaceWizardClient } from "~/app/_components/excel-workspace/workspace-wizard-client";
import { HydrateClient, api } from "~/trpc/server";

export const dynamic = "force-dynamic";

type ExcelWorkspaceDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
};

function prefetchExcelWorkspaceDetailStepData(
  workspaceId: number,
  step: ExcelWorkspaceStepId,
) {
  if (step === "import") {
    void api.excelWorkspace.previewWorkbookSheets.prefetch({ workspaceId });
  }

  if (step === "export") {
    void api.excelWorkspace.validateWorkspaceForExport.prefetch({
      workspaceId,
    });
  }
}

export default async function ExcelWorkspaceDetailPage({
  params,
  searchParams,
}: ExcelWorkspaceDetailPageProps) {
  const { id } = await params;
  const { step } = await searchParams;
  const workspaceId = Number.parseInt(id, 10);

  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    notFound();
  }

  const initialData = await api.excelWorkspace
    .getWorkspace({ id: workspaceId })
    .catch(() => null);

  if (!initialData) {
    notFound();
  }

  const requestedStep = excelWorkspaceSteps.includes(
    step as ExcelWorkspaceStepId,
  )
    ? (step as ExcelWorkspaceStepId)
    : null;

  if (
    !requestedStep ||
    !isExcelWorkspaceStepAccessible(
      requestedStep,
      initialData.routeMeta.maxStep,
    )
  ) {
    redirect(
      `/excel-workspace/${workspaceId}?step=${initialData.routeMeta.nextStep}`,
    );
  }

  prefetchExcelWorkspaceDetailStepData(workspaceId, requestedStep);

  return (
    <HydrateClient>
      <ExcelWorkspaceWizardClient
        workspaceId={workspaceId}
        initialData={initialData}
      />
    </HydrateClient>
  );
}
