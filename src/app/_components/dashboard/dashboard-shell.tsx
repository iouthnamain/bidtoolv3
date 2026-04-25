export function DashboardShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="rounded-2xl border border-cyan-200/40 bg-gradient-to-r from-cyan-900 via-sky-900 to-teal-900 px-4 py-4 text-white shadow-sm sm:px-5">
        <p className="text-xs font-semibold tracking-[0.18em] text-cyan-100/95 uppercase">
          Không gian BidTool
        </p>
        <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-4xl text-xs text-cyan-50/90 sm:text-sm">
          {description}
        </p>
      </header>

      <div>{children}</div>
    </section>
  );
}
