import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Stethoscope } from "lucide-react";

export function AppHeader({
  title,
  subtitle,
  showBack,
}: {
  title: string;
  /** Plain string or JSX — ClaimDetail passes spans with `select-all`
   *  so double-clicking DOB / DOS / Member ID grabs just that value. */
  subtitle?: React.ReactNode;
  showBack?: boolean;
}) {
  return (
    // Phone: title stays on one line, subtitle hides, buttons collapse to
    // icons (labels return from the sm breakpoint up).
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-3 px-4 py-3 sm:items-start sm:gap-6 sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:items-start">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground sm:mt-1">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {showBack && (
                <Link to="/claims" className="shrink-0 text-sm text-muted-foreground hover:text-foreground">
                  ← Queue
                </Link>
              )}
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
            </div>
            {subtitle && <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Refresh">
            <RefreshCw className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" aria-label="Open Monday Board">
            <ExternalLink className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Open Monday Board</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
