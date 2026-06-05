/**
 * Drag-and-drop / click-to-browse uploader for the Insurance board's
 * Final Clinicals file column. Used on the Auth Outstanding page next
 * to the Clinicals download button.
 *
 * Renders as a sized drop-zone (not a button) so the drag-and-drop
 * affordance is obvious at a glance.
 */
import { useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { uploadFileToColumn, COL } from "@/lib/samantha/mondayApi";
import { cn } from "@/lib/utils";

interface Props {
  itemId: string;
  /** Optional callback when uploads finish successfully — useful for
   *  refreshing a sibling Clinicals counter. */
  onUploaded?: () => void;
}

const ACCEPTED_MIME_FALLBACK = "application/octet-stream";

function inferMimeType(file: File): string {
  if (file.type) return file.type;
  // Browsers occasionally hand back an empty type; fall back to
  // extension-based heuristic for the common cases the team uses.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return ACCEPTED_MIME_FALLBACK;
  }
}

export function FinalClinicalsUpload({ itemId, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    if (!itemId || uploading) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    const failures: string[] = [];
    for (const file of list) {
      try {
        const buf = await file.arrayBuffer();
        await uploadFileToColumn(
          itemId,
          COL.finalClinicals,
          new Uint8Array(buf),
          file.name,
          inferMimeType(file),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[FinalClinicalsUpload] failed for ${file.name}:`, msg);
        failures.push(`${file.name}: ${msg}`);
      }
    }
    setUploading(false);

    const succeeded = list.length - failures.length;
    if (succeeded > 0) {
      toast.success(
        `Uploaded ${succeeded} file${succeeded > 1 ? "s" : ""} to Final Clinicals`,
      );
      onUploaded?.();
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} file${failures.length > 1 ? "s" : ""} failed`,
        { description: failures[0] },
      );
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading || !itemId) return;
    if (!e.dataTransfer?.files?.length) return;
    void handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (uploading || !itemId) return;
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const onClick = () => {
    if (uploading || !itemId) return;
    inputRef.current?.click();
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-disabled={!itemId || uploading}
      className={cn(
        "min-w-[260px] rounded-lg border-2 border-dashed px-4 py-3 transition-all cursor-pointer select-none",
        "flex items-center gap-3 text-left",
        dragOver
          ? "border-primary bg-primary/10 ring-2 ring-primary/30"
          : "border-border bg-muted/40 hover:border-primary/60 hover:bg-muted/60",
        (!itemId || uploading) && "opacity-60 cursor-not-allowed",
      )}
      title="Drag files here or click to upload to Final Clinicals on Monday"
    >
      <div
        className={cn(
          "h-10 w-10 rounded-md flex items-center justify-center shrink-0 transition-colors",
          dragOver ? "bg-primary text-primary-foreground" : "bg-background border",
        )}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <UploadCloud className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">
          {uploading
            ? "Uploading…"
            : dragOver
              ? "Drop to upload"
              : "Upload Auth Docs"}
        </p>
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
          {uploading
            ? "Saving to Final Clinicals on Monday"
            : "Drag files here or click to browse"}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (!e.target.files) return;
          void handleFiles(e.target.files);
          // Reset so re-selecting the same file fires onChange again
          e.target.value = "";
        }}
      />
    </div>
  );
}
