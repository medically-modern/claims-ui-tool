// "Hit Bank?" gate — decides which Monday group a row lands in once it
// is marked Paid (Brandon, 2026-09-29).
//
//   $0 paid / Bank Payment Method NON  -> Paid And Closed
//   CHK from a payer not yet EFT'd      -> Paid but need to EFT / Paid but not EFTd
//   Hit Bank? = Yes                     -> Paid And Closed
//   otherwise                           -> Paid, but NOT in Bank
//
// The rule lives on the backend (services/hit_bank_service.py) and reads
// Hit Bank? live from Monday, so the UI never closes a row off stale
// cache. If the backend isn't configured / reachable we fall back to the
// safe default — park the row in "Paid, but NOT in Bank" — and the
// backend's hit-bank webhook / sweep closes it when the deposit lands.

import { mondayQuery } from "./monday";
import { HIT_BANK_GATE_ENABLED } from "@/lib/claims/hitBankGate";

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export type PaidBoard = "primary" | "secondary";

export const PAID_AND_CLOSED_GROUP = "group_mkxsng4r";
export const NOT_IN_BANK_GROUP: Record<PaidBoard, string> = {
  primary:   "group_mm7nqyqb",
  secondary: "group_mm7n6bmv",
};
export const HIT_BANK_COL: Record<PaidBoard, string> = {
  primary:   "color_mm7n1jjp",
  secondary: "color_mm7njxgm",
};

export const GROUP_LABELS: Record<string, string> = {
  group_mkxsng4r: "Paid And Closed",
  group_mm7nqyqb: "Paid, but NOT in Bank",
  group_mm7n6bmv: "Paid, but NOT in Bank",
  group_mm3qyj6z: "Paid but not EFTd",
  group_mm3qkck6: "Paid but need to EFT",
};

export interface RoutePaidResult {
  item_id: string;
  moved: boolean;
  group_id?: string;
  reason?: string;
}

const MOVE_GROUP_MUT = `
  mutation MoveGroup($itemId: ID!, $groupId: String!) {
    move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
  }
`;

export async function routePaidGroup(
  mondayItemId: string,
  board: PaidBoard,
): Promise<RoutePaidResult> {
  if (API_BASE && ADMIN_KEY) {
    try {
      const res = await fetch(`${API_BASE}/claims/route-paid-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
        body: JSON.stringify({ item_id: mondayItemId, board }),
      });
      if (res.ok) return (await res.json()) as RoutePaidResult;
      console.warn(`[routePaidGroup] backend HTTP ${res.status}; falling back`);
    } catch (e) {
      console.warn("[routePaidGroup] backend unreachable; falling back:", e);
    }
  }
  // Fallback: with the gate off, close the row as before; with it on,
  // park it until the deposit is confirmed.
  const groupId = HIT_BANK_GATE_ENABLED ? NOT_IN_BANK_GROUP[board] : PAID_AND_CLOSED_GROUP;
  await mondayQuery(MOVE_GROUP_MUT, { itemId: mondayItemId, groupId });
  return { item_id: mondayItemId, moved: true, group_id: groupId, reason: "fallback" };
}

export function describePaidGroup(groupId: string | undefined): string {
  return (groupId && GROUP_LABELS[groupId]) || "its paid group";
}
