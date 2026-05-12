## Secondary Board — MVP Plan

Build the Secondary Board as a sister to the Primary Board with a three-bucket layout: **Forwarded (Medicare crossover)**, **Submit to Secondary**, and **Send to Patient**. All bucket cards, filter row, expandable claim rows, and thread expansion reuse the Primary Board's components and styling.

### Files to add / change

**New**
- `src/components/claims/SecondaryBoard.tsx` — main container: 3 bucket cards, filter row (search / payer / sort / bucket-source), claim list, dispatcher to row component per bucket. Loading / empty / error states.
- `src/components/claims/SecondaryClaimRow.tsx` — collapsed row (`▸ Patient · Primary → Secondary · DOS · status pill · primary paid / remaining`), expanded body switches by bucket:
  - **Submit to Secondary** — header (Name, Primary read-only, Secondary editable, Sec Member ID, DOS, Dx, Type, ✈ Submit Secondary), read-only Primary Payment Info strip (paid / adj / pay date / ICN), subitem table with Primary Paid / Primary Adj / Remaining / status pill.
  - **Send to Patient** — Remaining balance + secondary outcome line, DOS / Reason Code / PR breakdown, subitem table with amount owed + reason, notes textarea, `Generate Statement` (primary green) + `Mark Paid (manual)` buttons.
  - **Forwarded** — read-only summary (primary payor → secondary, DOS, primary paid, expected ERA window, primary ICN, forwarded flag), `Mark as Posted` + `Open in Monday` actions, subtle pulse on the Awaiting ERA pill.
- `src/lib/claims/secondaryMock.ts` — `SECONDARY_CLAIMS` fixture with the three example claims (`claim_sec_001`, `claim_sec_002`, `claim_pat_001`) plus a couple more so each bucket has ≥1 row. Use the same `Claim`/`ServiceLine` shape with added secondary fields.

**Edited**
- `src/lib/claims/types.ts` — add `SecondaryStatus` enum (8 values from brief), add optional `secondaryStatus`, `parentClaimId`, `secondaryMemberId`, `primaryIcn`, `forwardedFlag`, `prReason`, `expectedCrossoverEra` to `Claim`; add per-line `primaryAdj`, `remainingAfterPrimary`.
- `src/pages/Claims.tsx` — replace the `ComingSoon` placeholder for `board === "secondary"` with `<SecondaryBoard />`. Hide the Submit/Review mode tabs while on Secondary (the three buckets are the mode).
- `src/components/claims/AppHeader.tsx` (light touch) — accept an optional accent badge so we can show a small "Secondary" pill when on that board.

### Bucket routing
- `Forwarded` ← `secondaryStatus === "Primary Paid - Forwarded"`
- `Submit to Secondary` ← `secondaryStatus === "Primary Paid - Submit Secondary"`
- `Send to Patient` ← `secondaryStatus === "Sent to Patient"` OR (no secondary on file AND `prAmount > 0`)

### Submit / Send actions
Both are local stubs that flip `secondaryStatus` in component state and toast a confirmation, removing the row from its bucket. Wire-up to a real endpoint is out of scope (per brief).

### Thread expansion
Reuse `ThreadPanel`. Submission cards inside the thread already render type labels — extend the label set with "Secondary" / "Patient bill" so the new rows render correctly.

### Out of scope (per brief)
Real X12 submission, PDF statement generation, QuickBooks, secondary follow-up flow, multi-tertiary, automatic crossover detection.

### Acceptance check
After implementation, click the Secondary Board tab → see 3 bucket cards with counts → click each → expand a row in each bucket → confirm correct form layout → click Submit Secondary / Generate Statement / Mark as Posted → row disappears with toast.