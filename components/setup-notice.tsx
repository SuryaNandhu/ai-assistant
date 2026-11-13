import { getMissingSupabaseEnv } from "@/lib/env";

/** Shown instead of a crash when the Supabase env vars are missing. */
export function SetupNotice() {
  const missing = getMissingSupabaseEnv();

  return (
    <div className="rounded-xl border border-border bg-muted p-5 text-sm">
      <p className="font-medium">Supabase is not configured yet.</p>
      <p className="mt-1 text-muted-foreground">
        Add these variables to{" "}
        <code className="font-mono text-xs">.env.local</code> (see{" "}
        <code className="font-mono text-xs">.env.example</code>) and restart the
        dev server.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 font-mono text-xs">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
