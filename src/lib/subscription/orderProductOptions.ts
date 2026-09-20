/**
 * orderProductOptions.ts — the New Order Board's product columns and their
 * exact status labels (verified against the board 2026-09-20).
 *
 * These power the product-edit controls (OrderDetailSheet edit + Create Order).
 * Monday rejects a status label it does not have, so these lists must match the
 * board's labels verbatim — a typo here is a failed save.
 */

/** New Order Board column ids for the product type/qty fields. */
export const ORDER_PRODUCT_COL = {
  cgmType:          "color_mm1sjy4y",
  qtyCgmSensors:    "numeric_mm1s49bj",
  qtyCgmMonitor:    "numeric_mm1s431c",
  pumpType:         "color_mm1s45wm",
  qtyPump:          "numeric_mm1smjyx",
  cartridgeType:    "color_mm1szdck",
  qtyCartridge:     "numeric_mm1s9qxd",
  infusionSet1Type: "color_mm1saxyg",
  qtyInfusionSet1:  "numeric_mm1shc1v",
  infusionSet2Type: "color_mm1sp64",
  qtyInfusionSet2:  "numeric_mm1svn8d",
} as const;

export const CGM_TYPES = [
  "Not Serving", "FreeStyle Libre 3 Plus", "Dexcom G7", "Dexcom G7 15-Day",
  "FreeStyle Libre 2 Plus", "Dexcom G6", "FreeStyle Libre 14-Day", "Simplera Sync", "Guardian 4",
] as const;

export const PUMP_TYPES = ["Not Serving", "Mobi", "t:slim", "iLet", "Minimed 780G"] as const;

/** Cartridge Type shares the pump-family labels on the board. */
export const CARTRIDGE_TYPES = PUMP_TYPES;

export const INFUSION_SET_1_TYPES = [
  "Not Serving",
  "AutoSoft XC 6 mm 5\"", "AutoSoft XC 6 mm 23\"", "AutoSoft XC 6 mm 32\"", "AutoSoft XC 6 mm 43\"",
  "AutoSoft XC 9 mm 23\"", "AutoSoft XC 9 mm 43\"",
  "AutoSoft 90 6 mm 23\"", "AutoSoft 90 6 mm 43\"", "AutoSoft 90 9 mm 23\"", "AutoSoft 90 9 mm 43\"",
  "AutoSoft 30 13 mm 23\"", "AutoSoft 30 13 mm 43\"",
  "TruSteel 6 mm 23\"", "TruSteel 6 mm 32\"", "TruSteel 8 mm 23\"", "TruSteel 8 mm 32\"",
  "VariSoft 13 mm 23\"", "VariSoft 13 mm 32\"", "VariSoft 17 mm 23\"",
  "Contact 6 mm 23\"", "Inset 6 mm 23\"", "Mio Advance Clear 9 mm 23\"", "QuickSet 18\"",
] as const;

export const INFUSION_SET_2_TYPES = [
  "Not Serving",
  "AutoSoft XC 6 mm 5\"", "AutoSoft XC 6 mm 23\"", "AutoSoft XC 6 mm 32\"", "AutoSoft XC 6 mm 43\"",
  "AutoSoft XC 9 mm 23\"",
  "AutoSoft 90 6 mm 23\"", "AutoSoft 90 6 mm 43\"", "AutoSoft 90 9 mm 23\"", "AutoSoft 90 9 mm 43\"",
  "AutoSoft 30 13 mm 23\"",
  "TruSteel 6 mm 23\"", "TruSteel 6 mm 32\"", "TruSteel 8 mm 23\"", "TruSteel 8 mm 32\"",
  "VariSoft 13 mm 23\"", "VariSoft 13 mm 32\"", "VariSoft 17 mm 23\"",
  "Contact 6 mm 23\"", "Inset 6 mm 23\"", "QuickSet 18\"",
] as const;
