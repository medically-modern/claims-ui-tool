import { describe, expect, it } from "vitest";
import { fulfillmentOf, orderProductLines, orderProgress } from "./orderFulfillment";

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

describe("orderProgress (one-glance lifecycle)", () => {
  const shippedDetail = [
    "L1 TN1013310I x3 BX @30.95 -> SHIPPED",
    "   SHIP FedEx 537924437056 qty 3 on 2026-09-08 from NJ",
    "SUBSTITUTED (dropped by Cardinal): TN1002817I",
    "SUBSTITUTION ORDER 1121071396",
    "L1 TN1001680I x3 BX @71.94 -> SHIPPED",
    "   SHIP FedEx 537926241582 qty 3 on 2026-09-10 from NJ",
  ].join("\n");

  it("Hermy: fully shipped + delivery date + a stale hold message → Delivered", () => {
    const p = orderProgress(shippedDetail, "Delivered", "2026-09-11");
    expect(p.stage).toBe("delivered");
    expect(p.substituted).toBe(true);
  });
  it("shipped, no delivery date → in transit", () => {
    expect(orderProgress(shippedDetail, "Partially Shipped", "").stage).toBe("shipped");
  });
  it("nothing shipped + error API status → error", () => {
    expect(orderProgress("", "Error", "").stage).toBe("error");
  });
  it("nothing shipped + accepted → accepted, awaiting ship", () => {
    const detail = "L1 TW7874701I x6 EA @79.32 -> Accepted";
    expect(orderProgress(detail, "Accepted", "").stage).toBe("accepted");
  });
  it("one shipped, one backordered → partial", () => {
    const detail = [
      "L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)",
      "L1 TN1013310I x3 BX @30.95 -> SHIPPED",
      "   SHIP FedEx 526812700947 qty 3 on 2026-08-18 from NJ",
    ].join("\n");
    expect(orderProgress(detail, "Partially Shipped", "").stage).toBe("partial");
  });
});

describe("orderProductLines", () => {
  it("Justin Hines: both products shipped (one via substitution) → two shipped rows, real names, own tracking", () => {
    const detail = [
      "ORDER STATUS 9/16/2026, 16:01:21 ET",
      "L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)",
      "L1 TN1013310I x3 BX @30.95 -> SHIPPED",
      "   SHIP FedEx 537924587259 qty 3 on 2026-09-15 from NEW JERSEY WAREHOUSE",
      "L2 TN1002817I xnull BX @71.94 -> Deleted",
      "SUBSTITUTED (dropped by Cardinal): TN1002817I",
      "SUBSTITUTION ORDER 1121071396",
      "L1 TN1002820I x3 BX @71.94 -> SHIPPED",
      "   SHIP FedEx 537926378160 qty 3 on 2026-09-16 from NEW JERSEY WAREHOUSE",
    ].join("\n");
    const lines = orderProductLines(detail);
    expect(lines).toHaveLength(2);
    const cart = lines.find((l) => l.sku === "TN1013310I")!;
    expect(cart.name).toBe("t:slim");
    expect(cart.cat).toBe("Cartridge");
    expect(cart.state).toBe("shipped");
    expect(cart.ship?.tracking).toBe("537924587259");
    // Dropped original folded into its substitution replacement (not shown twice).
    expect(lines.some((l) => l.sku === "TN1002817I")).toBe(false);
    const sub = lines.find((l) => l.sku === "TN1002820I")!;
    expect(sub.state).toBe("shipped");
    expect(sub.substitution).toBe(true);
    expect(sub.ship?.date).toBe("2026-09-16");
  });

  it("partial: one shipped, one still backordered → distinct per-product states", () => {
    const detail = [
      "ORDER STATUS 9/19/2026, 01:20:30 ET",
      "L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)",
      "L1 TN1013310I x3 BX @30.95 -> SHIPPED",
      "   SHIP FedEx 526812700947 qty 3 on 2026-08-18 from NEW JERSEY WAREHOUSE",
    ].join("\n");
    const lines = orderProductLines(detail);
    expect(lines.find((l) => l.sku === "TN1013310I")?.state).toBe("shipped");
    expect(lines.find((l) => l.sku === "TN1002817I")?.state).toBe("backordered");
  });

  it("ignores $0 welcome kit", () => {
    const detail = [
      "L2 00MMWELCOME xnull EA @0 -> SHIPPED",
      "L1 TW7874701I x6 EA @79.32 -> Accepted",
    ].join("\n");
    const lines = orderProductLines(detail);
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe("FreeStyle Libre 2 Plus");
  });
});
