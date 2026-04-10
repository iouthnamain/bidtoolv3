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
    <section className="space-y-4">
      <header className="rounded-lg border border-cyan-200/50 bg-gradient-to-r from-cyan-900 via-sky-850 to-teal-900 p-4 text-white shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-cyan-200">BidTool Workspace</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-xs sm:text-sm text-cyan-50/80">{description}</p>
      </header>

      <div>{children}</div>
    </section>
  );
}
