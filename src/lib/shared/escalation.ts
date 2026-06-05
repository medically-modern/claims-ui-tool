/**
 * Shared escalation utilities — column IDs, form data shape, serialization.
 *
 * Each board that supports escalation has a dedicated "Escalation Notes"
 * long_text column created specifically for storing the structured form data.
 */

// ── Escalation Notes column IDs per board ────────────────────
export const ESCALATION_NOTES_COL: Record<number, string> = {
  18406060017: "long_text_mm3j43qk",  // Medical Evaluation
  18410601299: "long_text_mm3jrssp",  // Insurance
  18410804557: "long_text_mm3jgh1y",  // Welcome Call
};

// ── Form data shape ──────────────────────────────────────────
export interface EscalationFormData {
  repName: string;
  issueSummary: string;
  whatTried: string;
  managerAsk: string;
  urgency: "Low" | "Medium" | "High" | "Urgent";
  submittedAt: string; // ISO date string
}

// ── Serialize / parse ────────────────────────────────────────

/** Serialize form data to a human-readable text block for Monday long_text */
export function serializeEscalation(data: EscalationFormData): string {
  return [
    `[ESCALATION FORM]`,
    `Submitted: ${new Date(data.submittedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`,
    ``,
    `Rep Name: ${data.repName}`,
    `Urgency: ${data.urgency}`,
    ``,
    `Issue Summary:`,
    data.issueSummary,
    ``,
    `What Have You Tried:`,
    data.whatTried,
    ``,
    `Manager Ask:`,
    data.managerAsk,
    `[/ESCALATION FORM]`,
  ].join("\n");
}

/** Parse escalation form data from the Monday long_text value */
export function parseEscalation(text: string | undefined | null): EscalationFormData | null {
  if (!text) return null;
  const match = text.match(/\[ESCALATION FORM\]([\s\S]*?)\[\/ESCALATION FORM\]/);
  if (!match) return null;
  const block = match[1];

  const field = (label: string): string => {
    const re = new RegExp(`${label}:\\s*(.+)`, "i");
    const m = block.match(re);
    return m?.[1]?.trim() ?? "";
  };

  const multiField = (label: string): string => {
    const re = new RegExp(`${label}:\\s*\\n([\\s\\S]*?)(?=\\n(?:Rep Name|Urgency|Issue Summary|What Have You Tried|Manager Ask|\\[/ESCALATION)|$)`, "i");
    const m = block.match(re);
    return m?.[1]?.trim() ?? field(label);
  };

  const urgencyRaw = field("Urgency");
  const urgency = (["Low", "Medium", "High", "Urgent"].includes(urgencyRaw) ? urgencyRaw : "Medium") as EscalationFormData["urgency"];

  return {
    repName: field("Rep Name"),
    issueSummary: multiField("Issue Summary"),
    whatTried: multiField("What Have You Tried"),
    managerAsk: multiField("Manager Ask"),
    urgency,
    submittedAt: field("Submitted") || new Date().toISOString(),
  };
}
