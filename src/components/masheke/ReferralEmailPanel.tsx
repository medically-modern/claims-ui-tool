/**
 * Side-by-side referral email / updates panel for the profile page.
 *
 * Renders as a flex sibling of the main content, NOT a modal. The
 * agent can read the referral email here while continuing to interact
 * with the profile form on the left — both columns scroll
 * independently and neither blocks the other.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUpdates, createUpdate, type MondayUpdate } from "@/lib/masheke/mondayApi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Mail, Send, Loader2, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Props {
  itemId: string;
  patientName: string;
  onClose: () => void;
}

export function ReferralEmailPanel({ itemId, patientName, onClose }: Props) {
  const [updates, setUpdates] = useState<MondayUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUpdates(itemId);
      setUpdates(data);
    } catch (e) {
      toast.error("Failed to load referral email", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  // Reload whenever the patient changes.
  useEffect(() => {
    setDraft("");
    void load();
  }, [load]);

  const handlePost = async () => {
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    try {
      await createUpdate(itemId, text + "<br><br><i>-Profile Checklist</i>");
      setDraft("");
      toast.success("Update posted");
      await load();
    } catch (e) {
      toast.error("Failed to post update", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handlePost();
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <aside
      className="w-[380px] shrink-0 border-l bg-card flex flex-col h-screen sticky top-0"
      aria-label={`Referral email for ${patientName}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <Mail className="h-4 w-4 text-blue-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">
              Referral Email
            </p>
            <p className="text-sm font-semibold leading-tight truncate">{patientName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Compose area */}
      <div className="px-4 py-3 space-y-2 border-b">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write an update…"
          className="min-h-[60px] resize-none text-sm"
          disabled={posting}
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">⌘+Enter to post</p>
          <Button
            size="sm"
            onClick={handlePost}
            disabled={posting || !draft.trim()}
            className="gap-1.5 h-7"
          >
            {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Post
          </Button>
        </div>
      </div>

      {/* Updates list — independent scroll */}
      <div className="flex-1 overflow-y-auto px-4">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : updates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">No content yet</p>
        ) : (
          <div className="space-y-4 py-4">
            {updates.map((u) => (
              <div key={u.id} className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {u.creator?.name ?? "System"}
                  </span>
                  <span>·</span>
                  <span>{formatDate(u.created_at)}</span>
                </div>
                <div
                  className="text-sm leading-relaxed prose prose-sm max-w-none [&_br]:block [&_p]:my-1 [&_img]:hidden break-words"
                  dangerouslySetInnerHTML={{ __html: u.body }}
                />
                <Separator className="mt-3" />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
