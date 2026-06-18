import { HydrateClient, api } from "~/trpc/server";
import { PortalHomeClient } from "~/app/_components/portal/portal-home-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cổng khách hàng",
  description: "Trang tổng quan chỉ đọc dành cho khách hàng.",
};

/**
 * Customer portal home. Follows the app's dominant RSC pattern: prefetch the
 * tenant-scoped read queries on the server, then hand the dehydrated cache to a
 * client component that renders them via `useQuery`. Inputs here must match the
 * client's `useQuery` inputs exactly so the prefetched cache is reused.
 *
 * Layout (src/app/(portal)/layout.tsx) already guarantees only an authenticated
 * `customer` reaches this page, so no extra guard is needed here.
 */
function prefetchPortalData() {
  void api.notification.unreadCount.prefetch();
  void api.notification.list.prefetch({ limit: 5 });
  void api.excelResearch.listJobs.prefetch({ limit: 5 });
  void api.materialEnrichment.listMaterialEnrichmentJobs.prefetch({ limit: 5 });
  void api.watchlist.listItems.prefetch({});
  void api.search.listSavedFilters.prefetch();
}

export default function PortalHomePage() {
  prefetchPortalData();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-950">
          Xin chào
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Đây là tổng quan dữ liệu của bạn. Trang này chỉ để xem.
        </p>
      </div>

      <HydrateClient>
        <PortalHomeClient />
      </HydrateClient>
    </div>
  );
}
