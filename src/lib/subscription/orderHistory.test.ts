import { describe, expect, it } from "vitest";
import type { NewOrderRow } from "@/api/queries/newOrders";
import { orderItems, orderView, ordersForPatient, parseLineDetail, trackerSteps } from "./orderHistory";

const ROW: NewOrderRow = {
  id: "13076160232", name: "Clairetta Lowe", orderDate: "2026-09-18", orderStatus: "Process Claim",
  pumpType: "", cartridgeType: "Not Serving", infusionSet1Type: "", infusionSet2Type: "", cgmType: "FreeStyle Libre 3 Plus",
  qtyPump: "", qtyInfusionSet1: "0", qtyInfusionSet2: "", qtyCartridge: "0", qtyCgmSensors: "6", qtyCgmMonitor: "",
  primaryInsurance: "Medicare A&B", memberId: "1EG4", subscriptionType: "Sensors",
  orderType: "First Order", orderFrequency: "90-Days", dob: "05/10/1937", patientAddress: "",
  ddpOrder: "", apiStatus: "Delivered", apiMessage: "HOLD RELEASED; …", holdReason: "",
  backordered: "", backorderedQty: "", substituteSet: "", substitutionStatus: "", substitutionCah: "",
  cahOrderNumber: "1121404441", poNumber: "MM-13076160232-20260918", carrier: "FedEx",
  estShipDate: "", shipDate: "2026-09-18", deliveryDate: "2026-09-19", signedBy: "",
  trackingNumbers: ["541809550825"], confirmedAddress: "", lastCardinalSync: "9/19/2026, 20:02:52 ET",
  lineItemDetail: "ORDER STATUS 9/19/2026, 20:02:06 ET\nL1 TW7876801I x6 EA @79.32 -> SHIPPED\n   SHIP FedEx 541809550825 qty 6 on 2026-09-18 from TEXAS 4 WAREHOUSE\nL2 00MMWELCOME xnull EA @0 -> SHIPPED",
};

describe("ordersForPatient", () => {
  it("matches on name, newest first, and respects DOB when both sides have one", () => {
    const older = { ...ROW, id: "1", orderDate: "2026-06-18" };
    const other = { ...ROW, id: "2", dob: "01/01/1950" };
    const list = ordersForPatient([older, ROW, other], { name: "Clairetta Lowe", dob: "1937-05-10" });
    expect(list.map((o) => o.id)).toEqual(["13076160232", "1"]);
    // No DOB on the patient side → name alone.
    expect(ordersForPatient([other], { name: "clairetta lowe" })).toHaveLength(1);
  });
});

describe("orderItems", () => {
  it("lists only served lines with a quantity", () => {
    expect(orderItems(ROW)).toEqual([{ kind: "sensors", name: "FreeStyle Libre 3 Plus sensors", qty: "6" }]);
    const pump = { ...ROW, infusionSet1Type: 'AutoSoft 90 6 mm 23"', qtyInfusionSet1: "3", cartridgeType: "Mobi", qtyCartridge: "3", cgmType: "Not Serving", qtyCgmSensors: "" };
    expect(orderItems(pump).map((i) => i.name)).toEqual(['AutoSoft 90 6 mm 23"', "Mobi cartridges"]);
  });
});

describe("parseLineDetail", () => {
  it("reads lines and shipments, drops the welcome kit", () => {
    const p = parseLineDetail(ROW.lineItemDetail);
    expect(p.lines).toEqual([{ n: 1, sku: "TW7876801I", qty: "6", status: "SHIPPED" }]);
    expect(p.shipments).toEqual([{ carrier: "FedEx", tracking: "541809550825", shippedOn: "2026-09-18", delivered: "", qty: "6", from: "TEXAS 4 WAREHOUSE", skus: ["TW7876801I"] }]);
  });
  it("groups two lines on one tracking number into one shipment", () => {
    const p = parseLineDetail("L1 A x3 EA @1 -> SHIPPED\n SHIP FedEx 111 qty 3 on 2026-09-01 from NJ\nL2 B x3 EA @1 -> SHIPPED\n SHIP FedEx 111 qty 3 on 2026-09-01 from NJ\nL3 C x3 EA @1 -> BACKORDERED");
    expect(p.shipments).toHaveLength(1);
    expect(p.shipments[0].qty).toBe("6");
    expect(p.shipments[0].skus).toEqual(["A", "B"]);
    expect(p.lines[2].status).toBe("BACKORDERED");
  });
});

describe("orderView", () => {
  it("a delivered Cardinal order", () => {
    const o = orderView(ROW);
    expect(o.ddp).toBe(false);
    expect(o.shipments[0].delivered).toBe("2026-09-19");
    expect(o.status).toEqual({ label: "Delivered 9/19/2026", tone: "good" });
    expect(o.stage).toBe("delivered");
    expect(o.complete).toBe(true);
    const steps = trackerSteps(o);
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps[1].sub).toBe("Cardinal #1121404441");
  });
  it("a backordered line with one shipment out is partially shipped", () => {
    const o = orderView({ ...ROW, deliveryDate: "", apiStatus: "Partially Shipped", lineItemDetail: "L1 A x3 EA @1 -> SHIPPED\n SHIP FedEx 111 qty 3 on 2026-09-01 from NJ\nL2 B x3 EA @1 -> BACKORDERED" });
    expect(o.backordered).toBe(true);
    expect(o.status.label).toBe("Partially shipped · 1 of 2");
    expect(trackerSteps(o)[3]).toMatchObject({ label: "Partially shipped", partial: true, done: true });
  });
  it("a hold before anything shipped reads as a stop", () => {
    const o = orderView({ ...ROW, apiStatus: "Order has been put on hold, Hold reason: Credit Check Failure, Please contact sales team", shipDate: "", deliveryDate: "", trackingNumbers: [], lineItemDetail: "" });
    expect(o.status).toEqual({ label: "On hold — Credit Check Failure", tone: "red" });
    expect(trackerSteps(o)[2].error).toBe(true);
  });
  it("a DDP order has nothing to track", () => {
    const o = orderView({ ...ROW, cahOrderNumber: "", apiStatus: "", trackingNumbers: [], shipDate: "", deliveryDate: "", lineItemDetail: "" });
    expect(o.ddp).toBe(true);
    expect(o.status.tone).toBe("grey");
    expect(o.shipments).toEqual([]);
  });
  it("falls back to the tracking columns when the detail text is missing", () => {
    const o = orderView({ ...ROW, lineItemDetail: "", deliveryDate: "", apiStatus: "SHIPPED" });
    expect(o.shipments).toEqual([{ carrier: "FedEx", tracking: "541809550825", shippedOn: "2026-09-18", delivered: "", qty: "", from: "", skus: [] }]);
    expect(o.status.label).toBe("In transit");
  });
});
