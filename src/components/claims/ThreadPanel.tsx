import { useRef, useState } from "react";
import { useThreadClaims } from "@/lib/claims/threadStore";
import {
  getRootClaim,
  getThread,
  productLabelForHcpc,
  submissionIndexInThread,
  type ThreadClaim,
} from "@/lib/claims/threads";
import { ItemStatusPill, StatusGlyph } from "./ItemStatusPill";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronUp } from "lucide-react";

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
}

function denialCodeText(carc?: string, rarc?: string) {
  return [carc, rarc].filter(Boolean).join(" ");
}

export function ThreadPanel({
  currentClaimId,
  hideCurrent = false,
  onHide,
}: {
  currentClaimId: string;
  hideCurrent?: boolean;
  onHide?: () => void;
}) {
  const { claims } = useThreadClaims();
  const current = claims.find((c) => c.id === currentClaimId);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pulseId, setPulseId] = useState<string | null>(null);

  if (!current) return null;
  const fullThread = getThread(current, claims);
  const visibleThread = hideCurrent
    ? fullThread.filter((c) => c.id !== currentClaimId)
    : fullThread;
  const root = fullThread[0];

  const flash = (id: string) => {
    setPulseId(id);
    setTimeout(() => setPulseId(null), 1100);
  };

  const scrollToClaim = (id: string) => {
    const el = cardRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      flash(id);
    }
  };

  const scrollToItem = (id: string) => {
    const el = itemRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      flash(id);
    }
  };

  return (
    <div className="border-t bg-muted/30 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Thread history — {root.patient.name} · {root.patient.member_id} ·{" "}
          <span className="text-foreground">
            {root.items.filter((i) => i.status === "Paid/Done").length} of {root.items.length} resolved
          </span>
        </div>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronUp className="h-3 w-3" /> Hide
          </button>
        )}
      </div>

      {/* Reddit-style indented thread of prior submissions */}
      <div className="ml-2 border-l-2 border-muted-foreground/20 pl-3 space-y-2">
        {visibleThread.map((c) => {
          const idx = submissionIndexInThread(c, fullThread);
          const isCurrent = c.id === currentClaimId;
          const isPulsing = pulseId === c.id;
          return (
            <div
              key={c.id}
              ref={(el) => (cardRefs.current[c.id] = el)}
              className={cn(
                "rounded border bg-background/60 px-2.5 py-2 transition-shadow",
                isCurrent && "border-l-2 border-l-primary bg-primary/5",
                isPulsing && "ring-2 ring-primary ring-offset-1",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <span className="font-bold text-muted-foreground">#{idx}</span>
                <span className="font-semibold text-foreground">{c.type}</span>
                <span className="text-muted-foreground">{fmtDate(c.dos)}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {c.icn ? `ICN ${c.icn}` : "(no ICN yet)"}
                </span>
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap",
                    c.status === "Closed" && "bg-success-soft text-success-soft-foreground",
                    c.status === "Partially Paid" && "bg-warning-soft text-warning-soft-foreground",
                    c.status === "Submitted" && "bg-info-soft text-info-soft-foreground",
                    c.status === "Awaiting Submission" && "bg-muted text-muted-foreground",
                  )}
                >
                  {c.status}
                </span>
              </div>

              <div className="mt-1.5 rounded border bg-card text-[11px]">
                {/* Header */}
                <div className="grid grid-cols-[minmax(0,1.5fr)_70px_70px_minmax(0,150px)_minmax(0,1fr)] items-center gap-2 border-b bg-muted/40 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <div>Product</div>
                  <div className="text-right">Est.</div>
                  <div className="text-right">Paid</div>
                  <div>Status</div>
                  <div>Denial</div>
                </div>
                {c.items.map((i) => {
                  const linkedTo = i.linked_to_original_item_id
                    ? fullThread.find((tc) =>
                        tc.items.some((ti) => ti.id === i.linked_to_original_item_id),
                      )
                    : null;
                  const linkedItem = linkedTo?.items.find(
                    (ti) => ti.id === i.linked_to_original_item_id,
                  );
                  const resolvedBy =
                    i.status === "Pending Follow-up"
                      ? fullThread.find((tc) =>
                          tc.items.some((ti) => ti.linked_to_original_item_id === i.id),
                        )
                      : null;
                  const isItemPulsing = pulseId === i.id;
                  const denial = denialCodeText(i.carc_codes, i.rarc_codes);
                  return (
                    <div
                      key={i.id}
                      ref={(el) => (itemRefs.current[i.id] = el)}
                      className={cn(
                        "grid grid-cols-[minmax(0,1.5fr)_70px_70px_minmax(0,150px)_minmax(0,1fr)] items-center gap-2 border-b px-2 py-1 last:border-b-0 transition-shadow",
                        isItemPulsing && "ring-2 ring-primary ring-inset",
                      )}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <StatusGlyph status={i.status} />
                        <span className="truncate font-medium">
                          {productLabelForHcpc(i.hcpc)}{" "}
                          <span className="font-mono text-[10px] text-muted-foreground">({i.hcpc})</span>
                        </span>
                      </div>
                      <div className="text-right tabular-nums text-muted-foreground">
                        ${i.charge.toFixed(0)}
                      </div>
                      <div
                        className={cn(
                          "text-right tabular-nums font-medium",
                          typeof i.paid_amount !== "number" && "text-muted-foreground",
                          i.paid_amount === 0 && "text-danger",
                          typeof i.paid_amount === "number" && i.paid_amount > 0 && i.paid_amount < i.charge && "text-warning",
                          typeof i.paid_amount === "number" && i.paid_amount >= i.charge && "text-success",
                        )}
                      >
                        {typeof i.paid_amount === "number" ? `$${i.paid_amount.toFixed(0)}` : "—"}
                      </div>
                      <div className="min-w-0">
                        <ItemStatusPill status={i.status} className="whitespace-nowrap" />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground min-w-0">
                        {i.denial_bucket ? (
                          <span className="font-medium text-foreground/80 truncate">
                            {i.denial_bucket}
                            {denial && (
                              <span className="ml-1 font-mono text-muted-foreground">({denial})</span>
                            )}
                          </span>
                        ) : denial ? (
                          <span className="font-mono">{denial}</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                        {resolvedBy && (
                          <button
                            type="button"
                            onClick={() => scrollToClaim(resolvedBy.id)}
                            className="inline-flex items-center gap-0.5 rounded text-info hover:underline"
                          >
                            <ArrowRight className="h-3 w-3" />
                            see #{submissionIndexInThread(resolvedBy, fullThread)}
                          </button>
                        )}
                        {linkedTo && linkedItem && (
                          <button
                            type="button"
                            onClick={() => scrollToItem(linkedItem.id)}
                            className="inline-flex items-center gap-0.5 rounded text-info hover:underline"
                          >
                            ↑ #{submissionIndexInThread(linkedTo, fullThread)}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ThreadContextStrip({
  claim,
  expanded,
  onToggle,
}: {
  claim: ThreadClaim;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { claims } = useThreadClaims();
  if (!claim.parent_claim_id) return null;
  const root = getRootClaim(claim, claims);
  const fullThread = getThread(claim, claims);
  const currentIdx = submissionIndexInThread(claim, fullThread);
  // "Follow-up #1" = first follow-up after the original (which is #1 in the thread).
  const followUpNum = Math.max(1, currentIdx - 1);
  const total = root.items.length;
  const resolved = root.items.filter((i) => i.status === "Paid/Done").length;

  return (
    <div className="flex items-center gap-3 border-b border-l-4 border-l-info bg-info-soft/30 px-3 py-1.5 text-xs">
      <span className="font-medium text-foreground">
        ↳ Follow-up #{followUpNum} · original {fmtDate(root.dos)}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {resolved}/{total} resolved
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="ml-auto inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide hover:bg-accent"
      >
        {expanded ? "▲ Hide thread" : "▾ View thread"}
      </button>
    </div>
  );
}

// Back-compat alias (in case any callers still import the old name)
export const ThreadContextLine = ThreadContextStrip;
