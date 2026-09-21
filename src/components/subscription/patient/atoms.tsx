/**
 * atoms.tsx — the small pieces the patient page is built from, ported from the
 * Command Center redesign mockup (eyebrow / fact / card / edit field / pill).
 * Kept together so the Profile, Orders and Claims views read as one page.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AddressAutocomplete } from "./AddressAutocomplete";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground", className)}>{children}</div>;
}

/** A labelled value. `tone` colours the value; blank values read as "—". */
export function Fact({ label, children, tone, big, className }: {
  label: string; children?: ReactNode; tone?: "good" | "bad" | "warn"; big?: boolean; className?: string;
}) {
  const empty = children === undefined || children === null || children === "" || children === false;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{label}</div>
      <div className={cn(
        "break-words text-[13px] font-medium",
        big && "text-[15px] font-semibold",
        tone === "good" && "text-emerald-700",
        tone === "bad" && "text-rose-700",
        tone === "warn" && "text-amber-700",
        empty && "text-muted-foreground font-normal",
      )}>
        {empty ? "—" : children}
      </div>
    </div>
  );
}

export function Section({ title, right, accent, children, className, id }: {
  title?: ReactNode; right?: ReactNode; accent?: boolean; children: ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={cn(
      "rounded-2xl border bg-card px-5 py-4 shadow-sm",
      accent && "border-l-4 border-l-[#3f5c63]",
      className,
    )}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {typeof title === "string" ? <Eyebrow>{title}</Eyebrow> : title}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Pill({ tone = "grey", children, className }: {
  tone?: "good" | "light" | "blue" | "amber" | "red" | "grey"; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
      tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-800",
      tone === "light" && "border-emerald-100 bg-emerald-50/60 text-emerald-700",
      tone === "blue" && "border-sky-200 bg-sky-50 text-sky-800",
      tone === "amber" && "border-amber-200 bg-amber-50 text-amber-800",
      tone === "red" && "border-rose-200 bg-rose-50 text-rose-700",
      tone === "grey" && "border-border bg-muted text-muted-foreground",
      className,
    )}>{children}</span>
  );
}

export function Chip({ tone = "grey", children, className }: {
  tone?: "grey" | "amber" | "red" | "green" | "blue"; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
      tone === "grey" && "bg-muted text-foreground",
      tone === "amber" && "bg-amber-50 text-amber-800",
      tone === "red" && "bg-rose-50 text-rose-700",
      tone === "green" && "bg-emerald-50 text-emerald-800",
      tone === "blue" && "bg-sky-50 text-sky-800",
      className,
    )}>{children}</span>
  );
}

const INPUT = "w-full rounded-lg border border-input bg-card px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export function EditField({ label, value, onChange, type = "text", disabled, placeholder, min }: {
  label: string; value: string; onChange: (v: string) => void; type?: "text" | "date" | "number"; disabled?: boolean; placeholder?: string; min?: number;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{label}</span>
      <input className={INPUT} type={type} value={value} min={min} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}

/** An address field with Google Places type-ahead (AddressAutocomplete). Fills
 *  one formatted address string; picking a suggestion or typing both flow the
 *  text back through onChange, so it drops into the same draft field EditField
 *  would have. Degrades to a plain text input when the Maps key isn't set. */
export function AddressEditField({ label, value, onChange, disabled, placeholder }: {
  label: string;
  /** Fires with the address text and its coordinates. A Google Places pick
   *  carries real lat/lng; manual typing gives 0/0 — the caller uses that as a
   *  "human confirmed" signal (see writeLocation). */
  value: string; onChange: (v: string, coords: { lat: number; lng: number }) => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{label}</span>
      <AddressAutocomplete
        className={INPUT}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        onChange={(r) => onChange(r.address, { lat: r.lat, lng: r.lng })}
      />
    </label>
  );
}

/** A select over the board's own labels. A value the board holds that is
 *  not in the list is kept selectable so saving never silently changes it. */
export function EditSelect({ label, value, onChange, options, disabled, blank }: {
  label: string; value: string; onChange: (v: string) => void; options: readonly string[]; disabled?: boolean; blank?: string;
}) {
  const opts = value && !options.includes(value) ? [value, ...options] : [...options];
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{label}</span>
      <select className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {blank !== undefined && <option value="">{blank}</option>}
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export function ReadBox({ children }: { children: ReactNode }) {
  return <div className="mt-1 rounded-lg bg-muted px-2.5 py-1.5 text-[12px]">{children || "—"}</div>;
}

/** yyyy-mm-dd → "9/20/2026" */
export function usDate(iso: string | null | undefined): string {
  const v = String(iso ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : (v || "");
}

/** Days from today to yyyy-mm-dd; null when unparseable. */
export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
  const v = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

export function daysText(n: number | null): string {
  if (n == null) return "";
  if (n === 0) return "today";
  return n < 0 ? `${-n} day${n === -1 ? "" : "s"} overdue` : `in ${n} day${n === 1 ? "" : "s"}`;
}

export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function trackingUrl(carrier: string, tracking: string): string | null {
  if (!tracking) return null;
  const c = carrier.toLowerCase();
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}`;
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`;
  return null;
}
