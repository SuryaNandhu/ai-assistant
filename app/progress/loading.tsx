export default function ProgressLoading() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold tracking-tight">AI Assistant</span>
          <span className="h-7 w-16 rounded-lg bg-muted" />
        </header>

        <div
          className="mx-auto w-full max-w-md animate-pulse px-4 pt-4 pb-6"
          aria-busy="true"
          aria-label="Loading progress"
        >
          <div className="h-8 w-32 rounded-lg bg-muted" />
          <div className="mt-2 h-4 w-52 rounded bg-muted" />

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="h-[86px] rounded-2xl border border-border bg-muted/60"
              />
            ))}
          </div>

          <div className="mt-5 h-3 w-28 rounded bg-muted" />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4].map((index) => (
              <div
                key={index}
                className="flex flex-col items-center gap-2"
              >
                <div className="h-[76px] w-[76px] rounded-full bg-muted/60" />
                <div className="h-3 w-14 rounded bg-muted" />
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-border p-3">
            <div className="mx-auto h-5 w-32 rounded bg-muted" />
            <div className="mt-4 grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, index) => (
                <div key={index} className="h-12 rounded-lg bg-muted/60" />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="h-14 shrink-0 border-t border-border" />
    </main>
  );
}
