import { db } from "~/server/db";
import {
  notifications,
  savedFilters,
  tenderPackages,
  watchlistItems,
  workflowRuns,
  workflows,
} from "~/server/db/schema";

async function seed() {
  if (process.env.ENABLE_DEMO_SEED !== "true") {
    console.log(
      "Bo qua seed du lieu demo. Dat ENABLE_DEMO_SEED=true neu can seed mau.",
    );
    return;
  }

  await db
    .insert(tenderPackages)
    .values([
      {
        id: 1,
        title: "Cung cap vat tu y te tuyen huyen",
        inviter: "Benh vien Da khoa tinh A",
        province: "Ha Noi",
        category: "Y te",
        budget: 2_400_000_000,
        publishedAt: "2026-04-08",
        matchScore: 88,
      },
      {
        id: 2,
        title: "Mua sam thiet bi mang cho truong hoc",
        inviter: "So Giao duc tinh B",
        province: "Da Nang",
        category: "CNTT",
        budget: 1_350_000_000,
        publishedAt: "2026-04-07",
        matchScore: 81,
      },
      {
        id: 3,
        title: "Thi cong cai tao ha tang giao thong noi thi",
        inviter: "Ban QLDA thanh pho C",
        province: "Ho Chi Minh",
        category: "Xay dung",
        budget: 9_600_000_000,
        publishedAt: "2026-04-06",
        matchScore: 74,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(savedFilters)
    .values({
      id: 1,
      name: "Goi CNTT mien Trung",
      keyword: "thiet bi mang",
      provinces: ["Da Nang"],
      categories: ["CNTT"],
      budgetMin: 500_000_000,
      budgetMax: 3_000_000_000,
      notificationFrequency: "daily",
      createdAt: "2026-04-01T08:00:00.000Z",
    })
    .onConflictDoNothing();

  await db
    .insert(watchlistItems)
    .values({
      id: 1,
      type: "inviter",
      refKey: "so-gd-b",
      label: "So Giao duc tinh B",
      createdAt: "2026-04-02T09:30:00.000Z",
    })
    .onConflictDoNothing();

  await db
    .insert(workflows)
    .values({
      id: 1,
      name: "Canh bao goi CNTT moi",
      triggerType: "new_package",
      triggerConfig: { filterId: 1 },
      actionType: "in_app",
      actionConfig: { severity: "medium" },
      isActive: true,
      createdAt: "2026-04-01T07:00:00.000Z",
      updatedAt: "2026-04-08T07:00:00.000Z",
    })
    .onConflictDoNothing();

  await db
    .insert(workflowRuns)
    .values({
      id: 1,
      workflowId: 1,
      status: "success",
      startedAt: "2026-04-08T09:00:00.000Z",
      finishedAt: "2026-04-08T09:00:03.000Z",
      message: "Da tao 2 canh bao phu hop",
    })
    .onConflictDoNothing();

  await db
    .insert(notifications)
    .values({
      id: 1,
      channel: "in_app",
      title: "Co goi thau moi phu hop",
      body: "Phat hien 1 goi CNTT tai Da Nang, ngan sach 1.35 ty.",
      severity: "medium",
      isRead: false,
      createdAt: "2026-04-08T09:00:04.000Z",
    })
    .onConflictDoNothing();
}

seed()
  .then(() => {
    console.log("Seed completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  });
