import { describe, expect, it } from "vitest";
import { isMonitorOnly, monitorMergeTarget, orderCategories, orderStatusTone, posLabel, preCheckTone } from "./orderBoard";
import type { NewOrderRow } from "@/api/queries/newOrders";

const row = (o: Partial<NewOrderRow>): NewOrderRow => ({
  id: "1", name: "A", orderDate: "2026-09-19", orderStatus: "Order", preCheck: "", preCheckDetail: "", pos: "",
  shipMethod: "", groupId: "group_mm18v6n3", monitorAuthId: "", sensorsAuthId: "", pumpAuthId: "", infusionSetAuthId: "", cartridgesAuthId: "",
  pumpType: "", cartridgeType: "", infusionSet1Type: "", infusionSet2Type: "", cgmType: "",
  qtyPump: "", qtyInfusionSet1: "", qtyInfusionSet2: "", qtyCartridge: "", qtyCgmSensors: "", qtyCgmMonitor: "",
  primaryInsurance: "", memberId: "", subscriptionType: "", orderType: "", orderFrequency: "", dob: "", patientAddress: "",
  ddpOrder: "", apiStatus: "", apiMessage: "", holdReason: "", backordered: "", backorderedQty: "", substituteSet: "",
  substitutionStatus: "", substitutionCah: "", cahOrderNumber: "", poNumber: "", carrier: "", estShipDate: "", shipDate: "",
  deliveryDate: "", signedBy: "", trackingNumbers: [], confirmedAddress: "", lastCardinalSync: "", lineItemDetail: "", ...o,
});

describe("orderCategories", () => {
  it("sensors-only order: one line, monitor rides with sensors", () => {
    const cats = orderCategories(row({ subscriptionType: "Sensors", cgmType: "FreeStyle Libre 3 Plus", qtyCgmMonitor: "1", sensorsAuthId: "S1", monitorAuthId: "M1" }));
    expect(cats.map((c) => c.category)).toEqual(["Sensors"]);
    expect(cats[0].items.map((i) => `${i.name} ${i.qty}`.trim())).toEqual(["FreeStyle Libre 3 Plus"]);
    expect(cats[0].device).toEqual({ label: "Monitor", on: true });
    expect(cats[0].auths).toEqual([{ label: "Sensors", id: "S1" }, { label: "Monitor", id: "M1" }]);
  });
  it("supplies-only order: one line, pump/cartridge/infusion", () => {
    const cats = orderCategories(row({ subscriptionType: "Supplies", pumpType: "Mobi", qtyPump: "1", cartridgeType: "Mobi Cartridge", qtyCartridge: "3", infusionSet1Type: "AutoSoft 90", qtyInfusionSet1: "3", pumpAuthId: "P1", cartridgesAuthId: "C1", infusionSetAuthId: "I1" }));
    expect(cats.map((c) => c.category)).toEqual(["Supplies"]);
    expect(cats[0].items.map((i) => `${i.name} ${i.qty}`.trim())).toEqual(["Mobi Cartridge ×3", "AutoSoft 90 ×3"]);
    expect(cats[0].device).toEqual({ label: "Pump", on: true });
    expect(cats[0].auths.map((a) => a.label)).toEqual(["Pump", "Cartridges", "Infusion set"]);
  });
  it("both: two lines", () => {
    const cats = orderCategories(row({ subscriptionType: "Sensors & Supplies", cgmType: "Dexcom G7", qtyCgmSensors: "3", cartridgeType: "Cartridge", qtyCartridge: "3" }));
    expect(cats.map((c) => c.category)).toEqual(["Sensors", "Supplies"]);
  });
  it("None types and blank qty produce no phantom items", () => {
    const cats = orderCategories(row({ subscriptionType: "Sensors", cgmType: "FreeStyle Libre 3 Plus", qtyCgmMonitor: "1", pumpType: "None", cartridgeType: "None" }));
    expect(cats.map((c) => c.category)).toEqual(["Sensors"]);
  });
});

describe("pill tones + POS", () => {
  it("statuses", () => {
    expect(orderStatusTone("Order")).toBe("green");
    expect(orderStatusTone("Ordered")).toBe("green");
    expect(orderStatusTone("Stuck")).toBe("red");
    expect(orderStatusTone("On Hold")).toBe("amber");
  });
  it("pre-check", () => {
    expect(preCheckTone("Good to Go")).toBe("green");
    expect(preCheckTone("Good to Go (fixed)")).toBe("green");
    expect(preCheckTone("Mismatch")).toBe("amber");
    expect(preCheckTone("Address Flag")).toBe("red");
    expect(preCheckTone("")).toBe("slate");
  });
  it("POS only for office", () => {
    expect(posLabel("Office")).toBe("Office");
    expect(posLabel("Home")).toBeNull();
    expect(posLabel("")).toBeNull();
  });
});

describe("monitor-only orders", () => {
  it("blank subscription with only a monitor → Monitor category, monitorOnly", () => {
    const cats = orderCategories(row({ subscriptionType: "", qtyCgmMonitor: "1", monitorAuthId: "M9" }));
    expect(cats.map((c) => c.category)).toEqual(["Monitor"]);
    expect(cats[0].monitorOnly).toBe(true);
    expect(isMonitorOnly(row({ subscriptionType: "", qtyCgmMonitor: "1" }))).toBe(true);
  });
  it("blank subscription with only a pump → Pump category", () => {
    const cats = orderCategories(row({ subscriptionType: "", pumpType: "Mobi", qtyPump: "1" }));
    expect(cats.map((c) => c.category)).toEqual(["Pump"]);
  });
  it("finds the sensors order to merge into (same patient + dob, sensors line)", () => {
    const mon = row({ id: "m", name: "Jane Doe", dob: "1990-01-01", subscriptionType: "", qtyCgmMonitor: "1", monitorAuthId: "M9" });
    const sensors = row({ id: "s", name: "Jane Doe", dob: "1990-01-01", subscriptionType: "Sensors", cgmType: "Dexcom G7", qtyCgmSensors: "3" });
    const other = row({ id: "o", name: "John Roe", dob: "1980-01-01", subscriptionType: "Sensors", cgmType: "Dexcom G7", qtyCgmSensors: "3" });
    expect(monitorMergeTarget(mon, [mon, sensors, other])?.id).toBe("s");
    expect(monitorMergeTarget(mon, [mon, other])).toBeNull();
  });
});
