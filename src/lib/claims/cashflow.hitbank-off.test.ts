import { describe, expect, it, vi } from "vitest";
import { classifyForCashFlow } from "./cashflow";
import type { Claim } from "./types";

vi.mock("./hitBankGate", () => ({ HIT_BANK_GATE_ENABLED: false }));

const today = new Date(2026, 9, 9); // Fri 10/9/2026

describe("Hit Bank gate switched off", () => {
  it("a past pay date counts as settled even with Hit Bank? blank", () => {
    const c = {
      id: "c1", mondayItemId: "1", patientName: "Jane", primaryPayor: "United Healthcare",
      primaryStatus: "Paid", estPay: 100, primaryPaid: 100, prAmount: 0, rawEraDate: null,
      claimId: "X", lines: [], dos: "2026-09-01", claimSentDate: "2026-09-02",
      primaryPaidDate: "2026-10-02",
    } as unknown as Claim;
    expect(classifyForCashFlow(c, today)).toBe("settled");
  });
});
