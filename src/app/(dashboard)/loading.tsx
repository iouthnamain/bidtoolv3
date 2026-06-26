import { PageSkeleton } from "~/app/_components/ui";

export default function DashboardGroupLoading() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6">
      <PageSkeleton />
    </div>
  );
}
