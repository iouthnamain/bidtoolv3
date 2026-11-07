import { describe, expect, it } from "vitest";

import { materialControlRouter } from "~/server/api/routers/material-control";

describe("material-control router", () => {
  it("exposes the chunk 3 project, location, plan, and requirement procedures", () => {
    const procedures = materialControlRouter._def.procedures;

    for (const procedure of [
      "createProject",
      "getProject",
      "listProjects",
      "updateProject",
      "deleteProject",
      "addProjectSource",
      "removeProjectSource",
      "createLocation",
      "listLocations",
      "updateLocation",
      "createPlan",
      "getPlan",
      "listPlans",
      "updatePlan",
      "deletePlan",
      "createRequirement",
      "getRequirement",
      "listRequirements",
      "updateRequirement",
      "deleteRequirement",
      "getPlanSummary",
      "dashboardSummary",
      "listPlanDetails",
      "getPlanDetail",
      "listStockBalances",
      "listShortages",
      "recordMovement",
      "recordTransfer",
      "reverseMovement",
      "listMovements",
      "createPurchaseCommitment",
      "getPurchaseCommitment",
      "listPurchaseCommitments",
      "createReservation",
      "listReservations",
      "releaseReservation",
      "createShipment",
      "getShipment",
      "listShipments",
      "dispatchShipment",
      "receiveShipment",
      "uploadDocument",
      "listDocuments",
      "getDocument",
      "downloadDocument",
      "deleteDocument",
    ]) {
      expect(procedures).toHaveProperty(procedure);
    }
  });
});
