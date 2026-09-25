/**
 * cardinalSku.ts — Cardinal SKU → friendly product name + category.
 *
 * Sourced from the "Cardinal SKU Tracker" board (18420366344, text_mm4wgzdw =
 * SKU, item name = friendly name). The New Order Board's Line Item Detail
 * identifies each line by these SKUs, so this map lets the Overview label each
 * shipment / backorder with the real product and tie tracking to it (Brandon,
 * 2026-09-20). Static on purpose — the catalog is ~45 stable SKUs; refresh from
 * the tracker board if Cardinal adds one.
 */
export type SkuCategory = "Infusion set" | "Pump" | "Cartridge" | "Sensor" | "Reader";
export interface SkuInfo { name: string; cat: SkuCategory }

export const CARDINAL_SKUS: Record<string, SkuInfo> = {
  // Infusion sets
  TN1002817I: { name: "AutoSoft 90 6 mm 23\"", cat: "Infusion set" },
  TN1002818I: { name: "AutoSoft 90 6 mm 43\"", cat: "Infusion set" },
  TN1002819I: { name: "AutoSoft 90 9 mm 23\"", cat: "Infusion set" },
  TN1002820I: { name: "AutoSoft 90 9 mm 43\"", cat: "Infusion set" },
  TN1006922I: { name: "AutoSoft XC 6 mm 5\"", cat: "Infusion set" },
  TN1001680I: { name: "AutoSoft XC 6 mm 23\"", cat: "Infusion set" },
  TN1003912I: { name: "AutoSoft XC 6 mm 32\"", cat: "Infusion set" },
  TN1001728I: { name: "AutoSoft XC 6 mm 43\"", cat: "Infusion set" },
  TN1001681I: { name: "AutoSoft XC 9 mm 23\"", cat: "Infusion set" },
  TN1001729I: { name: "AutoSoft XC 9 mm 43\"", cat: "Infusion set" },
  TN1002825I: { name: "AutoSoft 30 13 mm 23\"", cat: "Infusion set" },
  TN1002826I: { name: "AutoSoft 30 13 mm 43\"", cat: "Infusion set" },
  TN1002833I: { name: "TruSteel 6 mm 23\"", cat: "Infusion set" },
  TN1002834I: { name: "TruSteel 6 mm 32\"", cat: "Infusion set" },
  TN1002835I: { name: "TruSteel 8 mm 23\"", cat: "Infusion set" },
  TN1002836I: { name: "TruSteel 8 mm 32\"", cat: "Infusion set" },
  TN1002827I: { name: "VariSoft 13 mm 23\"", cat: "Infusion set" },
  TN1002828I: { name: "VariSoft 13 mm 32\"", cat: "Infusion set" },
  TN1002830I: { name: "VariSoft 17 mm 23\"", cat: "Infusion set" },
  BBIBB4120IM: { name: "Contact 6 mm 23\"", cat: "Infusion set" },
  BBIBB4100IM: { name: "Inset 6 mm 23\"", cat: "Infusion set" },
  MNMMT243AI: { name: "Mio Advance Clear 9 mm 23\"", cat: "Infusion set" },
  BBIBB4110IM: { name: "Inset 6 mm 32\"", cat: "Infusion set" },
  MNMMT394AI: { name: "QuickSet 18\"", cat: "Infusion set" },
  // Insulin pumps
  TN1018388I: { name: "Mobi", cat: "Pump" }, // Cardinal's new Mobi SKU going forward (Brandon, 2026-09-25)
  TN1017899I: { name: "Mobi", cat: "Pump" }, // prior Mobi SKU — kept for historical orders on the board
  BBIBB1003G: { name: "iLet", cat: "Pump" },
  TN1019458I: { name: "t:slim", cat: "Pump" },
  MNMMT1894I: { name: "Minimed 780G", cat: "Pump" },
  // Cartridges
  TN1016647I: { name: "Mobi", cat: "Cartridge" },
  BBIBB2010IM: { name: "iLet", cat: "Cartridge" },
  TN1013310I: { name: "t:slim", cat: "Cartridge" },
  MNMMT332AI: { name: "Minimed 780G", cat: "Cartridge" },
  // CGM sensors
  TW7876801I: { name: "FreeStyle Libre 3 Plus", cat: "Sensor" },
  EDSTPAT013MEDIMA: { name: "Dexcom G7", cat: "Sensor" },
  EDSTPFT013G: { name: "Dexcom G7 15-Day", cat: "Sensor" },
  TW7874701I: { name: "FreeStyle Libre 2 Plus", cat: "Sensor" },
  EDSTSOM003MEDIM: { name: "Dexcom G6", cat: "Sensor" },
  TW7194001I: { name: "FreeStyle Libre 14-Day", cat: "Sensor" },
  MNMMT5120AI: { name: "Simplera Sync", cat: "Sensor" },
  MNMMT7040AI: { name: "Guardian 4", cat: "Sensor" },
  // CGM receivers / readers
  EDSTKAT013MEDIM: { name: "Dexcom G7 Receiver", cat: "Reader" },
  EDSTKFM001MEDIM: { name: "Dexcom G6 Receiver", cat: "Reader" },
  TW7207901I: { name: "FreeStyle Libre 3 Reader", cat: "Reader" },
  TW7195301I: { name: "FreeStyle Libre 2 Reader", cat: "Reader" },
  TW7193801I: { name: "FreeStyle Libre 14-Day Reader", cat: "Reader" },
};

/** Friendly product name for a Cardinal SKU (falls back to the SKU itself). */
export function skuName(sku: string): string {
  return CARDINAL_SKUS[sku]?.name ?? sku;
}
export function skuInfo(sku: string): SkuInfo | undefined {
  return CARDINAL_SKUS[sku];
}
