import { describe, expect, it } from "vitest";
import { lastClaimBanner, samePayer } from "./claimHistory";
import type { Claim } from "@/lib/claims/types";

const claim = (o: Partial<Claim>): Claim => ({
  id: "c", mondayItemId: "1", patientName: "P", dob: "", dos: "2026-07-14",
  primaryPayor: "Anthem BCBS Commercial", payorId: null, insuranceType: "", memberId: "",
  claimSentDate: null, primaryStatus: "Paid", status277: "None", rejected277Reason: null,
  claimStatusCategory: "None", claimStatusDetail: null, lastClaimStatusCheck: null,
  claimStatusPaidAmount: null, claimId: "c", payerClaimNumber: null,
  bankDepositTotal: null, bankPaymentMethod: null, bankPayerOriginatorId: null, bankEftDate: null, bankTraceNumber: null,
  estPay: 0, primaryPaid: 284.11, prAmount: 0, rawEraDate: null, rawEraClaimStatus: null, primaryPaidDate: null,
  secondaryPayer: null, denialAction: "None", claimResentDate: null, lateActionDate: null, nextActionDate: null,
  parentClaimItemId: null, claimType: null, placeOfService: null, groupId: null,
  patientAddressText: null, patientAddressState: null, activity: [], lines: [],
  ...o,
} as Claim);

describe("lastClaimBanner — runbook step 7, computed", () => {
  it("is clear when paid in full, $0 owed, same plan, same year", () => {
    const b = lastClaimBanner([claim({})], "Anthem BCBS Commercial", "2026-09-20");
    expect(b.tone).toBe("clear");
    expect(b.headline).toBe("Last claim 7/14 — paid in full, patient owed $0.");
    expect(b.flags).toEqual([]);
  });
  it("flags a plan change", () => {
    const b = lastClaimBanner([claim({})], "Horizon BCBS", "2026-09-20");
    expect(b.flags).toEqual(["plan-changed"]);
    expect(b.tone).toBe("caution");
  });
  it("flags a calendar-year rollover — the deductible reset", () => {
    const b = lastClaimBanner([claim({ dos: "2025-12-14" })], "Anthem BCBS Commercial", "2026-01-05");
    expect(b.flags).toEqual(["year-rolled"]);
  });
  it("flags money the patient owed last time", () => {
    const b = lastClaimBanner([claim({ prAmount: 42.5 })], "Anthem BCBS Commercial", "2026-09-20");
    expect(b.flags).toEqual(["patient-owed"]);
    expect(b.headline).toContain("patient owed $42.50");
  });
  it("uses the newest SETTLED claim, skipping one still in flight", () => {
    const inflight = claim({ dos: "2026-09-10", primaryStatus: "Submitted", primaryPaid: 0 });
    const b = lastClaimBanner([inflight, claim({})], "Anthem BCBS Commercial", "2026-09-20");
    expect(b.claim?.dos).toBe("2026-07-14");
  });
  it("says so when nothing has settled", () => {
    expect(lastClaimBanner([], "Aetna", "2026-09-20").tone).toBe("none");
  });
});

describe("samePayer", () => {
  it("survives spacing and punctuation drift between boards", () => {
    expect(samePayer("Anthem BCBS Commercial", "anthem bcbs  commercial")).toBe(true);
    expect(samePayer("Medicare A&B", "Medicare A & B")).toBe(true);
  });
  it("is false across real payer changes and blanks", () => {
    expect(samePayer("Aetna Commercial", "Aetna Medicare")).toBe(false);
    expect(samePayer("", "Aetna")).toBe(false);
  });
});
