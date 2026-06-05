// IP Coverage Path config — declarative table of which fields each path needs.

// IMPORTANT: these labels must match Monday's "Insulin Pump Coverage Path"
// (color_mm1w5xn1) status options exactly. Mismatched labels would either be
// silently auto-created as duplicates or fail to round-trip through Reset.
export const IP_PATHS = [
  "Supplies Only",
  "1st Pump >6M Diagnosed",
  "1st Pump <6M Diagnosed",
  "OOW Pump",
  "Omnipod Switch",
  "IW New Insurance",
] as const;

export type IpPath = (typeof IP_PATHS)[number];

export interface IpPathConfig {
  showEducation: boolean;
  show3Injections: boolean;
  showCgmUse: boolean;
  showBsIssues: boolean;
  showLmn: boolean;
  showOow: boolean;
  /** "OOW Date on Script?" Yes/No dropdown — only relevant when showOow. */
  showOowOnScript: boolean;
  showMalfunction: boolean;
}

export const IP_PATH_FIELDS: Record<IpPath, IpPathConfig> = {
  "Supplies Only": {
    showEducation: false,
    show3Injections: false,
    showCgmUse: false,
    showBsIssues: false,
    showLmn: false,
    showOow: false,
    showOowOnScript: false,
    showMalfunction: false,
  },
  "1st Pump >6M Diagnosed": {
    showEducation: true,
    show3Injections: true,
    showCgmUse: true,
    showBsIssues: true,
    showLmn: false,
    showOow: false,
    showOowOnScript: false,
    showMalfunction: false,
  },
  "1st Pump <6M Diagnosed": {
    showEducation: true,
    show3Injections: true,
    showCgmUse: true,
    showBsIssues: true,
    showLmn: true,
    showOow: false,
    showOowOnScript: false,
    showMalfunction: false,
  },
  "OOW Pump": {
    showEducation: false,
    show3Injections: false,
    showCgmUse: false,
    showBsIssues: false,
    showLmn: false,
    showOow: true,
    showOowOnScript: true,
    showMalfunction: true,
  },
  "Omnipod Switch": {
    showEducation: true,
    show3Injections: true,
    showCgmUse: true,
    showBsIssues: true,
    showLmn: false,
    showOow: false,
    showOowOnScript: false,
    showMalfunction: true,
  },
  "IW New Insurance": {
    showEducation: true,
    show3Injections: true,
    showCgmUse: true,
    showBsIssues: true,
    showLmn: false,
    showOow: false,
    showOowOnScript: false,
    showMalfunction: false,
  },
};

/** Whether the page should show the IP block at all, based on Serving. */
export function shouldShowIpBlock(serving: string | undefined): boolean {
  if (!serving) return true; // unknown → show, let user decide
  // Show IP block for everything except CGM-only
  return serving !== "CGM";
}

/** Whether the CGM block should show, based on Serving. */
export function shouldShowCgmBlock(serving: string | undefined): boolean {
  if (!serving) return true;
  return (
    serving === "CGM" ||
    serving === "Insulin Pump + CGM" ||
    serving === "Supplies + CGM"
  );
}

/** When Serving forces a specific IP path (Supplies Only / Supplies + CGM). */
export function defaultIpPath(serving: string | undefined): IpPath | undefined {
  if (serving === "Supplies Only" || serving === "Supplies + CGM") {
    return "Supplies Only";
  }
  return undefined;
}
