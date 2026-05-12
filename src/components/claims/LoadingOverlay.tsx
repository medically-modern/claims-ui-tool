// Centered overlay shown during the initial Monday fetch on the Primary
// Board. Hidden during in-place refetches (the user knows they clicked
// Refresh; no need to obscure the page).

import { Loader2 } from "lucide-react";

interface Props {
  /** Optional label under the spinner. Defaults to a generic "Loading…". */
  label?: string;
}

export function LoadingOverlay({ label = "Loading claims from Monday…" }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background px-6 py-5 shadow-lg">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
