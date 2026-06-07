// Detects when a newer build has been deployed and offers a reload.
//
// Works around the GitHub Pages 10-minute HTML cache: GH Pages serves
// index.html with Cache-Control: max-age=600, so for up to 10 minutes
// after a deploy a normal refresh keeps serving the OLD index.html —
// which references the OLD content-hashed JS bundle. Result: operators
// stay on a stale build (and its stale data behaviour) until they hard
// refresh or wait out the cache.
//
// Fix: poll index.html with cache:"no-store" (always hits the network /
// CDN edge, bypassing the browser cache), read the hashed entry-bundle
// filename it references, and compare it to the bundle we actually
// booted with. If they differ, a newer build is live — show a toast
// with a reload that bypasses the cache via a fresh query-string key.
//
// Only active in deployed builds (VITE_BUILD_SHA is set by CI; absent in dev).

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const POLL_MS = 60 * 1000;
const ASSET_RE = /assets\/index-([A-Za-z0-9_-]+)\.js/;

function currentBundleHash(): string | null {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[src]"),
  );
  for (const s of scripts) {
    const m = s.src.match(ASSET_RE);
    if (m) return m[1];
  }
  return null;
}

export function VersionCheck() {
  const notified = useRef(false);

  useEffect(() => {
    if (!import.meta.env.VITE_BUILD_SHA) return; // dev: nothing to chase
    const local = currentBundleHash();
    if (!local) return;

    let cancelled = false;

    async function check() {
      if (cancelled || notified.current) return;
      try {
        const url = `${import.meta.env.BASE_URL}index.html?cb=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const remote = html.match(ASSET_RE)?.[1];
        if (remote && remote !== local) {
          notified.current = true;
          toast("A new version of the tool is available", {
            description: "Reload to get the latest build and fresh data.",
            duration: Infinity,
            action: {
              label: "Reload",
              onClick: () => {
                const u = new URL(window.location.href);
                u.searchParams.set("v", Date.now().toString(36));
                window.location.replace(u.toString());
              },
            },
          });
        }
      } catch {
        // transient network error — retry on the next tick
      }
    }

    const t = window.setTimeout(check, 5000);
    const id = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, []);

  return null;
}
