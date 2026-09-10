import { describe, it, expect } from "vitest";
import { deriveStatus } from "@/api/queries/allSecondaryClaims";

// deriveStatus(submissionType, secondaryStatus, secondaryPaidAmount, rawEraDate, payorConfirmed)
describe("deriveStatus — Bill to Patient routing", () => {
  it("keeps an Insurance / Forwarded row with an ERA in ERA Review", () => {
    expect(deriveStatus("Forwarded", "Review", 0, "2026-06-30", true))
      .toBe("Secondary ERA Received");
    expect(deriveStatus("Insurance", "Review", 0, "2026-06-22", true))
      .toBe("Secondary ERA Received");
    expect(deriveStatus("Insurance", "Submitted", 120.5, "", true))
      .toBe("Secondary ERA Received");
  });

  it("routes a Bill-to-Patient row (Patient + Submit + ERA columns) to Submit > Patient", () => {
    // $0 secondary remit — the common case
    expect(deriveStatus("Patient", "Submit", 0, "2026-06-30", true))
      .toBe("Sent to Patient");
    // partial secondary payment
    expect(deriveStatus("Patient", "Submit", 50, "2026-06-30", true))
      .toBe("Sent to Patient");
  });

  it("follows the rest of the patient lifecycle even though ERA columns stay populated", () => {
    // Send Invoice clicked → Outstanding (bucketOf then uses sendInvoiceTriggered)
    expect(deriveStatus("Patient", "Outstanding", 0, "2026-06-30", true))
      .toBe("Sent to Patient");
    // Patient paid via Stripe → Josh's webhook writes Review
    expect(deriveStatus("Patient", "Review", 0, "2026-06-30", true))
      .toBe("Patient Paid");
    // Operator confirmed payment → terminal Paid
    expect(deriveStatus("Patient", "Paid", 0, "2026-06-30", true))
      .toBe("Secondary Paid");
    expect(deriveStatus("Patient", "Bad Debt", 0, "2026-06-30", true))
      .toBe("Bad Debt");
  });

  it("is unchanged for Patient rows that never had an ERA (Confirm Payor path)", () => {
    expect(deriveStatus("Patient", "Submit", 0, "", false))
      .toBe("Awaiting Payor Confirmation");
    expect(deriveStatus("Patient", "Submit", 0, "", true))
      .toBe("Sent to Patient");
    expect(deriveStatus("Patient", "Outstanding", 0, "", true))
      .toBe("Sent to Patient");
    expect(deriveStatus("Patient", "Review", 0, "", true))
      .toBe("Patient Paid");
  });

  it("still lets terminal operator statuses win for insurance rows with ERA data", () => {
    expect(deriveStatus("Forwarded", "Paid", 190.78, "2026-06-30", true))
      .toBe("Secondary Paid");
    expect(deriveStatus("Insurance", "Patient Paid", 0, "2026-06-30", true))
      .toBe("Patient Paid");
  });
});
