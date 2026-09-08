import { describe, expect, it } from "vitest";

import { smsDelivery, smsDeliveryState, smsFailureReason } from "./smsDelivery";

/**
 * The failure marker has to be right in BOTH directions:
 *   a false negative → a text that never landed reads as delivered, which is
 *                      the bug this exists to fix (Brandon, 2026-08-20);
 *   a false positive → a message still in flight is marked undelivered and the
 *                      rep re-sends, double-texting the patient.
 */
describe("smsDeliveryState", () => {
  it("fails only on RingCentral's terminal failure statuses", () => {
    expect(smsDeliveryState("SendingFailed")).toBe("failed");
    expect(smsDeliveryState("DeliveryFailed")).toBe("failed");
  });

  it("treats in-flight statuses as pending, never failed", () => {
    for (const s of ["Queued", "Sent", "Received"]) {
      expect(smsDeliveryState(s), `${s} must not read as failed`).toBe("pending");
    }
  });

  it("treats a missing or unknown status as pending", () => {
    // An older record, or a field RC stopped sending, is an absence of
    // evidence — not evidence the text failed.
    expect(smsDeliveryState("")).toBe("pending");
    expect(smsDeliveryState(undefined)).toBe("pending");
    expect(smsDeliveryState("SomethingRingCentralAddedLater")).toBe("pending");
  });

  it("reports delivered only on Delivered", () => {
    expect(smsDeliveryState("Delivered")).toBe("delivered");
  });
});

describe("smsFailureReason", () => {
  it("names the bad-number case in the rep's terms", () => {
    for (const c of ["SMS-RC-410", "SMS-UP-410", "SMS-CAR-411", "SMS-CAR-400"]) {
      expect(smsFailureReason(c), c).toContain("can't receive texts");
    }
  });

  it("tells the rep NOT to re-send an opt-out", () => {
    expect(smsFailureReason("SMS-CAR-413")).toContain("opted out");
    expect(smsFailureReason("SMS-CAR-413")).toContain("don't re-send");
  });

  it("says when the fault is OURS, so nobody re-types a good number", () => {
    expect(smsFailureReason("SMS-CAR-414")).toContain("Our texting number");
  });

  it("still names a code it has never seen", () => {
    expect(smsFailureReason("SMS-CAR-999")).toContain("SMS-CAR-999");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(smsFailureReason(" sms-rc-410 ")).toBe(smsFailureReason("SMS-RC-410"));
  });

  it("still explains a failure that carries no code at all", () => {
    expect(smsFailureReason("")).toContain("Check the number on file");
    expect(smsFailureReason(undefined)).toContain("Check the number on file");
  });

  // Both call sites lead with "Not delivered", so a reason that repeated it
  // would read "Not delivered — RingCentral couldn't deliver it."
  it("reads correctly after a 'Not delivered' lead", () => {
    for (const c of ["", "SMS-CAR-999", "SMS-RC-410", "SMS-CAR-413"]) {
      expect(smsFailureReason(c), c).not.toMatch(/couldn't deliver/i);
    }
  });
});

describe("smsDelivery", () => {
  it("carries a reason only when it actually failed", () => {
    expect(smsDelivery({ messageStatus: "SendingFailed", deliveryError: "SMS-RC-410" })).toEqual({
      state: "failed",
      reason: expect.stringContaining("can't receive texts"),
    });
    expect(smsDelivery({ messageStatus: "Delivered" }).reason).toBeNull();
    expect(smsDelivery({ messageStatus: "Queued" }).reason).toBeNull();
  });

  // STATUS decides, CODE only explains. These two codes ride on messages that
  // were fine, so reading the code first would invent failures.
  it("does not fail a message on a carrier-didn't-report code alone", () => {
    expect(smsDelivery({ messageStatus: "Sent", deliveryError: "SMS-CAR-104" }).state).toBe("pending");
  });

  // ...and the inverse: an unrecognised code must never silence a real failure.
  it("still fails on an unknown code with a failed status", () => {
    const d = smsDelivery({ messageStatus: "SendingFailed", deliveryError: "SMS-XX-000" });
    expect(d.state).toBe("failed");
    expect(d.reason).toContain("SMS-XX-000");
  });
});
