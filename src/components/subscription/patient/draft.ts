/**
 * draft.ts — the editable subset of the profile and how it saves.
 *
 * Small on purpose: what an operator changes at reorder time (Brandon,
 * 2026-09-20 — insurance, the eligibility check, order details). Everything
 * else on the page reads from the board. `visitDate` is page-only: it sets
 * mnExpiry to visit + 6 months and is not itself a column.
 */
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";

export interface ProfileDraft {
  phone: string;
  address: string;
  canText: string;
  primaryInsurance: string;
  memberId1: string;
  secondaryInsurance: string;
  memberId2: string;
  nextOrderDate: string;
  subscriptionType: string;
  orderFrequency: string;
  sensorsType: string;
  cgmQty: string;
  suppliesType: string;
  cartridgeQty: string;
  infusionSet1: string;
  infusionSet1Qty: string;
  infusionSet2: string;
  infusionSet2Qty: string;
  mnExpiry: string;
  visitDate: string;
}

/** Fields that write to Monday, in saveSubscriptionPatient's FIELD_MAP names. */
export const SAVED_FIELDS: ReadonlyArray<Exclude<keyof ProfileDraft, "visitDate">> = [
  "phone", "address", "canText", "primaryInsurance", "memberId1", "secondaryInsurance", "memberId2",
  "nextOrderDate", "subscriptionType", "orderFrequency", "sensorsType", "cgmQty", "suppliesType", "cartridgeQty",
  "infusionSet1", "infusionSet1Qty", "infusionSet2", "infusionSet2Qty", "mnExpiry",
];

export function draftFrom(p: LiveSubscriptionPatient): ProfileDraft {
  return {
    phone: p.phone ?? "",
    address: p.address ?? "",
    canText: p.canText ?? "",
    primaryInsurance: p.primaryPayer === "—" ? "" : (p.primaryPayer ?? ""),
    memberId1: p.memberId1 ?? "",
    secondaryInsurance: p.secondaryInsurance ?? "",
    memberId2: p.memberId2 ?? "",
    nextOrderDate: (p.nextOrderDate ?? "").slice(0, 10),
    subscriptionType: p.subscriptionType ?? "",
    orderFrequency: p.orderFrequency ?? "",
    sensorsType: p.sensorsType ?? "",
    cgmQty: p.cgmQty ?? "",
    suppliesType: p.suppliesType ?? "",
    cartridgeQty: p.cartridgeQty ?? "",
    infusionSet1: p.infusionSet1 ?? "",
    infusionSet1Qty: p.infusionSet1Qty ?? "",
    infusionSet2: p.infusionSet2 ?? "",
    infusionSet2Qty: p.infusionSet2Qty ?? "",
    mnExpiry: (p.mnExpiry ?? "").slice(0, 10),
    visitDate: "",
  };
}

/** The Monday patch: only what changed against the board. */
export function draftPatch(base: ProfileDraft, draft: ProfileDraft): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const k of SAVED_FIELDS) {
    if ((draft[k] ?? "") !== (base[k] ?? "")) patch[k] = draft[k] ?? "";
  }
  return patch;
}

export function isDirty(base: ProfileDraft, draft: ProfileDraft): boolean {
  return Object.keys(draftPatch(base, draft)).length > 0;
}
