import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLink, RefreshCw, Stethoscope } from "lucide-react";

/**
 * One entry in the banner nav. The banner switches between the tools the app
 * contains (Claims · Ordering · Financials) — three different jobs, so the
 * switch lives in the chrome, not in a tab row inside the page (Brandon,
 * 2026-09-20, after the Command Center redesign).
 */
export interface HeaderNavItem<V extends string = string> {
  value: V;
  label: string;
  /** Phone label when the full one is too long. */
  shortLabel?: string;
}

export function AppHeader<V extends string = string>({
  title,
  subtitle,
  showBack,
  nav,
  mondayBoardUrl,
  onRefresh,
}: {
  title: string;
  /** Plain string or JSX — ClaimDetail passes spans with `select-all`
   *  so double-clicking DOB / DOS / Member ID grabs just that value. */
  subtitle?: React.ReactNode;
  showBack?: boolean;
  /** Tool switcher rendered in the banner. */
  nav?: { items: HeaderNavItem<V>[]; value: V; onChange: (v: V) => void };
  /** Where "Open Monday Board" goes — the board behind the tool on screen. */
  mondayBoardUrl?: string;
  /** Refresh handler; the default re-reads every query on the page. */
  onRefresh?: () => void;
}) {
  const queryClient = useQueryClient();
  const refresh = onRefresh ?? (() => void queryClient.invalidateQueries());
  return (
    // Phone: title stays on one line, subtitle hides, buttons collapse to
    // icons (labels return from the sm breakpoint up), nav drops to its own row.
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
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
            {subtitle && <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{subtitle}</p>}
          </div>
        </div>

        {nav && (
          <nav aria-label="Tools" className="order-last -mb-3 flex w-full items-end gap-1 overflow-x-auto sm:order-none sm:-my-4 sm:w-auto sm:self-stretch sm:pl-2">
            {nav.items.map((it) => {
              const active = it.value === nav.value;
              return (
                <button
                  key={it.value}
                  type="button"
                  onClick={() => nav.onChange(it.value)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative whitespace-nowrap px-3 py-3 text-[14px] font-semibold transition-colors sm:py-5",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {it.shortLabel ? (<><span className="sm:hidden">{it.shortLabel}</span><span className="hidden sm:inline">{it.label}</span></>) : it.label}
                  <span aria-hidden className={cn("absolute inset-x-3 bottom-0 h-0.5 rounded-full", active ? "bg-primary" : "bg-transparent")} />
                </button>
              );
            })}
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Refresh" onClick={refresh} title="Re-read everything on this page from Monday">
            <RefreshCw className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" aria-label="Open Monday Board" asChild={!!mondayBoardUrl} disabled={!mondayBoardUrl}>
            {mondayBoardUrl ? (
              <a href={mondayBoardUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Open Monday Board</span>
              </a>
            ) : (
              <span><ExternalLink className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Open Monday Board</span></span>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
