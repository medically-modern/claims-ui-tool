// /replay-era — operator paste-in for Stedi 835 JSON.
//
// When the live webhook misses an ERA (Stedi flake, downtime, or we just
// found a payload that never got processed), drop the JSON here and the
// backend runs it through the same writeback pipeline the live webhook
// uses. Matched claims land in ERA Review just like an automated ERA;
// unmatched rows surface in the result panel for debugging.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AppHeader } from "@/components/claims/AppHeader";
import { ArrowLeft, FileJson, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  replayEra, isReplayEraConfigured, ReplayEraError,
  type ReplayEraResult,
} from "@/api/replayEra";

export default function ReplayEra() {
  const [json, setJson] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReplayEraResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function validateJson(text: string): unknown | null {
    if (!text.trim()) {
      setParseError("Paste an 835 JSON payload first.");
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      setParseError(`Invalid JSON: ${(e as Error).message}`);
      return null;
    }
  }

  async function handleSubmit() {
    if (busy) return;
    setParseError(null);
    setResult(null);

    if (!isReplayEraConfigured()) {
      toast({
        title: "Replay not configured",
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }

    const parsed = validateJson(json);
    if (parsed === null) return;

    setBusy(true);
    try {
      const res = await replayEra(parsed, {
        transactionId: transactionId.trim() || undefined,
      });
      setResult(res);
      toast({
        title: "ERA replayed",
        description:
          `Parsed ${res.rows_parsed} row(s) — ${res.rows_written} written, ` +
          `${res.rows_skipped} skipped. Matched claims will appear in ERA Review.`,
      });
    } catch (e) {
      const msg =
        e instanceof ReplayEraError ? e.message : (e as Error).message;
      toast({ title: "Replay failed", description: msg });
    } finally {
      setBusy(false);
    }
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
            Paste the raw 835 JSON below. Same writeback path as the live
            Stedi webhook — matched claims land in ERA Review. Use when an
            ERA arrived at Stedi but the webhook didn't fire on our side,
            or when re-processing an older payload by hand.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileJson className="h-4 w-4" /> ERA Payload
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
            <Textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder='Paste 835 JSON here. Supports Stedi X12-typed (heading/detail), classic Stedi SDK (transactions[]), or flat single-claim format.'
              className="min-h-[400px] font-mono text-xs"
            />
            {parseError && (
              <Alert variant="destructive">
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end">
              <Button onClick={() => void handleSubmit()} disabled={busy}>
                <Send className="mr-2 h-4 w-4" />
                {busy ? "Processing…" : "Replay ERA"}
              </Button>
            </div>
          </CardContent>
        </Card>

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
                  <div className="grid grid-cols-[1fr_1fr_0.8fr_0.8fr_1fr_1fr] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
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
                      className="grid grid-cols-[1fr_1fr_0.8fr_0.8fr_1fr_1fr] items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0"
                    >
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
