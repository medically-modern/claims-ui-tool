// Row-level operator notes for the Claims table (Check Status /
// Outstanding buckets). A small note icon on each row — filled amber
// when a note exists — opens a popover editor backed by the Action
// Context column (text_mm29v2ph) on the primary Claims Board. Same
// free-text column the denial workflow and the EFT tab's inline notes
// editor write, so a note typed here is visible on Monday and anywhere
// else Action Context surfaces (ClaimDetail's denial card, etc.).
//
// Direct Monday write, no backend hop. Parent owns the optimistic
// override (onSaved) so the icon/preview updates without waiting for
// the next React Query refetch.

import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { setActionContext } from "@/api/setActionContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function ClaimNotePopover({
  mondayItemId, patientName, value, onSaved,
}: {
  mondayItemId: string;
  patientName: string;
  /** Current note text (parent's optimistic override or fetched value). */
  value: string;
  /** Fires after a successful Monday write with the saved text. */
  onSaved: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const hasNote = value.trim().length > 0;

  async function save() {
    if (busy) return;
    const text = draft.trim();
    if (text === value.trim()) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await setActionContext(mondayItemId, text);
      onSaved(text);
      toast({ title: "Note saved", description: patientName });
      setOpen(false);
    } catch (e) {
      toast({ title: "Couldn't save note", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Seed the draft from the current value every time the popover
        // opens, so a refetch between opens never shows a stale draft.
        if (o) setDraft(value);
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={hasNote ? value : "Add note"}
          aria-label={hasNote ? `Edit note for ${patientName}` : `Add note for ${patientName}`}
        >
          <StickyNote
            className={cn(
              "h-4 w-4",
              hasNote
                ? "text-warning-soft-foreground fill-warning-soft"
                : "text-muted-foreground/50",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Note — {patientName}
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Called payer 6/11 — claim in process, check back Friday"
          rows={4}
          disabled={busy}
          autoFocus
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Saves to Action Context on Monday
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
