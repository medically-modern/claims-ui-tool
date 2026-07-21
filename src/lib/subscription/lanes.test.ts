import { describe, expect, it } from "vitest";
import {
  addDaysIso, blockReasons, checkInDue, getLane, isBlocked, isReady,
  needsReason, possiblyResolved, reasonResolved, shipCandidate, todayIso,
} from "./lanes";
import type { LanePatient } from "./lanes";
import type { Checkpoint, PatientFinancials } from "@/components/subscription/mockData";

const TODAY = "2026-07-21";

const ok:      Checkpoint = { tone: "ok",      label: "Valid" };
const bad:     Checkpoint = { tone: "bad",     label: "Inactive" };
const waiting: Checkpoint = { tone: "pending", label: "Awaiting" };
const notSent: Checkpoint = { tone: "pending", label: "Not sent" };

const FIN: PatientFinancials = {
  sensorsRevenue: 0, sensorsCost: 0, sensorsGP: 0,
  suppliesRevenue: 0, suppliesCost: 0, suppliesGP: 0,
  shippingCost: 0, totalRevenue: 0, totalCost: 0,
  totalGP: 187, arr: 0, arp: 0,
};

function patient(over: Partial<LanePatient> = {}): LanePatient {
  return {
    id: "1", mondayItemId: "1", name: "Test Patient", phone: "555",
    primaryPayer: "Medicaid", nextOrderDate: "2026-07-20",
    subscriptionType: "Supplies", runCheck: "—", patientStatus: "Active",
    confirmation: ok, benefits: ok, auth: ok, lastPaid: ok,
    ...over,
  } as LanePatient;
}

describe("lane derivation", () => {
  it("future order date → scheduled", () => {
    expect(getLane(patient({ nextOrderDate: "2026-08-01" }), TODAY)).toBe("scheduled");
  });
  it("no order date → scheduled (nothing actionable)", () => {
    expect(getLane(patient({ nextOrderDate: "" }), TODAY)).toBe("scheduled");
  });
  it("order date today → due", () => {
    expect(getLane(patient({ nextOrderDate: "2026-07-21" }), TODAY)).toBe("due");
  });
  it("order 4 days past, NO block reason → still due, never auto-paused", () => {
    // The Thursday-order-on-Monday rule: not gotten to yet ≠ blocked.
    expect(getLane(patient({ nextOrderDate: "2026-07-17" }), TODAY)).toBe("due");
  });
  it("block reason set → blocked regardless of date", () => {
    expect(getLane(patient({ nextOrderDate: "2026-08-01", pauseReason: "Waiting on Patient" }), TODAY)).toBe("blocked");
    expect(getLane(patient({ nextOrderDate: "2026-07-01", patientStatus: "Paused" }), TODAY)).toBe("blocked");
  });
  it("Paused with no reason → blocked + flagged for triage", () => {
    const p = patient({ patientStatus: "Paused" });
    expect(isBlocked(p)).toBe(true);
    expect(needsReason(p)).toBe(true);
  });
  it("multi-select reasons parse", () => {
    expect(blockReasons(patient({ pauseReason: "Waiting on Patient, Last Order Unpaid" })))
      .toEqual(["Waiting on Patient", "Last Order Unpaid"]);
  });
});

describe("resolution watchers", () => {
  it("Inactive Insurance resolves when eligibility comes back Active", () => {
    const p = patient({ patientStatus: "Paused", pauseReason: "Inactive Insurance", active: "Active" });
    expect(possiblyResolved(p)).toBe(true);
    expect(possiblyResolved(patient({ ...p, active: "Inactive" }))).toBe(false);
  });
  it("auth reasons resolve on green auth checkpoint", () => {
    expect(reasonResolved(patient({ auth: ok }), "Need new auth")).toBe(true);
    expect(reasonResolved(patient({ auth: bad }), "Patient needs dr appt")).toBe(false);
  });
  it("Last Order Unpaid needs Primary Fully Paid AND Secondary ∈ {Fully Paid, None, blank}", () => {
    const base = { patientStatus: "Paused" as const, pauseReason: "Last Order Unpaid" };
    expect(possiblyResolved(patient({ ...base, primaryClaimPaid: "Fully Paid", secondaryClaimPaid: "None" }))).toBe(true);
    expect(possiblyResolved(patient({ ...base, primaryClaimPaid: "Fully Paid", secondaryClaimPaid: "" }))).toBe(true);
    expect(possiblyResolved(patient({ ...base, primaryClaimPaid: "Partial",    secondaryClaimPaid: "None" }))).toBe(false);
    expect(possiblyResolved(patient({ ...base, primaryClaimPaid: "Fully Paid", secondaryClaimPaid: "Outstanding" }))).toBe(false);
    expect(possiblyResolved(patient({ ...base, primaryClaimPaid: "Denied" }))).toBe(false);
  });
  it("Waiting on Patient resolves on INBOUND contact since block", () => {
    const base = { patientStatus: "Paused" as const, pauseReason: "Waiting on Patient", blockedDate: "2026-07-10" };
    expect(possiblyResolved(patient({ ...base, lastPatientContact: "2026-07-15T14:03 in sms" }))).toBe(true);
    expect(possiblyResolved(patient({ ...base, lastPatientContact: "2026-07-05T14:03 in sms" }))).toBe(false);
    expect(possiblyResolved(patient({ ...base, lastPatientContact: "2026-07-15T14:03 out sms" }))).toBe(false);
    expect(possiblyResolved(patient({ ...base }))).toBe(false);
  });
  it("multi-reason blocks need EVERY reason resolved", () => {
    const p = patient({
      patientStatus: "Paused",
      pauseReason: "Waiting on Patient, Last Order Unpaid",
      lastPatientContact: "2026-07-15T14:03 in sms", blockedDate: "2026-07-10",
      primaryClaimPaid: "Partial",
    });
    expect(possiblyResolved(p)).toBe(false);
    expect(possiblyResolved({ ...p, primaryClaimPaid: "Fully Paid", secondaryClaimPaid: "None" } as LanePatient)).toBe(true);
  });
  it("'Other' never auto-resolves", () => {
    expect(possiblyResolved(patient({ patientStatus: "Paused", pauseReason: "Other", active: "Active" }))).toBe(false);
  });
});

describe("check-in due", () => {
  it("fires on/after the check-in date, only for blocked patients", () => {
    expect(checkInDue(patient({ patientStatus: "Paused", pauseReason: "Waiting on Patient", checkInDate: "2026-07-21" }), TODAY)).toBe(true);
    expect(checkInDue(patient({ patientStatus: "Paused", pauseReason: "Waiting on Patient", checkInDate: "2026-07-25" }), TODAY)).toBe(false);
    expect(checkInDue(patient({ checkInDate: "2026-07-01" }), TODAY)).toBe(false); // not blocked
  });
});

describe("ship-without-confirmation candidate (suggestion only)", () => {
  const candidate = () => patient({
    confirmation: waiting, benefits: ok, auth: ok, lastPaid: ok,
    oopEstimate: "$42", financials: FIN,
  });
  it("qualifies: awaiting reply + 3 green + OOP<$100 + GP>$100", () => {
    expect(shipCandidate(candidate()).ok).toBe(true);
  });
  it("disqualified when already confirmed (no badge needed)", () => {
    expect(shipCandidate({ ...candidate(), confirmation: ok } as LanePatient).ok).toBe(false);
  });
  it("disqualified when text not sent yet", () => {
    expect(shipCandidate({ ...candidate(), confirmation: notSent } as LanePatient).ok).toBe(false);
  });
  it("disqualified on unreviewed changes", () => {
    expect(shipCandidate({ ...candidate(), confirmation: { ...waiting, changes: ["new CGM"] } } as LanePatient).ok).toBe(false);
  });
  it("disqualified when any other checkpoint isn't green", () => {
    expect(shipCandidate({ ...candidate(), benefits: bad } as LanePatient).ok).toBe(false);
  });
  it("disqualified on OOP ≥ $100 or GP ≤ $100", () => {
    expect(shipCandidate({ ...candidate(), oopEstimate: "$250" } as LanePatient).ok).toBe(false);
    expect(shipCandidate({ ...candidate(), financials: { ...FIN, totalGP: 40 } } as LanePatient).ok).toBe(false);
  });
  it("unknown OOP (no estimate, no deductible) ≠ candidate", () => {
    expect(shipCandidate({ ...candidate(), oopEstimate: "" } as LanePatient).ok).toBe(false);
  });
  it("falls back to deductible remaining when estimate is blank", () => {
    expect(shipCandidate({ ...candidate(), oopEstimate: "", dedRemaining: "$0" } as LanePatient).ok).toBe(true);
  });
});

describe("readiness (Order Prep vs Ready to Order)", () => {
  it("all 4 checks green → ready, even before the order date", () => {
    expect(isReady(patient({ nextOrderDate: "2026-08-10" }))).toBe(true);
  });
  it("backend-promoted Ordering Cycle → ready even if a check hasn't rendered green", () => {
    expect(isReady(patient({ confirmation: waiting, orderingCycle: "Ready to Order" }))).toBe(true);
  });
  it("any non-green check without promotion → prep", () => {
    expect(isReady(patient({ auth: bad }))).toBe(false);
    expect(isReady(patient({ confirmation: waiting }))).toBe(false);
  });
  it("blocked is NEVER ready, even with all green", () => {
    expect(isReady(patient({ patientStatus: "Paused", pauseReason: "Other" }))).toBe(false);
    expect(isReady(patient({ pauseReason: "Waiting on Patient", orderingCycle: "Ready to Order" }))).toBe(false);
  });
});

describe("date helpers", () => {
  it("todayIso formats and addDaysIso adds", () => {
    const base = new Date(2026, 6, 21); // July 21 2026 local
    expect(todayIso(base)).toBe("2026-07-21");
    expect(addDaysIso(14, base)).toBe("2026-08-04");
  });
});
