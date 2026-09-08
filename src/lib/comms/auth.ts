/**
 * Google Workspace sign-in for the Comms panel (Google Identity Services).
 *
 * Ported from medically-modern/command-center `src/lib/shared/auth.ts` — same
 * OAuth client, same localStorage key (`mm-auth`). Both apps live on the
 * https://medically-modern.github.io origin, so a rep already signed in to the
 * Command Center in this browser is signed in here too, and vice versa.
 *
 * Unlike the Command Center, NOTHING in this app is gated on sign-in except the
 * Comms sheet: the gateway's `/messaging/conversation` route (the text thread
 * with staff attribution) returns 401 without a verified @domain token, so the
 * sheet shows a sign-in button the first time it's opened. Everything else on
 * the board works exactly as before.
 *
 * SIGN-IN IS A GATE, NOT A TICKING TOKEN. Google ID tokens expire ~1h after
 * issue and there is no background refresh. The gateway verifies the token's
 * SIGNATURE + domain and deliberately ignores `exp` (see its auth.mjs), so the
 * stored identity stays usable until the rep explicitly signs out.
 */

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";
const DOMAIN = (import.meta.env.VITE_AUTH_DOMAIN as string | undefined) || "medicallymodern.com";
const LS_KEY = "mm-auth";

/** Sign-in is possible in this build (an OAuth client id was configured). */
export function signInConfigured(): boolean {
  return CLIENT_ID.length > 0;
}
export function authDomain(): string {
  return DOMAIN;
}
export function googleClientId(): string {
  return CLIENT_ID;
}

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  exp: number; // seconds since epoch
  token: string; // the Google ID token (JWT)
}

let current: AuthUser | null = loadStored();
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}
export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function loadStored(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    // Persist on IDENTITY, not token freshness — an expired ID token must
    // never drop the session (the gateway ignores exp on purpose).
    if (!u?.email) return null;
    return u;
  } catch {
    return null;
  }
}
function store(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(LS_KEY, JSON.stringify(u));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* storage disabled */
  }
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
}

/** GIS credential callback. Validates the domain client-side (the gateway
 *  re-validates authoritatively) and stores the session. */
export function handleCredential(idToken: string): boolean {
  try {
    const p = decodeJwt(idToken) as { email?: string; name?: string; picture?: string; exp?: number; hd?: string };
    const email = String(p.email || "").toLowerCase();
    const okDomain = p.hd === DOMAIN || email.endsWith("@" + DOMAIN);
    if (!okDomain) {
      current = null;
      store(null);
      notify();
      return false;
    }
    current = { email, name: p.name || email, picture: p.picture, exp: p.exp || 0, token: idToken };
    store(current);
    notify();
    return true;
  } catch {
    return false;
  }
}

export function getUser(): AuthUser | null {
  return current;
}
export function getIdToken(): string | null {
  return getUser()?.token ?? null;
}
export function isAuthed(): boolean {
  return !!getUser();
}
export function signOut(): void {
  current = null;
  store(null);
  try {
    (window as unknown as { google?: { accounts?: { id?: { disableAutoSelect?: () => void } } } })
      .google?.accounts?.id?.disableAutoSelect?.();
  } catch {
    /* ignore */
  }
  notify();
}

/** Load the Google Identity Services script once. */
let gisPromise: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if ((window as unknown as { google?: { accounts?: unknown } }).google?.accounts) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
  return gisPromise;
}
