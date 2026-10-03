import { describe, expect, it, vi } from "vitest";

// These cases exercise the gate itself, so force it on regardless of the
// shipped switch.
vi.mock("./hitBankGate", () => ({ HIT_BANK_GATE_ENABLED: true }));
import { classifyForCashFlow, classifyForCashFlowSecondary, computeCashFlow, businessDaysSince } from "./cashflow";
import type { Claim } from "./types";
import type { SecClaim } from "@/components/claims/SecondaryBoard";

const today = new Date(2026, 9, 9); // Fri 10/9/2026

function primary(p: Partial<Claim>): Claim {
  return {
    id: "c1", mondayItemId: "1", patientName: "Jane", primaryPayor: "United Healthcare",
    primaryStatus: "Review", estPay: 100, primaryPaid: 100, prAmount: 0, rawEraDate: null,
    claimId: "X", lines: [], dos: "2026-09-01", claimSentDate: "2026-09-02",
    ...p,
  } as unknown as Claim;
}

describe("Hit Bank gate in cash flow", () => {
  it("counts business days", () => {
    expect(businessDaysSince("2026-10-02", today)).toBe(5); // Fri -> Fri
    expect(businessDaysSince("2026-10-08", today)).toBe(1);
  });

  it("paid within 3 business days and not in bank stays in Finalized, not Paid", () => {
    expect(classifyForCashFlow(primary({ primaryPaidDate: "2026-10-06" }), today)).toBe("soonEra");
  });

  it("paid more than 3 business days ago and not in bank gets its own bucket", () => {
    expect(classifyForCashFlow(primary({ primaryPaidDate: "2026-10-02" }), today)).toBe("notInBankLate");
  });

  it("Hit Bank = Yes settles", () => {
    expect(classifyForCashFlow(primary({ primaryPaidDate: "2026-10-02", hitBank: "Yes" }), today)).toBe("settled");
  });

  it("pre-gate pay dates keep the old behaviour", () => {
    expect(classifyForCashFlow(primary({ primaryPaidDate: "2026-09-20" }), today)).toBe("settled");
  });

  it("$0 paid doesn't wait on the bank", () => {
    expect(classifyForCashFlow(primary({ primaryPaidDate: "2026-10-02", primaryPaid: 0 }), today)).toBe("settled");
  });

  it("Stripe patient payment waits on the payout", () => {
    const sec = {
      id: "s1", patientName: "Bob", status: "Patient Paid", remaining: 40,
      patientPaidDate: "2026-10-01", patientPaidAmount: 40,
    } as unknown as SecClaim;
    expect(classifyForCashFlowSecondary(sec, today)).toBe("notInBankLate");
    expect(classifyForCashFlowSecondary({ ...sec, hitBank: "Yes" } as SecClaim, today)).toBe("out");
  });

  it("builds the tile stats", () => {
    const stats = computeCashFlow(
      [
        primary({ id: "a", primaryPaidDate: "2026-10-02", hitBank: "Mismatch", primaryPaid: 120 }),
        primary({ id: "b", primaryPaidDate: "2026-09-29", primaryPaid: 80 }),
        primary({ id: "c", primaryPaidDate: "2026-10-08", primaryPaid: 50 }),
      ],
      [],
      today,
    );
    expect(stats.notInBank.count).toBe(2);
    expect(stats.notInBank.total).toBe(200);
    expect(stats.notInBankMismatch.count).toBe(1);
    expect(stats.notInBankOver7.count).toBe(1); // 9/29 -> 10/9 = 8 business days
    expect(stats.soonEra.count).toBe(1);
    expect(stats.totalOpen.total).toBe(250);
  });
});
