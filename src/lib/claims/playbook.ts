import { UNIQUE_COMBOS } from "@/lib/claims/uniqueCombos";

// Build CARC -> full remark text, RARC -> full remark text from the playbook
const carcRemarkMap = new Map<string, string>();
const rarcRemarkMap = new Map<string, string>();

for (const row of UNIQUE_COMBOS) {
  const carcCodes = String(row["CARC Code(s)"] ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rarcCodes = String(row["RARC Code(s)"] ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const carcRemarks = String(row["CARC Remarks"] ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const rarcRemarks = String(row["RARC Remarks"] ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  carcCodes.forEach((code) => {
    const match = carcRemarks.find((r) => new RegExp(`(^|[^0-9])${code}\\b`).test(r));
    if (match && !carcRemarkMap.has(code)) carcRemarkMap.set(code, match);
  });
  rarcCodes.forEach((code) => {
    const match = rarcRemarks.find((r) => new RegExp(`^${code}\\b`).test(r));
    if (match && !rarcRemarkMap.has(code)) rarcRemarkMap.set(code, match);
  });
}

export function carcPlaybookText(code: string | number): string | null {
  const key = String(code).replace(/^CO-?/i, "").replace(/^PR-?/i, "").trim();
  return carcRemarkMap.get(key) ?? null;
}

export function rarcPlaybookText(code: string): string | null {
  return rarcRemarkMap.get(code.trim()) ?? null;
}

// Interpreted denial reason for a (CARC[], RARC[]) tuple — pulled straight from playbook.
// Prefers the verified analysis; falls back to the classifier's Denial Analysis.
export function lookupDenialAnalysis(carc: (string | number)[], rarc: string[]): string | null {
  const carcKey = [...carc].map((c) => String(c).trim()).sort().join(",");
  const rarcKey = [...rarc].map((c) => c.trim()).sort().join(",");

  let bestExact: string | null = null;
  let bestPartial: string | null = null;

  for (const row of UNIQUE_COMBOS) {
    const rowCarc = String(row["CARC Code(s)"] ?? "")
      .split(/[,;]/).map((s) => s.trim()).filter(Boolean).sort().join(",");
    const rowRarc = String(row["RARC Code(s)"] ?? "")
      .split(/[,;]/).map((s) => s.trim()).filter(Boolean).sort().join(",");

    const verified = String(row["Verified: Denial Analysis"] ?? "").toLowerCase() === "yes";
    const reason =
      (verified ? String(row["Denial Analysis"] ?? "") : "") ||
      String(row["Denial Analysis"] ?? "");
    if (!reason) continue;

    if (rowCarc === carcKey && rowRarc === rarcKey) {
      bestExact = reason;
      if (verified) return reason;
    } else if (!bestPartial && rowCarc === carcKey) {
      bestPartial = reason;
    }
  }
  return bestExact ?? bestPartial;
}
