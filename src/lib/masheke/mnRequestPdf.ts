// Dynamic Medical Necessity Request PDF generator.
// Matches the Word-document styling exactly (Roboto fonts, Medically Modern
// logo, teal title, light-gray table header, etc.). One block per situation
// with requirement rows that fill in ✓ / ✗ from the patient's current Monday
// MN Invalid Reasons.

import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Patient } from "./workflow";

// ---- Brand palette (from the Word docs) -------------------------------
const TEAL = rgb(0x80 / 255, 0xad / 255, 0xaa / 255); // #80ADAA
const RED = rgb(0xcc / 255, 0x00 / 255, 0x00 / 255); // #CC0000
const GREEN = rgb(0x38 / 255, 0x76 / 255, 0x1d / 255); // #38761D
const TEXT = rgb(0x40 / 255, 0x40 / 255, 0x40 / 255);
const GRAY = rgb(0x66 / 255, 0x66 / 255, 0x66 / 255); // #666666
const LIGHT = rgb(0xf3 / 255, 0xf3 / 255, 0xf3 / 255); // #F3F3F3
const BORDER = rgb(0.78, 0.78, 0.78);
const LINK_TEAL = rgb(0x11 / 255, 0x55 / 255, 0x55 / 255); // #115555 — teal link color for Fax/Email labels

// ---- Asset URLs -------------------------------------------------------
const BASE = import.meta.env.BASE_URL;
const ROBOTO_REGULAR_URL = `${BASE}fonts/Roboto-Regular.ttf`;
const ROBOTO_BOLD_URL = `${BASE}fonts/Roboto-Bold.ttf`;
const ROBOTO_ITALIC_URL = `${BASE}fonts/Roboto-Italic.ttf`;
const LOGO_URL = `${BASE}templates/medically-modern-logo.png`;

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(
      `Network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) {
    throw new Error(`Asset ${url} returned ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

// =====================================================================
// Template definitions (text is identical to the Word docs)
// =====================================================================

interface ReqRow {
  /** Requirement text (column 2). */
  name: string;
  /** Examples text (column 3) — supports an array for multi-line. */
  examples?: string | string[];
  /** Reason strings — if any of these are in the patient's reasons, mark ✗. */
  reasonKeys: string[];
  /** If true, always render ✗ regardless of reasons (i.e. always asking). */
  alwaysMissing?: boolean;
}

interface TemplateBlock {
  situation: string;
  rows: ReqRow[];
}

// --- Reason key constants ----------------------------------------------
const CGM_SCRIPT_REASONS = ["CGM Script invalid", "CGM Script missing", "CGM Script"];
const IP_SCRIPT_REASONS = ["Insulin Pump Script invalid", "Insulin Pump Script missing", "Insulin Pump Script", "Updated Insulin Pump Script", "Insulin Pump Script (must include OOW date and malfunction note)"];
const EDU_REASONS = ["Diabetes Education invalid", "Diabetes education completed"];
const INJ_REASONS = ["3+ Injections invalid", "3+ insulin injections / day for > 6 months"];
const CGM_USE_REASONS = ["CGM Use invalid", "Current CGM use"];
const BS_REASONS = ["Blood Sugar Issues invalid", "Difficulty managing blood sugar despite treatment"];
const LMN_REASONS = ["Letter of MN missing", "Letter of MN invalid", "Letter of Medical Necessity", "Updated Letter of Medical Necessity"];
const MAL_REASONS = ["Malfunction missing", "Non-repairable malfunction reason", "Omnipod insufficient", "malfunction note"];
const OOW_NOT_ON_SCRIPT_REASONS = ["OOW Date not on script"];
const HYPO_LANG_REASONS = ["Hypoglycemia language"];

// --- Example text for standalone / Additional Outstanding Items rows -----
const REASON_EXAMPLES: Record<string, string> = {
  // --- Legacy granular keys (pre-rewrite, kept for backward compat) ---
  "CGM Script missing": "Signed CGM script",
  "CGM Script invalid": "Signed CGM script",
  "Insulin Pump Script missing": "Signed insulin pump script",
  "Insulin Pump Script invalid": "Signed insulin pump script",
  "Diabetes Education invalid": "\u201cPatient completed a comprehensive diabetes education program\u201d",
  "3+ Injections invalid": "\u201cPatient injects insulin 3 or more times per day\u201d",
  "CGM Use invalid": "\u201cPatient uses a dexcom / freestyle libre daily\u201d",
  "Blood Sugar Issues invalid": "\u201cPatient experiences recurring hypoglycemia despite adhering to the treatment plan\u201d",
  "Letter of MN missing": "Signed LMN explaining why pump therapy is medically necessary",
  "Letter of MN invalid": "Signed LMN explaining why pump therapy is medically necessary",
  "OOW Date missing": "OOW date must be included on the script",
  "OOW Date not on script": "OOW date must be added to the script",
  "Malfunction missing": "Non-repairable malfunction reason must be included on the script",
  // --- New granular keys (Brandon's eval-state rewrite) ---
  "Hypoglycemia language": "\u201cPatient has experienced multiple Level 2 hypoglycemic events (<54 mg/dL), despite treatment adjustments\u201d",
  "Diabetes education completed": "\u201cPatient completed a comprehensive diabetes education program\u201d",
  "3+ insulin injections / day for > 6 months": "\u201cPatient injects insulin 3 or more times per day\u201d",
  "Current CGM use": "\u201cPatient uses a dexcom / freestyle libre daily\u201d",
  "Difficulty managing blood sugar despite treatment": "\u201cPatient experiences recurring hypoglycemia despite adhering to the treatment plan\u201d",
  "Updated Medical Records": "Most recent visit notes within the past 6 months",
  "OOW date": "Out-of-warranty date listed on the script",
  "OOW date \u2014 must be > 4 years": "Pump must be out of warranty for at least 4 years (5 for Medicare)",
  "Updated Insulin Pump Script": "Signed insulin pump script",
  "Updated Letter of Medical Necessity": "Signed LMN explaining why pump therapy is medically necessary",
  "Omnipod insufficient": "\u201cThe patient\u2019s current Omnipod system continues to malfunction despite reprogramming and manufacturer troubleshooting\u201d",
  "Non-repairable malfunction reason": "Non-repairable malfunction reason must be included on the script",
  // --- Consolidated / short-form keys ---
  "Medical Records": "Most recent visit notes within the past 6 months",
  "CGM Script": "Signed CGM script",
  "Insulin Pump Script": "Signed insulin pump script",
  "Letter of Medical Necessity": "Signed LMN explaining why pump therapy is medically necessary",
  "malfunction note": "Non-repairable malfunction reason must be included on the script",
  "blood sugar issues": "\u201cPatient experiences recurring hypoglycemia despite adhering to the treatment plan\u201d",
};

// --- Pre-built rows ----------------------------------------------------
const CGM_SCRIPT_ROW: ReqRow = {
  name: "CGM script",
  examples: "Signed",
  reasonKeys: CGM_SCRIPT_REASONS,
};
const CGM_SCRIPT_ROW_BUNDLED: ReqRow = {
  name: "CGM script",
  examples: "Signed (insurance often prefers the full bundle together)",
  reasonKeys: CGM_SCRIPT_REASONS,
};
const CGM_SCRIPT_ROW_NO_EXAMPLE: ReqRow = {
  name: "CGM script",
  reasonKeys: CGM_SCRIPT_REASONS,
};
const IP_SCRIPT_ROW: ReqRow = {
  name: "Insulin Pump script",
  examples: "Signed",
  reasonKeys: IP_SCRIPT_REASONS,
};
const IP_SCRIPT_ROW_NO_EXAMPLE: ReqRow = {
  name: "Insulin Pump script",
  reasonKeys: IP_SCRIPT_REASONS,
};
const DIAGNOSIS_ROW: ReqRow = {
  name: "Diagnosis > 6 months",
  examples: "\u201cPatient has been diagnosed with diabetes for 6+ months\u201d",
  reasonKeys: [],
  alwaysMissing: false,
};
const INJ_ROW: ReqRow = {
  name: "3+ insulin injections / day for > 6 months",
  examples:
    "\u201cPatient injects insulin 3 or more times per day with frequent self-adjustments\u201d",
  reasonKeys: INJ_REASONS,
};
const EDU_ROW: ReqRow = {
  name: "Diabetes education completed",
  examples: "\u201cPatient completed a comprehensive diabetes education program\u201d",
  reasonKeys: EDU_REASONS,
};
const CGM_USE_ROW: ReqRow = {
  name: "Current CGM use",
  examples: "\u201cPatient uses a dexcom / freestyle libre daily\u201d",
  reasonKeys: CGM_USE_REASONS,
};
const BS_ROW: ReqRow = {
  name: "Difficulty managing blood sugar despite treatment",
  examples:
    "\u201cPatient experiences recurring hypoglycemia despite adhering to the treatment plan\u201d or \u201cwide fluctuations in blood glucose before mealtime despite adhering to the treatment plan\u201d",
  reasonKeys: BS_REASONS,
};
const LMN_ROW: ReqRow = {
  name: "Letter of Medical Necessity",
  examples:
    "Signed LMN explaining why pump therapy is medically necessary now and why delay would be unsafe. Please reach out if you would like a draft for this patient.",
  reasonKeys: LMN_REASONS,
};

// --- Coverage path → block ---------------------------------------------

function cgmBlock(path?: string): TemplateBlock | null {
  if (path === "Insulin") {
    return {
      situation: "CGM for insulin-treated patient",
      rows: [CGM_SCRIPT_ROW],
    };
  }
  if (path === "Hypo") {
    return {
      situation: "CGM for patient experiencing hypoglycemia",
      rows: [CGM_SCRIPT_ROW],
    };
  }
  // "Invalid", "Hypo Invalid", "Missing", or unset all need the
  // hypoglycemia-language documentation row alongside CGM script.
  if (path === "Invalid" || path === "Hypo Invalid" || path === "Missing" || !path) {
    return {
      situation: !path || path === "Missing"
        ? "CGM — coverage path needs documentation"
        : "CGM — coverage path invalid",
      rows: [
        CGM_SCRIPT_ROW,
        {
          name: "Hypoglycemia language",
          examples:
            "\u201cPatient has experienced multiple Level 2 hypoglycemic events (<54 mg/dL), despite treatment adjustments\u201d",
          reasonKeys: HYPO_LANG_REASONS,
        },
      ],
    };
  }
  return null;
}

function ipBlock(path?: string, patient?: Patient): TemplateBlock | null {
  switch (path) {
    case "Supplies Only":
      return {
        situation: "Insulin Pump Supplies",
        rows: [IP_SCRIPT_ROW],
      };
    case "1st Pump >6M Diagnosed":
      return {
        situation: "First Time Pump User Diagnosed >6 Months Ago",
        rows: [
          CGM_SCRIPT_ROW_NO_EXAMPLE,
          IP_SCRIPT_ROW_NO_EXAMPLE,
          DIAGNOSIS_ROW,
          INJ_ROW,
          EDU_ROW,
          CGM_USE_ROW,
          BS_ROW,
        ],
      };
    case "1st Pump <6M Diagnosed":
      return {
        situation: "First Time Pump User Diagnosed <6 Months Ago",
        rows: [
          CGM_SCRIPT_ROW_BUNDLED,
          IP_SCRIPT_ROW,
          DIAGNOSIS_ROW,
          INJ_ROW,
          EDU_ROW,
          CGM_USE_ROW,
          BS_ROW,
          LMN_ROW,
        ],
      };
    case "OOW Pump": {
      const oowDateStr = patient?.oowDate ?? "___";
      return {
        situation: "Out-of-Warranty Pump",
        rows: [
          CGM_SCRIPT_ROW_BUNDLED,
          IP_SCRIPT_ROW,
          {
            name: "OOW date",
            examples: "Out-of-warranty date listed on the script",
            reasonKeys: ["OOW date", "OOW Date missing"],
          },
          {
            name: "OOW date — must be > 4 years",
            examples: "Pump must be out of warranty for at least 4 years (5 for Medicare)",
            reasonKeys: ["OOW date — must be > 4 years", "OOW Date missing"],
            // Also catches "OOW Date invalid (<X years)" via prefix match in isReceived
          },
          {
            name: `Add OOW date of ${oowDateStr} to the script`,
            examples: "Add OOW date to script",
            reasonKeys: [...OOW_NOT_ON_SCRIPT_REASONS, "Add OOW date"],
          },
          {
            name: "Non-repairable malfunction reason",
            examples: [
              "Non-repairable malfunction must be included on the script",
              "\u201ccracked/broken screen\u201d or \u201cbattery is depleted\u201d",
              "AND",
              "\u201cPump cannot be repaired or replaced\u201d",
            ],
            reasonKeys: MAL_REASONS,
          },
        ],
      };
    }
    case "Omnipod Switch":
      return {
        situation: "Switching from Omnipod",
        rows: [
          CGM_SCRIPT_ROW_NO_EXAMPLE,
          IP_SCRIPT_ROW_NO_EXAMPLE,
          DIAGNOSIS_ROW,
          INJ_ROW,
          EDU_ROW,
          CGM_USE_ROW,
          BS_ROW,
          {
            name: "Omnipod insufficient",
            examples:
              "\u201cThe patient\u2019s current Omnipod system continues to malfunction despite reprogramming and manufacturer troubleshooting\u201d",
            reasonKeys: MAL_REASONS,
          },
        ],
      };
    case "IW New Insurance":
      return {
        situation: "Continuation on New Insurance",
        rows: [
          CGM_SCRIPT_ROW_NO_EXAMPLE,
          IP_SCRIPT_ROW_NO_EXAMPLE,
          DIAGNOSIS_ROW,
          INJ_ROW,
          EDU_ROW,
          CGM_USE_ROW,
          BS_ROW,
        ],
      };
    default:
      return null;
  }
}

// =====================================================================
// Reason matching — whether each row is received vs missing
// =====================================================================

function splitReasons(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isReceived(row: ReqRow, allReasons: string[]): boolean {
  if (row.alwaysMissing) return false;
  if (row.reasonKeys.length === 0) {
    // Row has no reason mapping (e.g. Diagnosis > 6 months) — there’s no
    // "diagnosis age" reason on the board, so default to received.
    return true;
  }
  for (const r of allReasons) {
    if (row.reasonKeys.includes(r)) return false;
    // OOW Date can also fail with "OOW Date invalid (<X years)" (legacy)
    if (row.reasonKeys.includes("OOW Date missing") && r.startsWith("OOW Date invalid")) {
      return false;
    }
    // "Add OOW date of MM/DD/YYYY to the script" — prefix match
    if (row.reasonKeys.includes("Add OOW date") && r.startsWith("Add OOW date")) {
      return false;
    }
    // "OOW date — must be > 4 years" — also catch legacy "OOW Date invalid"
    if (row.reasonKeys.includes("OOW date — must be > 4 years") && r.startsWith("OOW Date invalid")) {
      return false;
    }
  }
  return true;
}

// =====================================================================
// Drawing primitives
// =====================================================================

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

interface DrawCtx {
  page: PDFPage;
  fonts: Fonts;
  logo: PDFImage;
  width: number;
  height: number;
  y: number;
  marginX: number;
  pdfDoc: PDFDocument;
}

const PAGE_W = 612; // letter
const PAGE_H = 792;
const MARGIN_X = 60;
const MARGIN_Y = 60;
const FOOTER_RESERVE = 50; // space reserved for footer at page bottom

/**
 * Ensure at least `needed` vertical points remain on the current page.
 * If not, draw the footer on the current page, add a new page, and
 * reset ctx so subsequent draws land on the fresh page.
 */
function ensureSpace(ctx: DrawCtx, needed: number) {
  if (ctx.y - needed >= MARGIN_Y) return; // plenty of room
  drawFooter(ctx);
  const newPage = ctx.pdfDoc.addPage([PAGE_W, PAGE_H]);
  ctx.page = newPage;
  ctx.y = PAGE_H - MARGIN_Y;
}

function drawCheck(page: PDFPage, cx: number, cy: number, color: RGB) {
  page.drawLine({ start: { x: cx - 5, y: cy + 0 }, end: { x: cx - 1, y: cy - 5 }, thickness: 2.4, color });
  page.drawLine({ start: { x: cx - 1, y: cy - 5 }, end: { x: cx + 6, y: cy + 6 }, thickness: 2.4, color });
}
function drawX(page: PDFPage, cx: number, cy: number, color: RGB) {
  page.drawLine({ start: { x: cx - 5, y: cy - 5 }, end: { x: cx + 5, y: cy + 5 }, thickness: 2.4, color });
  page.drawLine({ start: { x: cx + 5, y: cy - 5 }, end: { x: cx - 5, y: cy + 5 }, thickness: 2.4, color });
}

// Wrap text into lines that fit width, given font and size.
function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxW) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// =====================================================================
// Layout
// =====================================================================

function drawHeader(ctx: DrawCtx) {
  const { page, fonts, logo, width, marginX } = ctx;
  // Logo
  const logoMaxW = 150;
  const aspect = logo.height / logo.width;
  const logoH = logoMaxW * aspect;
  page.drawImage(logo, {
    x: marginX,
    y: ctx.y - logoH,
    width: logoMaxW,
    height: logoH,
  });

  // Right side: Fax + Email block — labels in teal with underline (link style)
  const rightX = width - marginX;
  const fax = "(347) 503 - 7148";
  const email = "records@medicallymodern.com";
  const labelSize = 14;
  const valueSize = 14;
  const faxLabelW = fonts.bold.widthOfTextAtSize("Fax: ", labelSize);
  const faxValueW = fonts.regular.widthOfTextAtSize(fax, valueSize);
  const emailLabelW = fonts.bold.widthOfTextAtSize("Email: ", labelSize);
  const emailValueW = fonts.regular.widthOfTextAtSize(email, valueSize);
  const faxLineW = faxLabelW + faxValueW;
  const emailLineW = emailLabelW + emailValueW;

  const faxY = ctx.y - 22;
  const faxLabelX = rightX - faxLineW;
  page.drawText("Fax:", { x: faxLabelX, y: faxY, size: labelSize, font: fonts.bold, color: LINK_TEAL });
  const faxLabelOnlyW = fonts.bold.widthOfTextAtSize("Fax:", labelSize);
  page.drawLine({ start: { x: faxLabelX, y: faxY - 2 }, end: { x: faxLabelX + faxLabelOnlyW, y: faxY - 2 }, thickness: 0.8, color: LINK_TEAL });
  page.drawText(" ", { x: faxLabelX + faxLabelOnlyW, y: faxY, size: labelSize, font: fonts.bold, color: TEXT });
  page.drawText(fax, { x: rightX - faxLineW + faxLabelW, y: faxY, size: valueSize, font: fonts.regular, color: TEXT });

  const emailY = ctx.y - 42;
  const emailLabelX = rightX - emailLineW;
  page.drawText("Email:", { x: emailLabelX, y: emailY, size: labelSize, font: fonts.bold, color: LINK_TEAL });
  const emailLabelOnlyW = fonts.bold.widthOfTextAtSize("Email:", labelSize);
  page.drawLine({ start: { x: emailLabelX, y: emailY - 2 }, end: { x: emailLabelX + emailLabelOnlyW, y: emailY - 2 }, thickness: 0.8, color: LINK_TEAL });
  page.drawText(" ", { x: emailLabelX + emailLabelOnlyW, y: emailY, size: labelSize, font: fonts.bold, color: TEXT });
  page.drawText(email, { x: rightX - emailLineW + emailLabelW, y: emailY, size: valueSize, font: fonts.regular, color: TEXT });

  ctx.y -= Math.max(logoH, 55);

  // Teal divider — full width
  page.drawLine({
    start: { x: marginX, y: ctx.y },
    end: { x: width - marginX, y: ctx.y },
    thickness: 2,
    color: TEAL,
  });
  ctx.y -= 16;

  // Title — clean teal text, no underline (matches Google template)
  const title = "Medical Necessity Request";
  page.drawText(title, {
    x: marginX,
    y: ctx.y - 36,
    size: 38,
    font: fonts.bold,
    color: TEAL,
  });
  ctx.y -= 64;
}

function drawSectionHeading(ctx: DrawCtx, text: string, fontSize = 18) {
  const { page, fonts, marginX } = ctx;
  const size = fontSize;
  page.drawText(text, {
    x: marginX,
    y: ctx.y - size,
    size,
    font: fonts.bold,
    color: TEXT,
  });
  // Underline
  const w = fonts.bold.widthOfTextAtSize(text, size);
  page.drawLine({
    start: { x: marginX, y: ctx.y - size - 3 },
    end: { x: marginX + w, y: ctx.y - size - 3 },
    thickness: 1,
    color: TEXT,
  });
  ctx.y -= size + 16;
}

function drawPatientInfo(ctx: DrawCtx, patient: Patient) {
  drawSectionHeading(ctx, "Patient Information");
  ctx.y -= 8; // extra space between heading and Name row

  const { page, fonts, marginX, width } = ctx;
  const indent = marginX + 10;
  const contentW = width - marginX * 2;

  // Name + DOB row
  page.drawText("Name:", { x: indent, y: ctx.y, size: 12, font: fonts.bold, color: TEXT });
  const nameLabelW = fonts.bold.widthOfTextAtSize("Name:", 12);
  page.drawText(` ${patient.name || ""}`, { x: indent + nameLabelW, y: ctx.y, size: 12, font: fonts.regular, color: TEXT });
  // DOB pushed right — leaves ~300pt for the name value
  const dobX = marginX + 340;
  page.drawText("Date of Birth:", { x: dobX, y: ctx.y, size: 12, font: fonts.bold, color: TEXT });
  const dobLabelW = fonts.bold.widthOfTextAtSize("Date of Birth:", 12);
  page.drawText(` ${patient.dob || ""}`, { x: dobX + dobLabelW, y: ctx.y, size: 12, font: fonts.regular, color: TEXT });
  ctx.y -= 18;

  // Horizontal separator line (matches template grid)
  page.drawLine({
    start: { x: indent, y: ctx.y },
    end: { x: marginX + contentW - 10, y: ctx.y },
    thickness: 0.5,
    color: BORDER,
  });
  ctx.y -= 10;
}

function drawIntroAndLegend(ctx: DrawCtx) {
  drawSectionHeading(ctx, "Medical Necessity Requirements", 26);
  ctx.y -= 10; // extra breathing room

  const { page, fonts, marginX, width } = ctx;
  const intro =
    "After reviewing the initial documentation, we still need a few items for insurance approval. We\u2019re happy to help make this process as easy as possible.";
  const lines = wrapText(intro, fonts.italic, 11, width - marginX * 2);
  for (const line of lines) {
    page.drawText(line, { x: marginX, y: ctx.y, size: 11, font: fonts.italic, color: GRAY });
    ctx.y -= 16;
  }
  ctx.y -= 16;

  // Legend: A ✘ means documentation is still needed.   A ✔ means already received.
  let x = marginX;
  const legY = ctx.y;
  page.drawText("A ", { x, y: legY, size: 14, font: fonts.bold, color: TEXT });
  x += fonts.bold.widthOfTextAtSize("A ", 14) + 2;
  drawX(page, x + 4, legY + 4, RED);
  x += 16;
  page.drawText(" means documentation is still needed.  ", {
    x,
    y: legY,
    size: 14,
    font: fonts.bold,
    color: TEXT,
  });
  x += fonts.bold.widthOfTextAtSize(" means documentation is still needed.  ", 14);
  page.drawText("A ", { x, y: legY, size: 14, font: fonts.bold, color: TEXT });
  x += fonts.bold.widthOfTextAtSize("A ", 14) + 2;
  drawCheck(page, x + 4, legY + 4, GREEN);
  x += 16;
  page.drawText(" means already received.", {
    x,
    y: legY,
    size: 14,
    font: fonts.bold,
    color: TEXT,
  });
  ctx.y -= 36;
}

function drawSituation(ctx: DrawCtx, situation: string) {
  // Situation label + table header + at least one row ≈ 22 + 28 + 40 = 90
  ensureSpace(ctx, 90);
  const { page, fonts, marginX } = ctx;
  page.drawText("Situation:", { x: marginX, y: ctx.y, size: 13, font: fonts.bold, color: TEXT });
  const w = fonts.bold.widthOfTextAtSize("Situation:", 13);
  page.drawText(` ${situation}`, {
    x: marginX + w,
    y: ctx.y,
    size: 13,
    font: fonts.regular,
    color: TEXT,
  });
  ctx.y -= 22;
}

const COL_X_STATUS = 0; // relative to table-x
const COL_X_REQ = 60;
const COL_X_EX = 220;

function drawTableColumnLines(page: PDFPage, tableX: number, tableW: number, topY: number, bottomY: number) {
  // Vertical divider: Status | Requirement
  page.drawLine({
    start: { x: tableX + COL_X_REQ - 6, y: topY },
    end: { x: tableX + COL_X_REQ - 6, y: bottomY },
    thickness: 0.5,
    color: BORDER,
  });
  // Vertical divider: Requirement | Examples
  page.drawLine({
    start: { x: tableX + COL_X_EX - 6, y: topY },
    end: { x: tableX + COL_X_EX - 6, y: bottomY },
    thickness: 0.5,
    color: BORDER,
  });
}

function drawTableHeader(ctx: DrawCtx) {
  // Header + at least one row ≈ 28 + 40 = 68
  ensureSpace(ctx, 68);
  const { page, fonts, marginX, width } = ctx;
  const tableX = marginX;
  const tableW = width - marginX * 2;
  const rowH = 28;
  const hdrTop = ctx.y + 4;
  const hdrBottom = ctx.y - rowH + 4;
  page.drawRectangle({
    x: tableX,
    y: hdrBottom,
    width: tableW,
    height: rowH,
    color: LIGHT,
    borderColor: BORDER,
    borderWidth: 0.5,
  });
  drawTableColumnLines(page, tableX, tableW, hdrTop, hdrBottom);
  const baseY = hdrBottom + 9;
  page.drawText("Status", { x: tableX + COL_X_STATUS + 10, y: baseY, size: 12, font: fonts.bold, color: TEXT });
  page.drawText("Requirement", { x: tableX + COL_X_REQ, y: baseY, size: 12, font: fonts.bold, color: TEXT });
  page.drawText("Examples of simple language for each requirement", {
    x: tableX + COL_X_EX,
    y: baseY,
    size: 10,
    font: fonts.bold,
    color: TEXT,
  });
  ctx.y -= rowH;
}

function drawTableRow(ctx: DrawCtx, row: ReqRow, allReasons: string[]) {
  const { fonts, marginX, width } = ctx;
  const tableX = marginX;
  const tableW = width - marginX * 2;
  const reqW = COL_X_EX - COL_X_REQ - 8;
  const exW = tableW - COL_X_EX - 10;

  // Wrap text in each column
  const reqLines = wrapText(row.name, fonts.regular, 11, reqW);
  const exParas = Array.isArray(row.examples) ? row.examples : row.examples ? [row.examples] : [];
  const exLines: string[] = [];
  for (const p of exParas) {
    const wrapped = wrapText(p, fonts.italic, 10, exW);
    exLines.push(...wrapped);
  }
  const linesNeeded = Math.max(reqLines.length, exLines.length, 1);
  const lineH = 14;
  const padY = 10;
  const rowH = padY * 2 + linesNeeded * lineH;

  // Page break if this row won't fit
  ensureSpace(ctx, rowH);
  const { page } = ctx;

  // Row border
  const cellTop = ctx.y;
  const cellBottom = ctx.y - rowH;
  page.drawRectangle({
    x: tableX,
    y: cellBottom,
    width: tableW,
    height: rowH,
    borderColor: BORDER,
    borderWidth: 0.5,
  });
  drawTableColumnLines(page, tableX, tableW, cellTop, cellBottom);

  // Status mark
  const received = isReceived(row, allReasons);
  const statusX = tableX + 22;
  const statusY = ctx.y - rowH / 2;
  if (received) drawCheck(page, statusX, statusY, GREEN);
  else drawX(page, statusX, statusY, RED);

  // Requirement column
  let textY = ctx.y - padY - 11;
  for (const line of reqLines) {
    page.drawText(line, {
      x: tableX + COL_X_REQ,
      y: textY,
      size: 11,
      font: fonts.regular,
      color: TEXT,
    });
    textY -= lineH;
  }

  // Examples column (italic gray)
  textY = ctx.y - padY - 10;
  for (const line of exLines) {
    page.drawText(line, {
      x: tableX + COL_X_EX,
      y: textY,
      size: 10,
      font: fonts.italic,
      color: GRAY,
    });
    textY -= lineH;
  }

  ctx.y -= rowH;
}

function drawFooter(ctx: DrawCtx) {
  const { page, fonts, marginX, width } = ctx;
  const text = "For any questions, you can call Medically Modern at: (347) 503 - 7148";
  const tWidth = fonts.regular.widthOfTextAtSize(text, 9);
  page.drawText(text, {
    x: (width - tWidth) / 2,
    y: 36,
    size: 9,
    font: fonts.regular,
    color: GRAY,
  });
  // marginX referenced to keep param signature consistent
  void marginX;
}

// =====================================================================
// Public API
// =====================================================================

export async function generateMnRequestPdf(patient: Patient): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const [regBytes, boldBytes, italBytes, logoBytes] = await Promise.all([
    fetchBytes(ROBOTO_REGULAR_URL),
    fetchBytes(ROBOTO_BOLD_URL),
    fetchBytes(ROBOTO_ITALIC_URL),
    fetchBytes(LOGO_URL),
  ]);
  const fonts: Fonts = {
    regular: await pdfDoc.embedFont(regBytes, { subset: true }),
    bold: await pdfDoc.embedFont(boldBytes, { subset: true }),
    italic: await pdfDoc.embedFont(italBytes, { subset: true }),
  };
  const logo = await pdfDoc.embedPng(logoBytes);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const ctx: DrawCtx = {
    page,
    fonts,
    logo,
    width: PAGE_W,
    height: PAGE_H,
    y: PAGE_H - MARGIN_Y,
    marginX: MARGIN_X,
    pdfDoc,
  };

  drawHeader(ctx);
  drawPatientInfo(ctx, patient);

  const cgm = cgmBlock(patient.cgmCoveragePath);
  const ip = ipBlock(patient.ipCoveragePath, patient);
  const blocks = [cgm, ip].filter((b): b is TemplateBlock => b !== null);

  // Prefer the consolidated, doctor-facing ask list. Fall back to the
  // legacy 3-bucket breakdown only if the new column isn't populated yet
  // (older patients evaluated before the rollup logic shipped).
  const consolidated = splitReasons(patient.mnRequestConsolidated);
  const allReasons = consolidated.length > 0
    ? consolidated
    : [
        ...splitReasons(patient.generalMnInvalidReasons),
        ...splitReasons(patient.cgmMnInvalidReasons),
        ...splitReasons(patient.ipMnInvalidReasons),
      ];

  if (blocks.length === 0 && allReasons.length > 0) {
    // No coverage-path blocks at all — show every reason as its own row.
    blocks.push({
      situation: "Outstanding Items",
      rows: allReasons.map((r) => ({
        name: r,
        examples: REASON_EXAMPLES[r],
        reasonKeys: [r],
      })),
    });
  } else if (blocks.length > 0 && allReasons.length > 0) {
    // Coverage-path blocks exist but may not cover every consolidated
    // reason (e.g. "Medical Records" has no matching template row).
    // Collect all reasonKeys already handled by template rows, then
    // surface any unmatched reasons as an extra block so nothing is
    // silently dropped from the PDF.
    const coveredKeys = new Set<string>();
    const coveredPrefixes: string[] = [];
    for (const b of blocks) {
      for (const row of b.rows) {
        for (const k of row.reasonKeys) {
          coveredKeys.add(k);
          // "Add OOW date" is a prefix-match key
          if (k === "Add OOW date") coveredPrefixes.push(k);
        }
      }
    }
    const unmatched = allReasons.filter((r) => {
      if (coveredKeys.has(r)) return false;
      // Check prefix matches (e.g. "Add OOW date of 07/15/2019 to the script")
      if (coveredPrefixes.some((p) => r.startsWith(p))) return false;
      // Legacy "OOW Date invalid (<X years)" covered by OOW Date missing key
      if (coveredKeys.has("OOW Date missing") && r.startsWith("OOW Date invalid")) return false;
      if (coveredKeys.has("OOW date \u2014 must be > 4 years") && r.startsWith("OOW Date invalid")) return false;
      return true;
    });
    if (unmatched.length > 0) {
      blocks.push({
        situation: "Additional Outstanding Items",
        rows: unmatched.map((r) => ({
          name: r,
          examples: REASON_EXAMPLES[r],
          reasonKeys: [r],
        })),
      });
    }
  }

  if (blocks.length > 0) {
    drawIntroAndLegend(ctx);

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      drawSituation(ctx, b.situation);
      drawTableHeader(ctx);
      for (const row of b.rows) {
        drawTableRow(ctx, row, allReasons);
      }
      ctx.y -= 18;
    }
  } else {
    ctx.page.drawText(
      "(No outstanding items — medical necessity is established.)",
      { x: MARGIN_X, y: ctx.y, size: 12, font: fonts.regular, color: GRAY },
    );
  }

  drawFooter(ctx);

  return pdfDoc.save();
}

export function downloadMnRequestPdf(patient: Patient, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = patient.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  a.download = `MN_Request_${safeName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function previewMnRequestPdf(bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}
