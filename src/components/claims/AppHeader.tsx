import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Stethoscope, type LucideIcon } from "lucide-react";

/**
 * One entry in the banner nav. The banner switches between the tools the app
 * contains (Claims · Ordering · Financials) — three different jobs, so the
 * switch lives in the chrome, not in a tab row inside the page (Brandon,
 * 2026-09-20, after the Command Center redesign: a coloured banner, the
 * tools as icon + label, nothing else in it).
 */
export interface HeaderNavItem<V extends string = string> {
  value: V;
  label: string;
  icon?: LucideIcon;
  /** Phone label when the full one is too long. */
  shortLabel?: string;
}

/** Medically Modern green — the banner colour. */
export const BRAND_BG = "bg-[#0f5c47]";

export function AppHeader<V extends string = string>({
  title,
  subtitle,
  showBack,
  nav,
}: {
  title: string;
  /** Plain string or JSX — ClaimDetail passes spans with `select-all`
   *  so double-clicking DOB / DOS / Member ID grabs just that value. */
  subtitle?: React.ReactNode;
  showBack?: boolean;
  /** Tool switcher rendered in the banner. */
  nav?: { items: HeaderNavItem<V>[]; value: V; onChange: (v: V) => void };
}) {
  return (
    // Phone: title stays on one line, subtitle hides, nav drops to its own row.
    <header className={cn(BRAND_BG, "text-white shadow-sm")}>
      <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-8 gap-y-1 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-white/20">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {showBack && (
                <Link to="/claims" className="shrink-0 text-sm text-white/70 hover:text-white">
                  ← Queue
                </Link>
              )}
              <h1 className="truncate text-[17px] font-semibold tracking-tight sm:text-lg">{title}</h1>
            </div>
            {subtitle && <p className="mt-0.5 hidden text-[13px] text-white/70 sm:block">{subtitle}</p>}
          </div>
        </div>

        {nav && (
          <nav aria-label="Tools" className="order-last -mx-1 flex w-full items-stretch gap-1 overflow-x-auto pb-1 sm:order-none sm:mx-0 sm:w-auto sm:self-stretch sm:pb-0">
            {nav.items.map((it) => {
              const active = it.value === nav.value;
              const Icon = it.icon;
              return (
                <button
                  key={it.value}
                  type="button"
                  onClick={() => nav.onChange(it.value)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[14px] font-semibold transition-colors sm:my-2 sm:py-0",
                    active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {it.shortLabel ? (<><span className="sm:hidden">{it.shortLabel}</span><span className="hidden sm:inline">{it.label}</span></>) : it.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
