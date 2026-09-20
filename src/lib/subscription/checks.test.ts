import { describe, expect, it } from "vitest";
import { deriveChecks, type CheckInputs } from "./checks";

const TODAY = "2026-09-20";

/** A commercial reorder that passes everything on the column alone. */
const CLEAN: CheckInputs = {
  today: TODAY,
  primaryInsurance: "Horizon BCBS",
  orderDate: "2026-09-25",
  orderType: "Reorder",
  subscriptionType: "Sensors & Supplies",
  patientOrderResponse: "Confirmed",
  patientInsuranceResponse: "",
  patientHelpMessage: "",
  patientChangeSummary: "",
  reorderTextSent: "sent",
  coordinatorNotes: "",
  notesUpdatedAt: null,
  lastPatientContact: "",
  oopEstimate: "$0.00",
  totalGp: "300",
  correspondenceReviewed: "",
  confirmOverride: "",
  active: "Active",
  runCheck: "",
  lastEligibilityError: "",
  facilityFlags: "",
  lastEligibilityCheck: "2026-09-19",
  cobCheck: "OK",
  suggestedPrimary: "Horizon BCBS",
  sensorsAuthStatus: "Auth Valid",
  suppliesAuthStatus: "No Auth Needed",
  triggerDvs: "",
  claimsStatus: "",
  insuranceChange: "No",
  primaryClaimPaid: "Fully Paid",
  secondaryClaimPaid: "None",
  secondaryAmount: "",
  mnExpiry: "2027-01-01",
  referralSource: "Tandem",
};

function run(over: Partial<CheckInputs>) {
  return deriveChecks({ ...CLEAN, ...over });
}

describe("dark marks — the column decided", () => {
  it("a clean row is five dark greens with no rule attached", () => {
    const d = run({});
    for (const c of [d.confirmation, d.benefits, d.auth, d.lastPaid, d.mr]) {
      expect(c.tone).toBe("ok");
      expect(c.light).toBeUndefined();
      expect(c.ruleId).toBeUndefined();
    }
    expect(d.firstOrder).toBe(false);
    expect(d.payerGroup).toBe("commercial");
    expect(d.flags).toEqual([]);
  });
  it("Cancel / Pause is a dark red for everyone, whatever the money says", () => {
    const c = run({ patientOrderResponse: "Cancel", oopEstimate: "$0", totalGp: "500" }).confirmation;
    expect(c.tone).toBe("bad");
    expect(c.light).toBeUndefined();
    expect(run({ patientOrderResponse: "Pause", primaryInsurance: "Medicaid" }).confirmation.tone).toBe("bad");
  });
  it("Delay counts as answered (the date already moved)", () => {
    const c = run({ patientOrderResponse: "Delay" }).confirmation;
    expect(c.tone).toBe("ok");
    expect(c.delayed).toBe(true);
  });
});

describe("Confirm — decided per patient", () => {
  it("No Response + no OOP + profitable → light green", () => {
    const c = run({ patientOrderResponse: "No Response" }).confirmation;
    expect(c).toMatchObject({ tone: "ok", light: true, ruleId: "confirm.no-reply-ok", label: "No reply" });
    expect(c.why).toContain("No reply is acceptable");
  });
  it("blank response keeps the Not sent / Awaiting label the Comms sheet reads", () => {
    expect(run({ patientOrderResponse: "", reorderTextSent: "" }).confirmation.label).toBe("Not sent");
    expect(run({ patientOrderResponse: "", reorderTextSent: "x" }).confirmation.label).toBe("Awaiting");
  });
  it("No Response + OOP over $5 → light red", () => {
    const c = run({ patientOrderResponse: "No Response", oopEstimate: "$42.10" }).confirmation;
    expect(c).toMatchObject({ tone: "bad", light: true, ruleId: "confirm.oop-over-threshold" });
    expect(c.why).toContain("$42.10");
  });
  it("No Response + money-losing fill → light red, even on Medicaid", () => {
    const c = run({ primaryInsurance: "Medicaid", patientOrderResponse: "No Response", totalGp: "-12" }).confirmation;
    expect(c).toMatchObject({ tone: "bad", light: true, ruleId: "confirm.fill-loses-money" });
  });
  it("blank OOP inside 18 days: light red and the row carries the OOP-unknown badge", () => {
    const d = run({ patientOrderResponse: "No Response", oopEstimate: "" });
    expect(d.confirmation).toMatchObject({ tone: "bad", light: true, ruleId: "confirm.oop-unknown" });
    expect(d.flags.map((f) => f.id)).toEqual(["oop-unknown"]);
  });
  it("the badge is raised even when the column already answered", () => {
    const d = run({ patientOrderResponse: "Confirmed", oopEstimate: "Incomplete benefits data" });
    expect(d.confirmation.tone).toBe("ok");
    expect(d.confirmation.light).toBeUndefined();
    expect(d.flags.map((f) => f.id)).toEqual(["oop-unknown"]);
  });
  it("keeps the read-before-ordering badge alongside the rule", () => {
    const c = run({ patientOrderResponse: "No Response", coordinatorNotes: "wants 90 days", notesUpdatedAt: Date.parse("2026-09-18T12:00:00Z") }).confirmation;
    expect(c.needsRead).toBeTruthy();
    expect(c.ruleId).toBe("confirm.no-reply-ok");
  });
});

describe("Confirm — operator decisions for this order", () => {
  it("an override for this order turns a no into a light green with the reason; for another order it does nothing", () => {
    const c = run({ patientOrderResponse: "No Response", oopEstimate: "$40", confirmOverride: "2026-09-20T14:05 BE for 2026-09-25 — confirmed by phone" }).confirmation;
    expect(c).toMatchObject({ tone: "ok", light: true, ruleId: "confirm.override" });
    expect(c.why).toContain("BE");
    expect(c.why).toContain("confirmed by phone");
    const stale = run({ patientOrderResponse: "No Response", oopEstimate: "$40", confirmOverride: "2026-09-20T14:05 BE for 2026-06-25 — old" }).confirmation;
    expect(stale.tone).toBe("bad");
  });
  it("a review stamp clears the badge for messages before it and not after", () => {
    const noteAt = Date.parse("2026-09-18T12:00:00");
    const before = run({ coordinatorNotes: "wants 90 days", notesUpdatedAt: noteAt, correspondenceReviewed: "2026-09-19T09:00 BE for 2026-09-25" }).confirmation;
    expect(before.needsRead).toBeUndefined();
    const after = run({ coordinatorNotes: "wants 90 days", notesUpdatedAt: noteAt, correspondenceReviewed: "2026-09-17T09:00 BE for 2026-09-25" }).confirmation;
    expect(after.needsRead).toBeTruthy();
  });
});

describe("Eligibility — facility flags, Active?, then the payer's conditions", () => {
  it("Deceased and Hospital/SNF are dark red for everyone", () => {
    expect(run({ facilityFlags: "Deceased" }).benefits).toMatchObject({ tone: "bad", label: "Deceased" });
    expect(run({ facilityFlags: "Hospital/SNF" }).benefits).toMatchObject({ tone: "bad", label: "Hospital/SNF" });
    expect(run({ active: "Hospital / SNF" }).benefits).toMatchObject({ tone: "bad", label: "Hospital/SNF" });
  });
  it("Hospice: light green on Medicare A&B, light red elsewhere", () => {
    const m = run({ facilityFlags: "Hospice", primaryInsurance: "Medicare A&B", suggestedPrimary: "Medicare A&B" }).benefits;
    expect(m).toMatchObject({ tone: "ok", light: true, ruleId: "elig.hospice-medicare" });
    const o = run({ facilityFlags: "Hospice" }).benefits;
    expect(o).toMatchObject({ tone: "bad", light: true, ruleId: "elig.hospice-other" });
  });
  it("Inactive / Medicare Advantage are dark red; Failed is amber", () => {
    expect(run({ active: "Inactive" }).benefits.tone).toBe("bad");
    expect(run({ active: "Medicare Advantage" }).benefits.tone).toBe("bad");
    expect(run({ active: "Failed" }).benefits).toMatchObject({ tone: "warn", label: "Failed Check" });
  });
  it("blank Active? is amber 'run it'; an in-flight check is '…'", () => {
    expect(run({ active: "" }).benefits).toMatchObject({ tone: "warn", label: "Not run" });
    expect(run({ active: "", runCheck: "Batch" }).benefits).toMatchObject({ tone: "pending", awaiting: true });
    expect(run({ active: "", runCheck: "Failed" }).benefits).toMatchObject({ tone: "warn", label: "Failed Check" });
  });
  it("Medicare freshness: Active but checked 12 days before the order → light red; 3 days → dark green", () => {
    const stale = run({ primaryInsurance: "Medicare A&B", suggestedPrimary: "Medicare A&B", lastEligibilityCheck: "2026-09-13" }).benefits;
    expect(stale).toMatchObject({ tone: "bad", light: true, ruleId: "elig.medicare-freshness" });
    expect(stale.why).toContain("7 days");
    const fresh = run({ primaryInsurance: "Medicare A&B", suggestedPrimary: "Medicare A&B", lastEligibilityCheck: "2026-09-22" }).benefits;
    expect(fresh).toMatchObject({ tone: "ok" });
    expect(fresh.light).toBeUndefined();
  });
  it("freshness is Medicare's rule only — a 40-day-old commercial check is dark green", () => {
    expect(run({ lastEligibilityCheck: "2026-08-10" }).benefits.light).toBeUndefined();
  });
  it("COB Other Primary Reported → light red, except on Medicaid", () => {
    expect(run({ cobCheck: "Other Primary Reported" }).benefits).toMatchObject({ tone: "bad", light: true, ruleId: "elig.cob-other-primary" });
    expect(run({ cobCheck: "Other Primary Reported", primaryInsurance: "Medicaid" }).benefits.tone).toBe("ok");
    // A blank COB is not a finding.
    expect(run({ cobCheck: "" }).benefits.tone).toBe("ok");
  });
  it("Suggested Primary naming a different payer → light red; Unknown / Failed / blank don't count", () => {
    expect(run({ suggestedPrimary: "Anthem BCBS Commercial" }).benefits).toMatchObject({ tone: "bad", light: true, ruleId: "elig.primary-mismatch" });
    for (const s of ["Unknown", "Failed", ""]) expect(run({ suggestedPrimary: s }).benefits.tone).toBe("ok");
    expect(run({ suggestedPrimary: "Fidelis Medicaid", primaryInsurance: "Medicaid" }).benefits.tone).toBe("ok");
  });
});

describe("Authorization", () => {
  it("the column speaks for commercial payers; blank is amber, not an outline", () => {
    expect(run({ sensorsAuthStatus: "Required" }).auth).toMatchObject({ tone: "warn" });
    const expired = run({ sensorsAuthStatus: "Auth. Expired" }).auth;
    expect(expired.tone).toBe("bad");
    expect(expired.light).toBeUndefined();
    expect(run({ sensorsAuthStatus: "Submitted", suppliesAuthStatus: "Submitted" }).auth.tone).toBe("pending");
    expect(run({ sensorsAuthStatus: "", suppliesAuthStatus: "" }).auth).toMatchObject({ tone: "warn", label: "Not set" });
  });
  it("Medicare A&B never needs one: Required reads light green, a pass reads dark green", () => {
    const m = { primaryInsurance: "Medicare A&B", suggestedPrimary: "Medicare A&B" };
    expect(run({ ...m, sensorsAuthStatus: "Required" }).auth).toMatchObject({ tone: "ok", light: true, ruleId: "auth.medicare-never" });
    expect(run({ ...m, sensorsAuthStatus: "No Auth Needed", suppliesAuthStatus: "Not Serving" }).auth.light).toBeUndefined();
  });
  it("Fidelis Low-Cost with a plan change → light red on a sensors patient, nothing on supplies-only", () => {
    const f = { primaryInsurance: "Fidelis Low-Cost", suggestedPrimary: "Fidelis Low-Cost", insuranceChange: "Yes" };
    expect(run(f).auth).toMatchObject({ tone: "bad", light: true, ruleId: "auth.fidelis-plan-change" });
    expect(run({ ...f, subscriptionType: "Supplies" }).auth.tone).toBe("ok");
    expect(run({ ...f, insuranceChange: "No" }).auth.tone).toBe("ok");
  });
  it("Medicaid with an order due follows the DVS ladder, dark", () => {
    const m = { primaryInsurance: "Medicaid", orderDate: "2026-09-18", subscriptionType: "Supplies" as const, suppliesAuthStatus: "Required" };
    expect(run({ ...m, triggerDvs: "" }).auth).toMatchObject({ tone: "warn", dvsNeeded: true, medicaidDvs: true });
    expect(run({ ...m, triggerDvs: "Running" }).auth).toMatchObject({ tone: "pending", awaiting: true });
    const cleared = run({ ...m, triggerDvs: "Success", claimsStatus: "Claims Paid" }).auth;
    expect(cleared.tone).toBe("ok");
    expect(cleared.light).toBeUndefined();
    expect(run({ ...m, triggerDvs: "Failed" }).auth.tone).toBe("bad");
  });
});

describe("Last claim paid", () => {
  it("Fully Paid + Outstanding secondary: light green on Medicare, amber elsewhere", () => {
    const o = { primaryClaimPaid: "Fully Paid", secondaryClaimPaid: "Outstanding", secondaryAmount: "48.2" };
    const m = run({ ...o, primaryInsurance: "Medicare A&B", suggestedPrimary: "Medicare A&B" }).lastPaid;
    expect(m).toMatchObject({ tone: "ok", light: true, ruleId: "claims.medicare-secondary-open" });
    const c = run(o).lastPaid;
    expect(c.tone).toBe("warn");
    expect(c.detail).toContain("$48.20 outstanding");
  });
  it("Denied is dark red; Partial / Outstanding primary is amber; blank primary is amber", () => {
    expect(run({ primaryClaimPaid: "Denied" }).lastPaid.tone).toBe("bad");
    expect(run({ primaryClaimPaid: "Partial" }).lastPaid.tone).toBe("warn");
    expect(run({ primaryClaimPaid: "Outstanding" }).lastPaid.tone).toBe("warn");
    expect(run({ primaryClaimPaid: "" }).lastPaid).toMatchObject({ tone: "warn", label: "Not recorded" });
  });
});

describe("Medical records", () => {
  it("expired records: light green normally, light red for District Endochrine; blank is light red", () => {
    expect(run({ mnExpiry: "2026-01-01" }).mr).toMatchObject({ tone: "ok", light: true, ruleId: "mr.expired-order-anyway" });
    expect(run({ mnExpiry: "2026-01-01", referralSource: "District Endochrine" }).mr).toMatchObject({ tone: "bad", light: true, ruleId: "mr.expired-hard-stop" });
    expect(run({ mnExpiry: "" }).mr).toMatchObject({ tone: "bad", light: true, ruleId: "mr.blank" });
  });
});

describe("First orders — nothing holds them", () => {
  const first = { orderType: "First Order" };
  it("every check that would not pass on its own passes by rule, light, and the row is Ready", () => {
    const d = run({
      ...first,
      patientOrderResponse: "", oopEstimate: "", totalGp: "",
      active: "", sensorsAuthStatus: "Required", primaryClaimPaid: "", mnExpiry: "",
    });
    for (const c of [d.confirmation, d.benefits, d.auth, d.lastPaid, d.mr]) {
      expect(c.tone).toBe("ok");
      expect(c.light).toBe(true);
      expect(c.ruleId).toBe("first-order");
    }
    expect(d.firstOrder).toBe(true);
    expect(d.flags).toEqual([]);
  });
  it("a check the column already passes stays dark", () => {
    const d = run(first);
    expect(d.confirmation.light).toBeUndefined();
    expect(d.mr.light).toBeUndefined();
  });
  it("a column that says no outright still stands: Cancel, Inactive, Deceased", () => {
    expect(run({ ...first, patientOrderResponse: "Cancel" }).confirmation.tone).toBe("bad");
    expect(run({ ...first, active: "Inactive" }).benefits.tone).toBe("bad");
    expect(run({ ...first, facilityFlags: "Deceased" }).benefits.tone).toBe("bad");
  });
  it("a Medicaid first order still shows the DVS tick as a hint, but does not block", () => {
    const d = run({ ...first, primaryInsurance: "Medicaid", orderDate: "2026-09-18", subscriptionType: "Supplies", suppliesAuthStatus: "Required" });
    expect(d.auth.tone).toBe("ok");
    expect(d.auth.dvsNeeded).toBe(true);
  });
});
