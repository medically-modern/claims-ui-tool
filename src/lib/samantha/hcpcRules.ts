/**
 * hcpcRules.ts
 * ============
 * Resolves the HCPC code(s) and active products for a patient given:
 *   - Primary Insurance (e.g. "Fidelis Medicaid", "Aetna Commercial")
 *   - Serving           (e.g. "Insulin Pump + CGM", "Supplies Only")
 *
 * Mirrors insurance_rules.py + intake_insurance_resolver.py from the
 * stedi-monday-integration repo so frontend and backend agree on every
 * HCPC. When the source-of-truth tables change there, change them here.
 *
 * Usage:
 *   const resolved = resolveHcpcs("Fidelis Medicaid", "Insulin Pump + CGM");
 *   // [
 *   //   { product: "monitor",      hcpc: "E2103", billsTo: "primary"  },
 *   //   { product: "sensors",      hcpc: "A4239", billsTo: "primary"  },
 *   //   { product: "insulin_pump", hcpc: "E0784", billsTo: "primary"  },
 *   //   { product: "infusion_set", hcpc: "A4230", billsTo: "medicaid" },
 *   //   { product: "cartridge",    hcpc: "A4232", billsTo: "medicaid" },
 *   // ]
 */

// ─────────────────────────────────────────────────────────────────────
// Types — keep aligned with the dropdown options in your form
// ─────────────────────────────────────────────────────────────────────

export type PrimaryInsurance =
  // Fidelis
  | "Fidelis Medicaid"
  | "Fidelis Low-Cost"
  | "Fidelis Commercial"
  | "Fidelis Medicare"
  // Anthem / BCBS
  | "Anthem BCBS Medicare"
  | "Anthem BCBS Commercial"
  | "Anthem BCBS Medicaid (JLJ)"
  | "Anthem BCBS Low-Cost (JLJ)"
  | "Horizon BCBS"
  | "BCBS TN"
  | "BCBS FL"
  | "BCBS WY"
  // United
  | "United Medicare"
  | "United Medicaid"
  | "United Commercial"
  | "United Low-Cost"
  // Aetna
  | "Aetna Medicare"
  | "Aetna Commercial"
  // Government
  | "Medicare A&B"
  | "Medicaid"
  | "NYSHIP"
  // Other
  | "Cigna"
  | "Humana"
  | "Wellcare"
  | "Midlands Choice"
  | "MagnaCare"
  | "UMR"
  | "Oregon Care";

export type Serving =
  | "Supplies Only"
  | "CGM"
  | "Insulin Pump"
  | "Supplies + CGM"
  | "Insulin Pump + CGM";

export type ProductId =
  | "monitor"
  | "sensors"
  | "insulin_pump"
  | "infusion_set"
  | "cartridge";

export interface ResolvedProduct {
  product: ProductId;
  /** The single HCPC dictated by the rules. "Evaluate" if the payer is unknown. */
  hcpc: string;
  /** Whether this product bills to the patient's primary insurance or to Medicaid. */
  billsTo: "primary" | "medicaid";
  /** For supplies, which payer-group letter applied (debug aid). Undefined for fixed-HCPC products. */
  group?: "A" | "B" | "C";
}

// ─────────────────────────────────────────────────────────────────────
// Fixed HCPCs — same for every payer (PRD §11)
// ─────────────────────────────────────────────────────────────────────

const MONITOR_HCPC      = "E2103";
const SENSORS_HCPC      = "A4239";
const INSULIN_PUMP_HCPC = "E0784";

// ─────────────────────────────────────────────────────────────────────
// Variable HCPCs — supplies side, vary by payer group
// ─────────────────────────────────────────────────────────────────────

const SUPPLY_HCPC_GROUPS = {
  A: { infusion_set: "A4230", cartridge: "A4232" },
  B: { infusion_set: "A4224", cartridge: "A4225" },
  C: { infusion_set: "A4231", cartridge: "A4232" },
} as const;

const SUPPLY_HCPC_GROUP_BY_PAYER: Record<PrimaryInsurance, "A" | "B" | "C"> = {
  // Group A
  "Fidelis Medicaid":           "A",
  "Fidelis Low-Cost":           "A",
  "Fidelis Commercial":         "A",
  "Anthem BCBS Commercial":     "A",
  "Anthem BCBS Medicaid (JLJ)": "A",
  "Anthem BCBS Low-Cost (JLJ)": "A",
  "United Medicaid":            "A",
  "United Commercial":          "A",
  "United Low-Cost":            "A",
  "Horizon BCBS":               "A",
  "BCBS TN":                    "A",
  "BCBS FL":                    "A",
  "BCBS WY":                    "A",
  "Medicaid":                   "A",
  "Oregon Care":                "A",
  "MagnaCare":                  "A",
  "UMR":                        "A",
  // Group B
  "Anthem BCBS Medicare":       "B",
  "Fidelis Medicare":           "B",
  "Medicare A&B":               "B",
  "NYSHIP":                     "B",
  "United Medicare":            "B",
  "Wellcare":                   "B",
  "Humana":                     "B",
  "Cigna":                      "B",
  "Midlands Choice":            "B",
  // Group C — Aetna only
  "Aetna Commercial":           "C",
  "Aetna Medicare":             "C",
};

// ─────────────────────────────────────────────────────────────────────
// Supplies → Medicaid routing override (PRD §9.2)
// The supplies side (infusion sets + cartridges) bills to Medicaid when:
//   - Primary insurance is "Medicaid" (always — patient already has
//     straight Medicaid as primary; the supplies just stay there).
//   - Primary insurance is "Fidelis Medicaid" or
//     "Anthem BCBS Medicaid (JLJ)" AND the patient also carries
//     "NY Medicaid" as secondary insurance. (For these managed-Medicaid
//     primaries, supplies route to NY Medicaid only if the patient is
//     dually enrolled.)
// In every other case the supplies bill to the patient's primary.
// ─────────────────────────────────────────────────────────────────────

const SUPPLIES_NEED_NY_MEDICAID_SECONDARY = new Set<PrimaryInsurance>([
  "Fidelis Medicaid",
  "Anthem BCBS Medicaid (JLJ)",
]);

function suppliesRouteToMedicaid(
  primary: PrimaryInsurance,
  secondary: string | null | undefined,
): boolean {
  if (primary === "Medicaid") return true;
  if (SUPPLIES_NEED_NY_MEDICAID_SECONDARY.has(primary)) {
    return (secondary ?? "").trim().toLowerCase() === "ny medicaid";
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Serving → active products (PRD §10)
// ─────────────────────────────────────────────────────────────────────

const SERVING_PRODUCTS: Record<Serving, ProductId[]> = {
  "Supplies Only":      ["infusion_set", "cartridge"],
  "CGM":                ["monitor", "sensors"],
  "Insulin Pump":       ["insulin_pump", "infusion_set", "cartridge"],
  "Supplies + CGM":     ["monitor", "sensors", "infusion_set", "cartridge"],
  "Insulin Pump + CGM": ["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"],
};

// ─────────────────────────────────────────────────────────────────────
// Main resolver
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the active products and their HCPC codes for a patient.
 * Returns [] if either required input is empty/unknown. Secondary
 * insurance is optional — it only affects the supplies → Medicaid
 * routing for Fidelis Medicaid / Anthem BCBS Medicaid (JLJ) primaries
 * (those route to Medicaid only when secondary is "NY Medicaid").
 */
export function resolveHcpcs(
  primaryInsurance: PrimaryInsurance | "" | null | undefined,
  serving: Serving | "" | null | undefined,
  secondaryInsurance?: string | null,
): ResolvedProduct[] {
  if (!primaryInsurance || !serving) return [];

  const products = SERVING_PRODUCTS[serving as Serving];
  if (!products) return [];

  const suppliesToMedicaid = suppliesRouteToMedicaid(
    primaryInsurance as PrimaryInsurance,
    secondaryInsurance,
  );
  const suppliesPayer: PrimaryInsurance = suppliesToMedicaid
    ? "Medicaid"
    : (primaryInsurance as PrimaryInsurance);
  const suppliesGroup = SUPPLY_HCPC_GROUP_BY_PAYER[suppliesPayer];

  return products.map((product): ResolvedProduct => {
    switch (product) {
      case "monitor":
        return { product, hcpc: MONITOR_HCPC, billsTo: "primary" };
      case "sensors":
        return { product, hcpc: SENSORS_HCPC, billsTo: "primary" };
      case "insulin_pump":
        return { product, hcpc: INSULIN_PUMP_HCPC, billsTo: "primary" };
      case "infusion_set":
        if (!suppliesGroup) {
          return { product, hcpc: "Evaluate", billsTo: suppliesToMedicaid ? "medicaid" : "primary" };
        }
        return {
          product,
          hcpc: SUPPLY_HCPC_GROUPS[suppliesGroup].infusion_set,
          billsTo: suppliesToMedicaid ? "medicaid" : "primary",
          group: suppliesGroup,
        };
      case "cartridge":
        if (!suppliesGroup) {
          return { product, hcpc: "Evaluate", billsTo: suppliesToMedicaid ? "medicaid" : "primary" };
        }
        return {
          product,
          hcpc: SUPPLY_HCPC_GROUPS[suppliesGroup].cartridge,
          billsTo: suppliesToMedicaid ? "medicaid" : "primary",
          group: suppliesGroup,
        };
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — useful for populating dropdowns
// ─────────────────────────────────────────────────────────────────────

export const PRIMARY_INSURANCE_OPTIONS: PrimaryInsurance[] = [
  "Fidelis Medicaid", "Fidelis Low-Cost", "Fidelis Commercial", "Fidelis Medicare",
  "Anthem BCBS Medicare", "Anthem BCBS Commercial",
  "Anthem BCBS Medicaid (JLJ)", "Anthem BCBS Low-Cost (JLJ)",
  "Horizon BCBS", "BCBS TN", "BCBS FL", "BCBS WY",
  "United Medicare", "United Medicaid", "United Commercial", "United Low-Cost",
  "Aetna Medicare", "Aetna Commercial",
  "Medicare A&B", "Medicaid", "NYSHIP",
  "Cigna", "Humana", "Wellcare", "Midlands Choice", "MagnaCare", "UMR", "Oregon Care",
];

/** Monday status-column index for each Primary Insurance label. */
export const PRIMARY_INSURANCE_INDEX: Record<PrimaryInsurance, number> = {
  "BCBS TN": 0,
  "BCBS FL": 1,
  "BCBS WY": 2,
  "MagnaCare": 3,
  "Oregon Care": 4,
  "UMR": 6,
  "United Healthcare Commercial": 7,
  "Medicare A&B": 8,
  "NYSHIP": 9,
  "United Commercial": 10,
  "United Medicare": 11,
  "United Medicaid": 12,
  "Aetna Commercial": 13,
  "Aetna Medicare": 14,
  "Wellcare": 15,
  "Humana": 16,
  "Cigna": 17,
  "Medicaid": 18,
  "Midlands Choice": 19,
  "Horizon BCBS": 101,
  "Fidelis Low-Cost": 102,
  "Fidelis Medicaid": 103,
  "Anthem BCBS Medicaid (JLJ)": 104,
  "Anthem BCBS Commercial": 105,
  "Anthem BCBS Medicare": 106,
  "Fidelis Commercial": 107,
  "Fidelis Medicare": 108,
  "Anthem BCBS Low-Cost (JLJ)": 109,
  "Fidelis CHP": 110,
  "United Low-Cost": 10,  // maps to United Commercial on the board
} as Record<PrimaryInsurance, number>;

export const SECONDARY_INSURANCE_OPTIONS_SAMANTHA = ["None", "NY Medicaid", "Medicare Supplement"];

export const SECONDARY_INSURANCE_INDEX: Record<string, number> = {
  "None": 0,
  "NY Medicaid": 1,
  "Medicare Supplement": 2,
};

export const SERVING_OPTIONS: Serving[] = [
  "Supplies Only",
  "CGM",
  "Insulin Pump",
  "Supplies + CGM",
  "Insulin Pump + CGM",
];

export const PRODUCT_LABELS: Record<ProductId, string> = {
  monitor:      "CGM Monitor",
  sensors:      "CGM Sensors",
  insulin_pump: "Insulin Pump",
  infusion_set: "Infusion Sets",
  cartridge:    "Cartridges",
};

/**
 * True when a resolved product is an Infusion Set / Cartridge that bills
 * to Medicaid. These products are hidden from Samantha's UI on every
 * tab — Benefits auto-fills them (Auth=Required, SoS=Clear) and
 * Submit Auth / Auth Outstanding skip them entirely (Medicaid handles
 * the auth flow on its own; the user has nothing to submit).
 *
 * Driven by SUPPLIES_ROUTE_TO_MEDICAID in this file:
 * Fidelis Medicaid, Anthem BCBS Medicaid (JLJ), Medicaid.
 */
export function isAutoFilledMedicaidSupply(r: ResolvedProduct): boolean {
  return (
    (r.product === "infusion_set" || r.product === "cartridge") &&
    r.billsTo === "medicaid"
  );
}
