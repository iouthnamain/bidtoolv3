import { PageSkeleton } from "~/app/_components/ui";

export default function DashboardGroupLoading() {
  return (
    <div className="dashboard-content min-w-0 py-6">
      <PageSkeleton />
    </div>
  );
}
