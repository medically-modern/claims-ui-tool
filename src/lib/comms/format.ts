/**
 * Small display helpers for the Comms panel. `senderName`/`senderColor` are
 * ported from command-center `src/lib/assignedPatients/format.ts` so a staff
 * member is the same colour here as in the Command Center's thread view.
 */

export function fmtPhone(num: string): string {
  const d = (num || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return num || "Unknown";
}

/** RingCentral timestamps are real UTC instants; render them on the office
 *  clock (ET) explicitly, so a rep who travels sees the same time as the team. */
export function fmtWhenET(iso: string, opts: { withYear?: boolean } = {}): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.withYear ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** The calendar day (ET) an instant falls on, as yyyy-mm-dd — for day dividers
 *  and for lining messages up against board dates (which are plain days). */
export function etDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA gives yyyy-mm-dd directly.
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function fmtDayLabel(yyyymmdd: string): string {
  if (!yyyymmdd) return "";
  const d = new Date(yyyymmdd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return yyyymmdd;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "josh@medicallymodern.com" → "Josh"; "first.last@…" → "First Last". */
export function senderName(email: string): string {
  const local = String(email || "").split("@")[0];
  if (!local) return "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * A stable colour per sender. The roster is EXPLICIT rather than hashed so
 * teammates never collide; anyone not listed still gets a deterministic colour.
 * Append only — reordering repaints everyone above the change. Keep in sync
 * with the Command Center's list so colours match across the two apps.
 */
const SENDER_PALETTE = [
  "bg-emerald-600", // josh
  "bg-sky-600",     // katie
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-700",
  "bg-indigo-600",
  "bg-teal-600",
  "bg-fuchsia-600",
  "bg-lime-700",
  "bg-orange-600",
  "bg-pink-600",
] as const;

const SENDER_ORDER = [
  "josh@medicallymodern.com",
  "katie@medicallymodern.com",
  "janelle@medicallymodern.com",
  "brandon@medicallymodern.com",
  "corey@medicallymodern.com",
  "masheke@medicallymodern.com",
  "samantha@medicallymodern.com",
  "madeline@medicallymodern.com",
] as const;

export function senderColor(email: string): string {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "bg-primary";
  const known = SENDER_ORDER.indexOf(e as (typeof SENDER_ORDER)[number]);
  if (known >= 0) return SENDER_PALETTE[known % SENDER_PALETTE.length];
  let h = 0;
  for (let i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) >>> 0;
  const spare = SENDER_PALETTE.length - SENDER_ORDER.length;
  return spare > 0
    ? SENDER_PALETTE[SENDER_ORDER.length + (h % spare)]
    : SENDER_PALETTE[h % SENDER_PALETTE.length];
}
