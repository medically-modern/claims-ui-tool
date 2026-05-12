// Tiny build identifier shown in the bottom-right corner. Shows the short SHA
// and a relative deploy time. Set by the GitHub Actions workflow via
// VITE_BUILD_SHA + VITE_BUILD_TIME. Hidden in dev (no SHA available).
//
// Hover it to see the full SHA + ISO timestamp. Click to copy the SHA.

export function BuildBadge() {
  const sha = import.meta.env.VITE_BUILD_SHA as string | undefined;
  const time = import.meta.env.VITE_BUILD_TIME as string | undefined;
  if (!sha) return null;

  const shortSha = sha.slice(0, 7);
  const deployed = time ? relativeTime(time) : "";
  const title = `Build ${sha}${time ? ` · deployed ${time}` : ""}`;

  return (
    <div
      title={title}
      onClick={() => {
        navigator.clipboard?.writeText(sha).catch(() => {});
      }}
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 50,
        fontSize: 10,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        padding: "2px 6px",
        borderRadius: 4,
        background: "rgba(0,0,0,0.55)",
        color: "white",
        opacity: 0.6,
        pointerEvents: "auto",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {shortSha}
      {deployed ? ` · ${deployed}` : ""}
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
