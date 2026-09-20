import { describe, expect, it } from "vitest";
import { fulfillmentOf } from "./orderFulfillment";

describe("orderFulfillment", () => {
  it("Hermy Sep 8: backordered line dropped + substituted, substitution shipped → Fully shipped", () => {
    const detail = [
      "ORDER STATUS 9/11/2026, 16:01:21 ET",
      "L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)",
      "L1 TN1013310I x3 BX @30.95 -> SHIPPED",
      "   SHIP FedEx 537924437056 qty 3 on 2026-09-08 from NEW JERSEY WAREHOUSE",
      "L2 TN1002817I xnull BX @71.94 -> Deleted",
      "SUBSTITUTED (dropped by Cardinal): TN1002817I",
      "SUBSTITUTION ORDER 1121071396",
      "L1 TN1001680I x3 BX @71.94 -> SHIPPED",
      "   SHIP FedEx 537926241582 qty 3 on 2026-09-10 from NEW JERSEY WAREHOUSE",
    ].join("\n");
    const s = fulfillmentOf(detail);
    expect(s.status).toBe("shipped");
    expect(s.backorderedSkus).toEqual([]);
    expect(s.shipments.map((x) => x.tracking)).toEqual(["537924437056", "537926241582"]);
  });

  it("Zeneida: one line shipped, one still backordered (no substitution) → Partially shipped", () => {
    const detail = [
      "ORDER STATUS 9/19/2026, 01:20:30 ET",
      "L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)",
      "L1 TN1013310I x3 BX @30.95 -> SHIPPED",
      "   SHIP FedEx 526812700947 qty 3 on 2026-08-18 from NEW JERSEY WAREHOUSE",
    ].join("\n");
    const s = fulfillmentOf(detail);
    expect(s.status).toBe("partial");
    expect(s.backorderedSkus).toEqual(["TN1002817I"]);
  });

  it("Peggy: $0 welcome kit + real line shipped → Fully shipped (ignore welcome)", () => {
    const detail = [
      "ORDER STATUS 9/20/2026, 19:01:48 ET",
      "L2 00MMWELCOME xnull EA @0 -> SHIPPED",
      "L1 TW7874701I x6 EA @79.32 -> Accepted",
      "   SHIP FedEx 541285631129 qty 6 on 2026-09-17 from CALIFORNIA WAREHOUSE",
    ].join("\n");
    const s = fulfillmentOf(detail);
    expect(s.status).toBe("shipped");
    expect(s.shipments).toHaveLength(1);
  });

  it("empty detail → unknown", () => {
    expect(fulfillmentOf("").status).toBe("unknown");
  });
});
