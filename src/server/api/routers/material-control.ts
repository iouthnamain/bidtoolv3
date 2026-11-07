import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  requirePermission,
} from "~/server/api/trpc";
import {
  addProjectSource,
  createLocation,
  createPlan,
  createProject,
  deletePlan,
  deleteProject,
  listLocations,
  listPlans,
  listProjects,
  MaterialControlServiceError,
  getPlan,
  getProject,
  removeProjectSource,
  updateLocation,
  updatePlan,
  updateProject,
} from "~/server/services/material-control/project-service";
import {
  createRequirement,
  deleteRequirement,
  getPlanSummary,
  getRequirement,
  listRequirements,
  updateRequirement,
} from "~/server/services/material-control/requirement-service";
import { MaterialControlDomainError } from "~/server/services/material-control/types";
import {
  deleteMaterialControlDocument,
  getMaterialControlDocument,
  listMaterialControlDocuments,
  readMaterialControlDocument,
  uploadMaterialControlDocument,
} from "~/server/services/material-control/document-service";
import {
  getDashboardSummary,
  getPlanDetail,
  listPlanDetails,
  listShortages,
  listStockBalances,
} from "~/server/services/material-control/inventory-queries";
import {
  recordMovement,
  recordTransfer,
  reverseMovement,
} from "~/server/services/material-control/movement-service";

const positiveId = z.number().int().positive();
const nullablePositiveId = positiveId.nullable().optional();
const dateInput = z
  .union([z.string().trim().min(1), z.date()])
  .nullable()
  .optional()
  .refine(
    (value) =>
      value === undefined ||
      value === null ||
      !Number.isNaN(
        value instanceof Date ? value.getTime() : Date.parse(value),
      ),
    { message: "Ngày phải hợp lệ." },
  );
const quantityInput = z
  .number()
  .finite()
  .positive()
  .refine((value) => (value.toString().split(".")[1]?.length ?? 0) <= 3, {
    message: "Số lượng chỉ được có tối đa 3 chữ số thập phân.",
  });
const movementTypeInput = z.enum([
  "receipt",
  "shipment",
  "site_receipt",
  "installation",
  "return",
  "waste",
  "transfer_out",
  "transfer_in",
  "adjustment",
  "reversal",
]);
const movementQuantityInput = z
  .number()
  .finite()
  .refine((value) => (value.toString().split(".")[1]?.length ?? 0) <= 3, {
    message: "Số lượng chỉ được có tối đa 3 chữ số thập phân.",
  });
const movementInput = z
  .object({
    projectId: nullablePositiveId,
    movementType: movementTypeInput,
    quantity: movementQuantityInput,
    sourceLocationId: nullablePositiveId,
    destinationLocationId: nullablePositiveId,
    requirementId: nullablePositiveId,
    shipmentId: nullablePositiveId,
    reservationId: nullablePositiveId,
    materialId: positiveId.nullable().optional(),
    materialName: z.string().trim().min(1).max(500).optional(),
    specText: z.string().trim().max(5_000).optional(),
    unit: z.string().trim().min(1).max(50).optional(),
    occurredAt: dateInput,
    reversalOfId: nullablePositiveId,
    reference: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(5_000).optional(),
    explicitAdjustment: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.movementType === "adjustment" && value.explicitAdjustment) {
      if (value.quantity === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "Điều chỉnh phải khác 0.",
        });
      }
      return;
    }
    if (value.quantity <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Số lượng phải lớn hơn 0.",
      });
    }
  });

const sourceInput = z
  .object({
    sourceType: z.enum([
      "tender_package",
      "tender_plan",
      "investment_project",
      "manual",
    ]),
    tenderPackageId: positiveId.nullable().optional(),
    tenderPlanId: positiveId.nullable().optional(),
    investmentProjectId: positiveId.nullable().optional(),
    externalReference: z.string().trim().min(1).max(500).nullable().optional(),
    label: z.string().trim().max(200).optional(),
    sourceUrl: z.string().trim().url().nullable().optional(),
  })
  .superRefine((value, context) => {
    const ids = [
      value.tenderPackageId ?? null,
      value.tenderPlanId ?? null,
      value.investmentProjectId ?? null,
      value.externalReference ?? null,
    ].filter((item) => item !== null);
    const expected =
      value.sourceType === "manual"
        ? value.externalReference
        : value.sourceType === "tender_package"
          ? value.tenderPackageId
          : value.sourceType === "tender_plan"
            ? value.tenderPlanId
            : value.investmentProjectId;
    if (expected === undefined || expected === null || ids.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Liên kết nguồn phải có đúng một định danh phù hợp.",
        path: ["sourceType"],
      });
    }
  });

const projectStatus = z.enum([
  "draft",
  "active",
  "on_hold",
  "completed",
  "archived",
]);
const planStatus = z.enum(["draft", "active", "completed", "archived"]);
const requirementStatus = z.enum([
  "open",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
]);
const locationType = z.enum([
  "warehouse",
  "site",
  "zone",
  "transit",
  "installed",
  "waste",
  "virtual",
]);
const documentCategory = z.enum([
  "general",
  "requirement",
  "purchase",
  "shipment",
  "installation",
  "export",
]);

const projectFields = z.object({
  code: z.string().trim().max(120).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  status: projectStatus.optional(),
  description: z.string().trim().max(5_000).optional(),
  plannedStartAt: dateInput,
  plannedEndAt: dateInput,
  actualStartAt: dateInput,
  actualEndAt: dateInput,
  notes: z.string().trim().max(5_000).optional(),
  sources: z.array(sourceInput).max(100).optional(),
  sourceLinks: z.array(sourceInput).max(100).optional(),
});

const projectPatch = projectFields.partial().extend({
  id: positiveId,
});

function mapError(error: unknown): never {
  if (error instanceof MaterialControlServiceError) {
    throw error;
  }
  if (error instanceof MaterialControlDomainError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

async function callService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    mapError(error);
  }
}

export const materialControlRouter = createTRPCRouter({
  createProject: requirePermission("material:write")
    .input(projectFields)
    .mutation(({ ctx, input }) =>
      callService(() => createProject(input, ctx.db)),
    ),

  getProject: publicProcedure
    .input(z.object({ id: positiveId }))
    .query(({ ctx, input }) => callService(() => getProject(input.id, ctx.db))),

  listProjects: publicProcedure
    .input(
      z
        .object({
          status: projectStatus.optional(),
          keyword: z.string().trim().max(200).optional(),
          limit: z.number().int().positive().max(500).optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callService(() => listProjects(input ?? {}, ctx.db)),
    ),

  updateProject: requirePermission("material:write")
    .input(projectPatch)
    .mutation(({ ctx, input }) =>
      callService(() => updateProject(input, ctx.db)),
    ),

  deleteProject: requirePermission("material:write")
    .input(z.object({ id: positiveId }))
    .mutation(({ ctx, input }) =>
      callService(() => deleteProject(input.id, ctx.db)),
    ),

  addProjectSource: requirePermission("material:write")
    .input(z.object({ projectId: positiveId, source: sourceInput }))
    .mutation(({ ctx, input }) =>
      callService(() =>
        addProjectSource(input.projectId, input.source, ctx.db),
      ),
    ),

  removeProjectSource: requirePermission("material:write")
    .input(z.object({ projectId: positiveId, sourceId: positiveId }))
    .mutation(({ ctx, input }) =>
      callService(() =>
        removeProjectSource(input.projectId, input.sourceId, ctx.db),
      ),
    ),

  createLocation: requirePermission("material:write")
    .input(
      z.object({
        projectId: nullablePositiveId,
        parentId: nullablePositiveId,
        code: z.string().trim().min(1).max(120),
        name: z.string().trim().min(1).max(300),
        type: locationType,
        isVirtual: z.boolean().optional(),
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      callService(() => createLocation(input, ctx.db)),
    ),

  listLocations: publicProcedure
    .input(
      z
        .object({
          projectId: nullablePositiveId,
          parentId: nullablePositiveId,
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callService(() => listLocations(input ?? {}, ctx.db)),
    ),

  updateLocation: requirePermission("material:write")
    .input(
      z.object({
        id: positiveId,
        projectId: nullablePositiveId,
        parentId: nullablePositiveId,
        code: z.string().trim().min(1).max(120).optional(),
        name: z.string().trim().min(1).max(300).optional(),
        type: locationType.optional(),
        isVirtual: z.boolean().optional(),
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      callService(() => updateLocation(input, ctx.db)),
    ),

  createPlan: requirePermission("material:write")
    .input(
      z.object({
        projectId: positiveId,
        name: z.string().trim().min(1).max(300),
        status: planStatus.optional(),
        plannedStartAt: dateInput,
        plannedEndAt: dateInput,
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => callService(() => createPlan(input, ctx.db))),

  getPlan: publicProcedure
    .input(z.object({ id: positiveId }))
    .query(({ ctx, input }) => callService(() => getPlan(input.id, ctx.db))),

  listPlans: publicProcedure
    .input(
      z
        .object({
          projectId: positiveId.optional(),
          status: planStatus.optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callService(() => listPlans(input ?? {}, ctx.db)),
    ),

  updatePlan: requirePermission("material:write")
    .input(
      z.object({
        id: positiveId,
        name: z.string().trim().min(1).max(300).optional(),
        status: planStatus.optional(),
        plannedStartAt: dateInput,
        plannedEndAt: dateInput,
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => callService(() => updatePlan(input, ctx.db))),

  deletePlan: requirePermission("material:write")
    .input(z.object({ id: positiveId }))
    .mutation(({ ctx, input }) =>
      callService(() => deletePlan(input.id, ctx.db)),
    ),

  createRequirement: requirePermission("material:write")
    .input(
      z
        .object({
          planId: positiveId,
          materialId: positiveId.nullable().optional(),
          materialName: z.string().trim().min(1).max(500).optional(),
          specText: z.string().trim().max(5_000).optional(),
          unit: z.string().trim().min(1).max(50).optional(),
          quantity: quantityInput,
          requiredAt: dateInput,
          targetLocationId: nullablePositiveId,
          status: requirementStatus.optional(),
          notes: z.string().trim().max(5_000).optional(),
        })
        .superRefine((value, context) => {
          if (value.materialId == null) {
            for (const field of ["materialName", "specText", "unit"] as const) {
              if (value[field] === undefined) {
                context.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [field],
                  message: "Vật tư tạm thời cần tên, quy cách và đơn vị.",
                });
              }
            }
          }
        }),
    )
    .mutation(({ ctx, input }) =>
      callService(() => createRequirement(input, ctx.db)),
    ),

  getRequirement: publicProcedure
    .input(z.object({ id: positiveId }))
    .query(({ ctx, input }) =>
      callService(() => getRequirement(input.id, ctx.db)),
    ),

  listRequirements: publicProcedure
    .input(
      z.object({
        planId: positiveId,
        status: requirementStatus.optional(),
        keyword: z.string().trim().max(200).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      callService(() => listRequirements(input, ctx.db)),
    ),

  updateRequirement: requirePermission("material:write")
    .input(
      z.object({
        id: positiveId,
        materialId: positiveId.nullable().optional(),
        quantity: quantityInput.optional(),
        requiredAt: dateInput,
        targetLocationId: nullablePositiveId,
        status: requirementStatus.optional(),
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      callService(() => updateRequirement(input, ctx.db)),
    ),

  deleteRequirement: requirePermission("material:write")
    .input(z.object({ id: positiveId }))
    .mutation(({ ctx, input }) =>
      callService(() => deleteRequirement(input.id, ctx.db)),
    ),

  getPlanSummary: publicProcedure
    .input(z.object({ planId: positiveId }))
    .query(({ ctx, input }) =>
      callService(() => getPlanSummary(input.planId, ctx.db)),
    ),

  dashboardSummary: publicProcedure
    .input(
      z
        .object({
          projectId: positiveId.optional(),
          now: dateInput,
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callService(() => getDashboardSummary(input ?? {}, ctx.db)),
    ),

  listPlanDetails: publicProcedure
    .input(
      z
        .object({
          projectId: positiveId.optional(),
          status: planStatus.optional(),
          now: dateInput,
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callService(() => listPlanDetails(input ?? {}, ctx.db)),
    ),

  getPlanDetail: publicProcedure
    .input(z.object({ planId: positiveId, now: dateInput }))
    .query(({ ctx, input }) =>
      callService(() => getPlanDetail(input.planId, input, ctx.db)),
    ),

  listStockBalances: publicProcedure
    .input(
      z
        .object({
          projectId: positiveId.optional(),
          locationId: positiveId.optional(),
          materialId: positiveId.optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callService(() => listStockBalances(input ?? {}, ctx.db)),
    ),

  listShortages: publicProcedure
    .input(
      z
        .object({
          projectId: positiveId.optional(),
          lateOnly: z.boolean().optional(),
          now: dateInput,
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callService(() => listShortages(input ?? {}, ctx.db)),
    ),

  recordMovement: requirePermission("material:write")
    .input(movementInput)
    .mutation(({ ctx, input }) =>
      callService(() => recordMovement(input, ctx.db)),
    ),

  recordTransfer: requirePermission("material:write")
    .input(
      z.object({
        projectId: nullablePositiveId,
        requirementId: nullablePositiveId,
        materialId: positiveId.nullable().optional(),
        materialName: z.string().trim().min(1).max(500).optional(),
        specText: z.string().trim().max(5_000).optional(),
        unit: z.string().trim().min(1).max(50).optional(),
        quantity: quantityInput,
        sourceLocationId: positiveId,
        destinationLocationId: positiveId,
        occurredAt: dateInput,
        reference: z.string().trim().max(500).nullable().optional(),
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      callService(() => recordTransfer(input, ctx.db)),
    ),

  reverseMovement: requirePermission("material:write")
    .input(z.object({ movementId: positiveId }))
    .mutation(({ ctx, input }) =>
      callService(() => reverseMovement(input.movementId, ctx.db)),
    ),

  uploadDocument: requirePermission("material:write")
    .input(
      z.object({
        projectId: positiveId,
        category: documentCategory.optional(),
        fileName: z.string().trim().min(1).max(500),
        fileBase64: z.string().min(1).max(70_000_000),
        mimeType: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      callService(() => uploadMaterialControlDocument(input, ctx.db)),
    ),

  listDocuments: publicProcedure
    .input(
      z.object({
        projectId: positiveId,
        category: documentCategory.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      callService(() => listMaterialControlDocuments(input, ctx.db)),
    ),

  getDocument: publicProcedure
    .input(z.object({ id: positiveId }))
    .query(({ ctx, input }) =>
      callService(() => getMaterialControlDocument(input.id, ctx.db)),
    ),

  downloadDocument: publicProcedure
    .input(z.object({ id: positiveId }))
    .query(({ ctx, input }) =>
      callService(() => readMaterialControlDocument(input.id, ctx.db)),
    ),

  deleteDocument: requirePermission("material:write")
    .input(z.object({ id: positiveId }))
    .mutation(({ ctx, input }) =>
      callService(() => deleteMaterialControlDocument(input.id, ctx.db)),
    ),
});
