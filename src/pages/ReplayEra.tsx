// /replay-era — operator paste-in for Stedi 835 JSON.
//
// When the live webhook misses an ERA (Stedi flake, downtime, or we just
// found a payload that never got processed), drop the JSON here and the
// backend runs it through the same writeback pipeline the live webhook
// uses. Matched claims land in ERA Review just like an automated ERA;
// unmatched rows surface in the result panel for debugging.

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AppHeader } from "@/components/claims/AppHeader";
import { ArrowLeft, FileJson, Send, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  replayEra, isReplayEraConfigured, ReplayEraError,
  type ReplayEraResult,
} from "@/api/replayEra";

/** True when a payload looks like raw X12 (.835 file content), not JSON.
 *  Real 835 files always start with the ISA segment after whitespace
 *  trim. Backend uses the same detector — keeping them in sync.  */
function looksLikeX12(text: string): boolean {
  return text.trimStart().startsWith("ISA");
}

export default function ReplayEra() {
  const [payload, setPayload] = useState("");
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  // Preview = parsed list of claims (dry-run). Operator picks which to
  // replay from this list before committing.
  const [preview, setPreview] = useState<ReplayEraResult | null>(null);
  // PCNs the operator has selected from the preview. All checked by
  // default once preview lands so the common case (replay everything)
  // stays one click.
  const [selectedPcns, setSelectedPcns] = useState<Set<string>>(new Set());
  // result = the final committed run. Distinct from preview so we don't
  // lose the patient list after committing.
  const [result, setResult] = useState<ReplayEraResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Drag-and-drop state — true while a file is hovering over the drop
  // zone. Drives the highlight + "drop to load" affordance.
  const [dragOver, setDragOver] = useState(false);

  // Detect payload type — text starts with ISA = raw X12 .835, otherwise
  // assume JSON. Drives the validation path + the label shown next to
  // the textarea so the operator knows what they're working with.
  const isX12 = payload.trim().length > 0 && looksLikeX12(payload);

  function validatePayload(text: string): { mode: "x12" | "json"; data: unknown } | null {
    if (!text.trim()) {
      setParseError("Paste an 835 payload or upload a .835 file first.");
      return null;
    }
    if (looksLikeX12(text)) {
      // Backend's parse_era_from_string detects ISA-prefixed payloads and
      // converts X12 → typed JSON internally. We just pass the raw text.
      return { mode: "x12", data: text };
    }
    try {
      return { mode: "json", data: JSON.parse(text) };
    } catch (e) {
      setParseError(
        `Doesn't look like X12 (no leading ISA) and JSON.parse failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  // Fire the dry-run preview as soon as we have a payload. The backend
  // parses + routes (matches PCNs to Monday items) but skips the writes.
  // Result becomes a checkbox list the operator picks from.
  async function runPreview(text: string) {
    setParseError(null);
    setPreview(null);
    setResult(null);
    setSelectedPcns(new Set());

    const v = validatePayload(text);
    if (!v) return;

    if (!isReplayEraConfigured()) {
      toast({
        title: "Replay not configured",
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }

    setPreviewBusy(true);
    try {
      const res = await replayEra(v.data, {
        transactionId: transactionId.trim() || undefined,
        dryRun: true,
      });
      setPreview(res);
      // Default every PCN to selected — common case is "replay everything",
      // operator unticks the ones they don't want.
      setSelectedPcns(new Set(res.results.map((r) => r.pcn).filter(Boolean)));
      toast({
        title: "Preview ready",
        description:
          `${res.rows_parsed} claim(s) found. Select which to replay below.`,
      });
    } catch (e) {
      const msg =
        e instanceof ReplayEraError ? e.message : (e as Error).message;
      toast({ title: "Preview failed", description: msg });
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleFileSelected(file: File) {
    try {
      const text = await file.text();
      setPayload(text);
      setUploadedFilename(file.name);
      toast({
        title: `Loaded ${file.name}`,
        description: `${(text.length / 1024).toFixed(1)} KB · ${
          looksLikeX12(text) ? "X12 .835 detected" : "treated as JSON"
        }`,
      });
      // Auto-fire preview right after file load so the operator doesn't
      // have to click anything extra to see the claim list.
      await runPreview(text);
    } catch (e) {
      toast({
        title: "Couldn't read file",
        description: (e as Error).message,
      });
    }
  }

  async function handleCommit() {
    if (commitBusy) return;
    if (!preview) return;
    if (selectedPcns.size === 0) {
      toast({
        title: "Nothing selected",
        description: "Tick at least one claim to replay.",
      });
      return;
    }
    setParseError(null);
    setResult(null);

    if (!isReplayEraConfigured()) {
      toast({
        title: "Replay not configured",
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }

    const v = validatePayload(payload);
    if (!v) return;

    setCommitBusy(true);
    try {
      const res = await replayEra(v.data, {
        transactionId: transactionId.trim() || undefined,
        pcnFilter: Array.from(selectedPcns),
      });
      setResult(res);
      toast({
        title: "ERA replayed",
        description:
          `${res.rows_written} written, ${res.rows_skipped} skipped. ` +
          `Matched claims now in ERA Review.`,
      });
    } catch (e) {
      const msg =
        e instanceof ReplayEraError ? e.message : (e as Error).message;
      toast({ title: "Replay failed", description: msg });
    } finally {
      setCommitBusy(false);
    }
  }

  function togglePcn(pcn: string) {
    setSelectedPcns((prev) => {
      const next = new Set(prev);
      if (next.has(pcn)) next.delete(pcn);
      else next.add(pcn);
      return next;
    });
  }
  function selectAll() {
    if (!preview) return;
    setSelectedPcns(new Set(preview.results.map((r) => r.pcn).filter(Boolean)));
  }
  function selectNone() {
    setSelectedPcns(new Set());
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <AppHeader title="Replay ERA" subtitle="Manually re-run an 835 JSON payload" showBack />

      <main className="mx-auto max-w-[1100px] px-6 py-6 space-y-4">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/claims">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Claims
            </Link>
          </Button>
        </div>

        <Alert>
          <AlertDescription>
            Upload a raw <code className="font-mono">.835</code> file OR paste
            the 835 payload (JSON or X12 text) below. Same writeback path as
            the live Stedi webhook — matched claims land in ERA Review. Use
            when an ERA arrived at Stedi but the webhook didn't fire on our
            side, or when re-processing an older payload by hand.
          </AlertDescription>
        </Alert>

        <Card
          // Drop zone — operators can drag a .835 / .json file straight
          // onto the card instead of clicking the Upload button. Same
          // handleFileSelected handler kicks in.
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={(e) => {
            // Only clear when leaving the card entirely; child element
            // drags fire a dragleave on the parent too.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOver(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFileSelected(f);
          }}
          className={
            dragOver
              ? "ring-2 ring-info ring-offset-2 transition-shadow"
              : "transition-shadow"
          }
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileJson className="h-4 w-4" /> ERA Payload
              {dragOver && (
                <span className="ml-2 rounded bg-info-soft px-2 py-0.5 text-xs font-semibold uppercase text-info-soft-foreground">
                  Drop to load
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Stedi Transaction ID (optional)
              </label>
              <input
                type="text"
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                placeholder="e.g. trans-abc123 (only needed for primary-board correlation lookup)"
                className="h-8 flex-1 rounded border px-2 text-sm"
              />
            </div>

            {/* File upload row. Hidden native input, button triggers it.
                Accepts .835 (X12 text) and .json for completeness; users
                often have both shapes lying around. */}
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".835,.txt,.json,application/json,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelected(f);
                  // reset so the same file can be re-picked if needed
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1 h-4 w-4" /> Upload .835 file
              </Button>
              <span className="text-xs text-muted-foreground">
                {uploadedFilename
                  ? <>Loaded: <span className="font-mono">{uploadedFilename}</span></>
                  : "drag and drop a file anywhere on this card, or paste below"}
              </span>
              {payload && (
                <span className={
                  isX12
                    ? "ml-auto rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900"
                    : "ml-auto rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-900"
                }>
                  {isX12 ? "X12 detected" : "JSON detected"}
                </span>
              )}
            </div>

            <Textarea
              value={payload}
              onChange={(e) => {
                setPayload(e.target.value);
                // Typing into the textarea invalidates the prior file
                // attribution and any cached preview/result. Keeps the
                // label honest and the selection in sync.
                if (uploadedFilename) setUploadedFilename(null);
                setPreview(null);
                setResult(null);
                setSelectedPcns(new Set());
              }}
              placeholder={
                "Paste raw X12 (.835 starts with `ISA*…~`) or 835 JSON " +
                "(X12-typed heading/detail, Stedi SDK transactions[], or " +
                "flat single-claim)."
              }
              className="min-h-[300px] font-mono text-xs"
            />
            {parseError && (
              <Alert variant="destructive">
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end">
              {/* Preview button — runs dry_run on the backend to get the
                  parsed claim list. If a file upload already auto-fired
                  this, the operator can re-run after editing the text. */}
              <Button
                variant="outline"
                onClick={() => void runPreview(payload)}
                disabled={previewBusy || !payload.trim()}
              >
                <Send className="mr-2 h-4 w-4" />
                {previewBusy ? "Parsing…" : preview ? "Re-parse" : "Preview claims"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview card — appears after the dry_run lands. Shows every
            claim in the payload with a checkbox; operator picks which to
            actually replay. */}
        {preview && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">
                  Claims in payload ({preview.results.length})
                </CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded border px-2 py-1 hover:bg-muted"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={selectNone}
                    className="rounded border px-2 py-1 hover:bg-muted"
                  >
                    Select none
                  </button>
                  <span className="ml-2 text-muted-foreground">
                    {selectedPcns.size} of {preview.results.length} selected
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border">
                <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_0.9fr_0.9fr] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  <span></span>
                  <span>Patient</span>
                  <span>PCN</span>
                  <span>Payer</span>
                  <span>Status</span>
                  <span className="text-right">Paid</span>
                  <span className="text-right">PR</span>
                </div>
                {preview.results.map((r, i) => {
                  const checked = selectedPcns.has(r.pcn);
                  return (
                    <label
                      key={`${r.pcn}-${i}`}
                      className="grid cursor-pointer grid-cols-[2.5rem_1fr_1fr_1fr_1fr_0.9fr_0.9fr] items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0 hover:bg-muted/20"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!r.pcn}
                        onChange={() => r.pcn && togglePcn(r.pcn)}
                        className="h-4 w-4"
                      />
                      <span className="font-medium">
                        {r.patient_name || <span className="text-muted-foreground">—</span>}
                      </span>
                      <span className="font-mono text-[11px]">{r.pcn || "—"}</span>
                      <span className="truncate" title={r.payer_name}>
                        {r.payer_name || "—"}
                      </span>
                      <span className="truncate" title={r.claim_status}>
                        {r.claim_status || "—"}
                      </span>
                      <span className="text-right tabular-nums">
                        {r.primary_paid || "—"}
                      </span>
                      <span className="text-right tabular-nums">
                        {r.pr_amount || "—"}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => void handleCommit()}
                  disabled={commitBusy || selectedPcns.size === 0}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {commitBusy
                    ? "Replaying…"
                    : `Replay ${selectedPcns.size} selected`}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Result</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Parsed</div>
                  <div className="text-xl font-semibold tabular-nums">{result.rows_parsed}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Written</div>
                  <div className="text-xl font-semibold tabular-nums text-emerald-700">{result.rows_written}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Skipped</div>
                  <div className="text-xl font-semibold tabular-nums text-amber-700">{result.rows_skipped}</div>
                </div>
              </div>

              {result.results.length > 0 && (
                <div className="rounded-md border">
                  {/* 7-col grid: Patient | PCN | Status | Paid | PR | Route | Outcome.
                      Patient column added so the result table mirrors the
                      preview — operator can recognize who got written
                      without cross-referencing the PCN against the preview. */}
                  <div className="grid grid-cols-[1fr_1fr_1fr_0.8fr_0.8fr_0.8fr_1.2fr] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    <span>Patient</span>
                    <span>PCN</span>
                    <span>Status</span>
                    <span className="text-right">Paid</span>
                    <span className="text-right">PR</span>
                    <span>Route</span>
                    <span>Outcome</span>
                  </div>
                  {result.results.map((r, i) => (
                    <div
                      key={`${r.pcn}-${i}`}
                      className="grid grid-cols-[1fr_1fr_1fr_0.8fr_0.8fr_0.8fr_1.2fr] items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0"
                    >
                      <span className="truncate font-medium" title={r.patient_name}>
                        {r.patient_name || <span className="text-muted-foreground">—</span>}
                      </span>
                      <span className="font-mono">{r.pcn || "—"}</span>
                      <span className="truncate" title={r.claim_status}>{r.claim_status || "—"}</span>
                      <span className="text-right tabular-nums">{r.primary_paid || "—"}</span>
                      <span className="text-right tabular-nums">{r.pr_amount || "—"}</span>
                      <span>
                        <span className={
                          r.route === "secondary"
                            ? "rounded bg-purple-100 px-1.5 py-0.5 text-purple-900"
                            : "rounded bg-blue-100 px-1.5 py-0.5 text-blue-900"
                        }>
                          {r.route}
                        </span>
                      </span>
                      <span>
                        {r.outcome === "populated" ? (
                          <span className="text-emerald-700">Populated → {r.item_id}</span>
                        ) : r.outcome === "no-match" ? (
                          <span className="text-amber-700">No match for PCN</span>
                        ) : r.outcome === "secondary-not-spawned" ? (
                          <span className="text-amber-700">Secondary item not spawned yet</span>
                        ) : (
                          <span className="text-muted-foreground">{r.outcome}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {result.rows_written > 0 && (
                <Alert>
                  <AlertDescription>
                    Matched claims have been moved into ERA Review. Head back
                    to the Claims page and check the ERA Review bucket.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
