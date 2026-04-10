"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
      <h2 className="text-base font-semibold">Có lỗi xảy ra trong dashboard</h2>
      <p className="mt-2 text-sm">{error.message || "Vui lòng thử lại."}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-3 rounded-md bg-rose-700 px-3 py-1.5 text-sm font-medium text-white"
      >
        Thử lại
      </button>
    </div>
  );
}
