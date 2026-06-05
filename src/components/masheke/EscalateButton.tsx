/**
 * EscalateButton — when onOpenForm is provided, clicking opens the
 * escalation form modal AND toggles local state. Falls back to simple
 * toggle if onOpenForm is not provided (backward compat).
 */
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  escalated: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** If provided, clicking Escalate opens the form modal instead of just toggling */
  onOpenForm?: () => void;
}

export function EscalateButton({ escalated, onToggle, disabled, onOpenForm }: Props) {
  const handleClick = () => {
    if (onOpenForm && !escalated) {
      // Open the form — also toggle local state so the button reflects "Escalated"
      onToggle();
      onOpenForm();
    } else {
      onToggle();
    }
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button
        onClick={handleClick}
        disabled={disabled}
        size="lg"
        variant="outline"
        className={
          escalated
            ? "gap-2 border-red-500 bg-red-100 text-red-800 hover:bg-red-200 hover:text-black"
            : "gap-2 border-red-400 bg-red-50 text-red-700 hover:bg-red-100 hover:text-black"
        }
      >
        {escalated ? (
          <>
            <Check className="h-4 w-4" />
            Escalated
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4" />
            Escalate
          </>
        )}
      </Button>
      {escalated && (
        <p className="text-[11px] text-red-500">
          Escalation form submitted.
        </p>
      )}
    </div>
  );
}
