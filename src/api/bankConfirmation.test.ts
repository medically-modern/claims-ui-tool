import { describe, expect, it } from "vitest";
import { businessDaysBetween, groupDeposits, type ParkedClaim } from "./bankConfirmation";

function claim(p: Partial<ParkedClaim>): ParkedClaim {
  return {
    itemId: "1", board: "primary", patientName: "A", payer: "UHC", paid: 100,
    paidDate: "2026-09-21", method: "ACH", depositTotal: 250, eftDate: "2026-09-21",
    trace: "T1", checkNumber: "T1", originator: "O", stripeCharge: "", hitBank: "",
    ...p,
  };
}

describe("groupDeposits", () => {
  const today = new Date(2026, 8, 29); // Tue 9/29/2026

  it("rolls claims from one ACH (both boards) into one deposit", () => {
    const ds = groupDeposits([
      claim({ itemId: "1" }),
      claim({ itemId: "2", board: "secondary", paid: 150 }),
      claim({ itemId: "3", trace: "T2", checkNumber: "T2", depositTotal: 40, paid: 40 }),
    ], today);
    expect(ds).toHaveLength(2);
    const t1 = ds.find((d) => d.reference === "T1")!;
    expect(t1.claims).toHaveLength(2);
    expect(t1.claimPaidSum).toBe(250);
    expect(t1.depositTotal).toBe(250);
  });

  it("flags ACH overdue after 3 business days, checks after 10", () => {
    const [ach] = groupDeposits([claim({ eftDate: "2026-09-23" })], today); // Wed -> Tue = 4
    expect(ach.businessDaysWaiting).toBe(4);
    expect(ach.overdue).toBe(true);
    const [chk] = groupDeposits([claim({ method: "CHK", eftDate: "2026-09-23" })], today);
    expect(chk.overdue).toBe(false);
  });

  it("marks mismatch and keeps Stripe pays as their own deposit", () => {
    const ds = groupDeposits([
      claim({ itemId: "1", hitBank: "Mismatch" }),
      claim({ itemId: "9", board: "secondary", method: "", trace: "", checkNumber: "",
              depositTotal: null, stripeCharge: "ch_1", eftDate: null, paidDate: "2026-09-28" }),
    ], today);
    expect(ds.find((d) => d.kind === "ACH")!.mismatch).toBe(true);
    const s = ds.find((d) => d.kind === "Stripe")!;
    expect(s.reference).toBe("ch_1");
    expect(s.businessDaysWaiting).toBe(1);
  });

  it("claims with no reference stay separate", () => {
    const ds = groupDeposits([
      claim({ itemId: "1", trace: "", checkNumber: "" }),
      claim({ itemId: "2", trace: "", checkNumber: "" }),
    ], today);
    expect(ds).toHaveLength(2);
  });
});

describe("businessDaysBetween", () => {
  it("skips weekends", () => {
    expect(businessDaysBetween("2026-09-25", new Date(2026, 8, 28))).toBe(1); // Fri -> Mon
    expect(businessDaysBetween(null, new Date())).toBeNull();
  });
});
