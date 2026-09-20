/**
 * Render smoke for the Orders view against a real New Order Board row (as the
 * API returned it on 2026-09-20): the upcoming-order strip, the latest order's
 * band, shipment, tracker and history table, and the click-to-select row.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import type { NewOrderRow } from "@/api/queries/newOrders";
import { ordersForPatient } from "@/lib/subscription/orderHistory";
import { OrdersView } from "./OrdersView";

const patient = {
  id: "1", mondayItemId: "111", name: "Clairetta Lowe", dob: "1937-05-10", phone: "(646) 555-1234",
  primaryPayer: "Medicare A&B", nextOrderDate: "2026-12-17", subscriptionType: "Sensors", orderFrequency: "90-Days",
  sensorsType: "FreeStyle Libre 3 Plus", cgmQty: "6", infusionSet1: "", infusionSet2: "", cartridgeQty: "",
  patientOrderResponse: "", reorderTextSent: "", reorderLink: "", patientResponseAt: "", address: "1 Main St",
  confirmation: { tone: "pending", label: "Not sent" }, benefits: { tone: "ok", label: "Active" },
  auth: { tone: "ok", label: "No Auth Needed" }, lastPaid: { tone: "ok", label: "Fully Paid" },
} as unknown as LiveSubscriptionPatient;

const row: NewOrderRow = {
  id: "13076160232", name: "Clairetta Lowe", orderDate: "2026-09-18", orderStatus: "Process Claim",
  pumpType: "", cartridgeType: "Not Serving", infusionSet1Type: "", infusionSet2Type: "", cgmType: "FreeStyle Libre 3 Plus",
  qtyPump: "", qtyInfusionSet1: "0", qtyInfusionSet2: "", qtyCartridge: "0", qtyCgmSensors: "6", qtyCgmMonitor: "",
  primaryInsurance: "Medicare A&B", memberId: "1EG4", subscriptionType: "Sensors",
  orderType: "First Order", orderFrequency: "90-Days", dob: "05/10/1937", patientAddress: "",
  ddpOrder: "", apiStatus: "Delivered", apiMessage: "", holdReason: "",
  backordered: "", backorderedQty: "", substituteSet: "", substitutionStatus: "", substitutionCah: "",
  cahOrderNumber: "1121404441", poNumber: "MM-13076160232-20260918", carrier: "FedEx",
  estShipDate: "", shipDate: "2026-09-18", deliveryDate: "2026-09-19", signedBy: "",
  trackingNumbers: ["541809550825"], confirmedAddress: "", lastCardinalSync: "9/19/2026, 20:02:52 ET",
  preCheck: "", preCheckDetail: "", pos: "", shipMethod: "", groupId: "group_mm18v6n3", monitorAuthId: "", sensorsAuthId: "", pumpAuthId: "", infusionSetAuthId: "", cartridgesAuthId: "",
  lineItemDetail: "ORDER STATUS 9/19/2026, 20:02:06 ET\nL1 TW7876801I x6 EA @79.32 -> SHIPPED\n   SHIP FedEx 541809550825 qty 6 on 2026-09-18 from TEXAS 4 WAREHOUSE\nL2 00MMWELCOME xnull EA @0 -> SHIPPED",
};
const older: NewOrderRow = { ...row, id: "1", orderDate: "2026-06-18", cahOrderNumber: "", apiStatus: "", trackingNumbers: [], shipDate: "", deliveryDate: "", lineItemDetail: "", orderType: "Reorder" };

describe("OrdersView (render smoke)", () => {
  it("shows the upcoming order, the latest order card, and the history", () => {
    const orders = ordersForPatient([older, row], patient);
    render(<OrdersView p={patient} orders={orders} loading={false} onRefresh={() => {}} />);
    expect(screen.getByText("Upcoming order")).toBeInTheDocument();
    expect(screen.getAllByText("6 × FreeStyle Libre 3 Plus sensors").length).toBeGreaterThan(0);
    expect(screen.getByText("Latest order")).toBeInTheDocument();
    expect(screen.getByText("#1121404441")).toBeInTheDocument();
    expect(screen.getByText("MM-13076160232-20260918")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "541809550825" })).toHaveAttribute("href", expect.stringContaining("fedex"));
    expect(screen.getAllByText(/Delivered 9\/19\/2026/).length).toBeGreaterThan(0);
    expect(screen.getByText("Order history")).toBeInTheDocument();
    expect(screen.getByText("DDP")).toBeInTheDocument();
    // Click the older (DDP) row → it loads above with a way back.
    fireEvent.click(screen.getByText("DDP").closest("tr")!);
    expect(screen.getAllByText(/Ordered via DDP — no history available/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Back to latest"));
    expect(screen.getByText("Latest order")).toBeInTheDocument();
  });
});
