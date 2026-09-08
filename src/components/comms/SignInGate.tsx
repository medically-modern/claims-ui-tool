/**
 * The lazy sign-in step inside the Comms sheet.
 *
 * Only the text thread needs it (the gateway's `/messaging/conversation` route
 * is token-gated); nothing else in the app is. Adapted from command-center's
 * `AuthGate.tsx` LoginScreen, minus the full-page takeover: this renders inline
 * where the thread would be, and the rest of the sheet keeps working.
 */
import { useEffect, useRef, useState } from "react";
import { LogIn, AlertTriangle } from "lucide-react";
import { authDomain, googleClientId, handleCredential, loadGis, signInConfigured } from "@/lib/comms/auth";

type GoogleId = {
  accounts: {
    id: {
      initialize: (cfg: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, cfg: Record<string, unknown>) => void;
      prompt: () => void;
    };
  };
};

export function SignInGate({ reason, onSignedIn }: { reason?: string; onSignedIn: () => void }) {
  const btn = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!signInConfigured()) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled) return;
        const g = (window as unknown as { google: GoogleId }).google;
        g.accounts.id.initialize({
          client_id: googleClientId(),
          callback: (resp: { credential: string }) => {
            if (handleCredential(resp.credential)) {
              setErr(null);
              onSignedIn();
            } else {
              setErr(`Please sign in with your @${authDomain()} account.`);
            }
          },
          hd: authDomain(),
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        if (btn.current) {
          g.accounts.id.renderButton(btn.current, {
            theme: "filled_blue",
            size: "large",
            text: "signin_with",
            shape: "pill",
          });
        }
      })
      .catch(() => setErr("Couldn't load Google sign-in. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
    // onSignedIn is stable enough for a one-shot mount effect; re-running
    // initialize() on every parent render would re-paint the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!signInConfigured()) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          This build has no Google sign-in configured (<code>VITE_GOOGLE_CLIENT_ID</code>), so the text thread
          can't be loaded. Calls still work.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
      <LogIn className="h-5 w-5 text-muted-foreground" />
      <div className="text-sm font-medium">Sign in to see texts</div>
      <p className="max-w-[320px] text-xs text-muted-foreground">
        {reason ??
          `The text thread shows who on the team sent each message, which needs a signed-in @${authDomain()} account. One-time per browser — the Command Center shares the same sign-in.`}
      </p>
      <div ref={btn} className="inline-block" />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
