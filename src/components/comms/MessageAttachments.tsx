/**
 * The media a text message carried — the photo a patient sent back, a PDF,
 * whatever rode the MMS. Photos render inline in the bubble; anything else
 * gets an open button. Ported from command-center `shared/MessageAttachments`.
 *
 * MMS bytes live on media.ringcentral.com behind the RC bearer token, so the
 * browser can't point an <img src> at them: each attachment is fetched through
 * the gateway's /rc/fetch proxy and shown from a blob URL.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { fetchRcContentBlobUrl } from "@/lib/comms/gateway";
import type { MessageAttachment } from "@/lib/comms/messagingApi";

function extFor(contentType: string): string {
  const sub = (contentType.split("/")[1] ?? "").toLowerCase();
  return sub ? sub.replace("jpeg", "jpg") : "file";
}

function Attachment({ a }: { a: MessageAttachment }) {
  const isImage = /^image\//i.test(a.contentType);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const urlRef = useRef<string | null>(null);

  // Images load eagerly — they ARE the message. Other types wait for a click.
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    fetchRcContentBlobUrl(a.uri)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        urlRef.current = u;
        setSrc(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [a.uri, isImage]);

  const openBlob = async () => {
    setOpening(true);
    try {
      const u = urlRef.current ?? (urlRef.current = await fetchRcContentBlobUrl(a.uri));
      window.open(u, "_blank", "noopener");
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };

  if (failed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-black/10 px-2 py-1 text-[11px] opacity-80">
        <Paperclip className="h-3 w-3" /> attachment couldn&apos;t load
      </span>
    );
  }

  if (isImage) {
    return src ? (
      <img
        src={src}
        alt="Texted attachment"
        onClick={() => void openBlob()}
        className="max-h-56 max-w-full cursor-zoom-in rounded-lg border border-black/10"
      />
    ) : (
      <span className="inline-flex h-24 w-32 items-center justify-center rounded-lg bg-black/10">
        <Loader2 className="h-4 w-4 animate-spin opacity-70" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openBlob()}
      disabled={opening}
      className="inline-flex items-center gap-1.5 rounded-md bg-black/10 px-2 py-1 text-[12px] font-medium hover:bg-black/20"
    >
      {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
      Open {extFor(a.contentType)}
    </button>
  );
}

export function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5">
      {attachments.map((a) => (
        <Attachment key={a.id} a={a} />
      ))}
    </div>
  );
}
