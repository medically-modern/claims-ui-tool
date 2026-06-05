import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BankPaymentMethodBadge, StatusBadge } from "@/components/claims/StatusBadge";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAllSecondaryClaims } from "@/hooks/useAllSecondaryClaims";
import { hasMondayToken } from "@/api/monday";
import {
  setSecondaryStatus,
  setSecondaryStatusAndMove,
  fireSendInvoiceTrigger,
  fireSendFollowUpTrigger,
  setSecondaryPayer,
  fireQuestionAnswered,
} from "@/api/setSecondaryStatus";
import {
  markSecondaryPaid as apiMarkSecondaryPaid,
  isMarkSecondaryPaidConfigured,
  MarkSecondaryPaidError,
} from "@/api/markSecondaryPaid";
import { confirmSecondaryPayor } from "@/api/confirmSecondaryPayor";
import { setSecondaryText, SECONDARY_PARENT_COL } from "@/api/setSecondaryText";
import {
  submitSecondary as apiSubmitSecondary,
  isSubmitSecondaryConfigured,
  SubmitSecondaryError,
} from "@/api/submitSecondary";
import {
  ArrowUpDown, Search, Send, ChevronDown, ChevronRight,
  ExternalLink, FileText, CheckCircle2, Clock, FileSearch, UserRound, Info,
  Loader2, Ban, MessageCircleQuestion
} from "lucide-react";

export type SecondaryMode = "submit" | "review";

// ─────────────────────────────────────────────────────────────────────────────
// Local types & fixtures — Secondary Board only
// ─────────────────────────────────────────────────────────────────────────────

export type SecondaryStatus =
  | "Awaiting Payor Confirmation"
  | "Primary Paid - Forwarded"
  | "Primary Paid - Submit Secondary"
  | "Secondary Submitted"
  | "Secondary ERA Received"
  | "Secondary Paid"
  | "Sent to Patient"
  | "Patient Paid"
  | "Bad Debt";

type SubmitBucket = "confirm" | "insurance" | "patient" | "awaiting";
// Review mode buckets, all five:
//   outstandingClaims  - insurance secondary submitted, awaiting ERA
//                        (was the single "Outstanding" bucket prior to
//                        the 2026-06 patient-flow split)
//   outstandingInvoices- patient invoice sent (Send Invoice clicked),
//                        awaiting patient payment. Rows leave the
//                        Submit > Patient bucket and land here.
//   eraReview          - secondary ERA received from the payer; needs
//                        operator sign-off before declaring Paid.
//   invoiceReview      - patient marked the invoice as paid; needs
//                        operator verification that the full amount
//                        cleared before declaring Patient Paid &
//                        Closed. Currently routed from status =
//                        "Patient Paid" (the Mark Paid button on
//                        Patient stage 2 lands them here).
//   paid               - terminal Paid And Closed.
type ReviewBucket =
  | "patientQuestions"
  | "outstandingClaims"
  | "outstandingInvoices"
  | "eraReview"
  | "invoiceReview"
  | "paid";
type AnyBucket = SubmitBucket | ReviewBucket;

export type PrReason = "Deductible" | "Coinsurance" | "Copay" | "Non-covered service" | "Bad debt (write off)";

export interface SecLine {
  id: string;
  product: string;
  hcpcs: string;
  modifiers: string[];
  charge: number;
  primaryPaid: number;
  primaryAdj: number;
  remaining: number;          // for submit / forwarded (= coinsuranceCopay + deductible)
  coinsuranceCopay?: number;  // PR-2 + PR-3 per subitem
  deductible?: number;        // PR-1 per subitem
  // Secondary ERA results (era bucket)
  secondaryPaid?: number;
  secondaryAdj?: number;
  patientResp?: number;       // remaining after secondary
  amountOwed?: number;        // for patient
  reason?: string;            // for patient line
  status: "Pending" | "Pending — denied by primary" | "Paid" | "Denied/Partial";
}

export interface SecClaim {
  id: string;
  /** Monday item id on the Secondary Claims Board (board 18413019028). */
  mondayItemId?: string;
  parentClaimId: string;
  status: SecondaryStatus;
  /**
   * Exact payer name from the secondary ERA's N1 (PR) envelope loop, e.g.
   * "AARP SUPPLEMENTAL HEALTH PLANS FROM UNITEDHEALTHCARE". Set only once
   * the secondary ERA arrives — undefined while the row is still Forwarded
   * awaiting crossover. Prefer this over secondaryPayer (status label)
   * for display in the ERA Review view.
   */
  secondaryPayerRawName?: string;
  /**
   * Whether the operator has reviewed and confirmed the submission type
   * in the Confirm Payor tab. Forwarded crossovers auto-confirm at spawn;
   * Insurance/Patient types spawn as false and only flip true once the
   * operator picks a destination from the Confirm Payor flow.
   */
  payorConfirmed?: boolean;
  /**
   * Raw Monday Secondary Status value (color_mm3a5yak). Used by the
   * Patient bucket body to decide which stage to render: "Submit" =
   * needs invoice, "Outstanding"/"Sent to Patient" = invoice sent
   * awaiting payment.
   */
  rawSecondaryStatus?: string;
  /**
   * Patient-facing pay link URL (Monday column text_mm3qag2c, "Pay
   * Link URL"). Populated upstream when the patient invoice is built.
   * The Preview Link button on the Patient → Send Invoice stage opens
   * this in a new tab so the operator can verify what the patient
   * will see before flipping Send Invoice → Done. Empty string /
   * undefined means no link generated yet; button renders disabled. */
  payLinkUrl?: string;
  /**
   * True only when the operator explicitly clicked Send Invoice in
   * our UI — fireSendInvoiceTrigger writes "Sent" to color_mm3x6qe6,
   * which lights this flag at read time. Used by bucketOf to decide
   * Outstanding Invoices vs Submit > Patient: Josh's
   * coins-form-payment webhook prematurely sets Monday's Secondary
   * Status to "Sent to Patient" the moment a pay link is generated
   * (before the operator has actually sent the invoice), so we
   * can't trust Secondary Status alone. */
  sendInvoiceTriggered?: boolean;
  /**
   * Free-text question the patient typed into the pay-link form
   * (long_text_mm3yqgyt). Surfaces in the Review > Patient Questions
   * bucket so ops can text/call them back.
   */
  patientQuestion?: string;
  /** True once the Mark Answered button has been clicked
   *  (color_mm41rxvr === "Answered" on Monday). Used by the Patient
   *  Questions bucket filter to hide already-answered questions while
   *  preserving the question text on the row. */
  patientQuestionAnswered?: boolean;
  patientName: string;
  primaryPayor: string;
  secondaryPayer: string | null;     // null = patient bucket with no secondary; "Other" = custom
  secondaryPayerOther?: string | null; // free-text payor name when secondaryPayer === "Other"
  primaryMemberId: string;
  secondaryMemberId: string;
  /** PR Payor ID — Stedi trading partner ID we send the secondary 837
   *  to (e.g. "ZTXQE" for Emblem Health). Read from Monday column
   *  text_mm1gcz3y. Editable inline on the Insurance row so the
   *  operator can correct it before clicking Submit Secondary. Empty
   *  string means not set; submission backend will refuse with a
   *  clear error pointing at this field. */
  payorId?: string;
  /** 277 lifecycle status mirrored from the primary board concept.
   *  Source: Secondary Board column color_mm1z1pb2 ("277 Status"),
   *  written by routes/stedi_webhook.handle_277_event when the 277
   *  for a secondary 837 lands. Drives the Awaiting Acceptance bucket
   *  (rows graduate to Outstanding once status flips to "Payer
   *  Accepted"). Null = no 277 received yet. */
  status277?: import("@/lib/claims/types").Status277;
  /** 277 rejection reason from Secondary Board column text_mm1zsp2x.
   *  Only meaningful when status277 ∈ {Stedi Rejected, Payer Rejected}. */
  rejectionReason277?: string;
  dos: string;
  diagnosis: string;
  type: "Original" | "Corrected";
  primaryPaid: number;
  primaryAdj: number;
  primaryPayDate: string;
  primarySentDate?: string;
  primaryIcn: string;
  remaining: number;
  // Deductible attributed at the claim level (not per-subitem). Common when the
  // payer applies the patient's annual deductible to the claim as a whole rather
  // than splitting it across line items.
  claimLevelDeductible?: number;
  expectedCrossoverEra?: string;
  forwardedFlag?: boolean;
  /** Bank deposit reconciliation — populated when a secondary 835 lands.
   *  Same fields as the primary Claim type. Drives the Bank Info strip
   *  in the ERA Review detail view. bankTraceNumber is the X12 TRN
   *  segment trace number, which is the universal identifier that
   *  appears in the bank's ACH addenda (e.g. `TRN*1*<trace>*<orig>`).
   *  PayPlus/ECHO Health-mediated payments mask the BPR payer
   *  originator id behind the processor's ORIG ID in Chase, so we
   *  surface the trace number instead — that's the value the operator
   *  can actually Ctrl+F in the bank statement. */
  bankDepositTotal?: number | null;
  bankPaymentMethod?: string | null;
  bankPayerOriginatorId?: string | null;
  bankEftDate?: string | null;
  bankTraceNumber?: string | null;
  // Secondary ERA fields (era bucket)
  secondarySentDate?: string;
  secondaryEraDate?: string;
  secondaryPayDate?: string;
  secondaryIcn?: string;
  secondaryPaid?: number;
  secondaryAdj?: number;
  patientResp?: number;
  prReason?: PrReason;
  prBreakdown?: { coinsurance: number; copay: number; deductible: number };
  patientNote?: string;
  lines: SecLine[];
}

// Mirrors the labels configured on Monday's Secondary Payor column
// (color_mkxq1a2p). Keep in sync — labels we surface here that don't
// exist on Monday end up auto-created (if create_labels_if_missing
// is on) or silently no-op'd.
const SECONDARY_PAYER_OPTIONS = [
  "Second to Secondary",
  "Patient",
  "NY Medicaid",
  "Medicare Suppl.",
  "Bad Debt",
  "No Patient Responsibility",
  "Horizon BCBS NJ",
  "Cigna",
  "Molina",
  "Emblem Health",
  "None",
];

// Auto-fill PR Payor ID (Stedi trading partner) when a Secondary Payor
// with a known ID is selected. Operators can still override the field
// manually. Only includes payors we have confirmed Stedi IDs for —
// others leave the field blank for the operator to fill in.
const SECONDARY_PAYER_TO_STEDI_ID: Record<string, string> = {
  "NY Medicaid":   "MCDNY",
  "Emblem Health": "ZTXQE",
};
const OTHER_PAYER = "Other";
const DIAGNOSIS_OPTIONS = ["E10.65", "E11.9", "E10.9", "E11.65"];

const displaySecondary = (c: SecClaim) =>
  c.secondaryPayer === OTHER_PAYER ? (c.secondaryPayerOther?.trim() || "Custom payor") : (c.secondaryPayer ?? "—");

const today = new Date();
function dAgo(n: number) { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function dAhead(n: number) { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

const INITIAL_SEC_CLAIMS: SecClaim[] = [
  // FORWARDED — Medicare crossover
  {
    id: "claim_sec_001",
    parentClaimId: "claim_001",
    status: "Primary Paid - Forwarded",
    patientName: "Maria Gonzalez",
    primaryPayor: "Medicare A&B",
    secondaryPayer: "NY Medicaid",
    primaryMemberId: "1EG4-TE5-MK73",
    secondaryMemberId: "MED12345",
    dos: dAgo(28),
    diagnosis: "E11.9",
    type: "Original",
    primaryPaid: 850,
    primaryAdj: 200,
    primaryPayDate: dAgo(8),

    primarySentDate: dAgo(15),
    primaryIcn: "ABC123",
    remaining: 150,
    claimLevelDeductible: 150, // payer applied annual deductible at claim level, not per item
    expectedCrossoverEra: "10–14 days after primary",
    forwardedFlag: true,
    lines: [
      { id: "L1", product: "Insulin Pump", hcpcs: "E0784", modifiers: ["NU"],
        charge: 4500, primaryPaid: 850, primaryAdj: 200, remaining: 0,
        coinsuranceCopay: 0, deductible: 0, status: "Pending" },
    ],
  },
  {
    id: "claim_sec_004",
    parentClaimId: "claim_004",
    status: "Primary Paid - Forwarded",
    patientName: "Harold Becker",
    primaryPayor: "Medicare A&B",
    secondaryPayer: "AARP Supplement",
    primaryMemberId: "2QW8-RN1-LP44",
    secondaryMemberId: "AARP-771199",
    dos: dAgo(35),
    diagnosis: "E10.65",
    type: "Original",
    primaryPaid: 620,
    primaryAdj: 130,
    primaryPayDate: dAgo(12),

    primarySentDate: dAgo(19),
    primaryIcn: "MED9981",
    remaining: 90,
    expectedCrossoverEra: "10–14 days after primary",
    forwardedFlag: true,
    lines: [
      { id: "L1", product: "CGM Sensors", hcpcs: "A4239", modifiers: ["KX"],
        charge: 312, primaryPaid: 220, primaryAdj: 30, remaining: 60,
        coinsuranceCopay: 20, deductible: 40, status: "Pending" },
      { id: "L2", product: "Cartridges", hcpcs: "A4232", modifiers: ["NU"],
        charge: 95, primaryPaid: 50, primaryAdj: 15, remaining: 30,
        coinsuranceCopay: 10, deductible: 20, status: "Pending" },
    ],
  },
  // SUBMIT TO SECONDARY — non-Medicare primary
  {
    id: "claim_sec_002",
    parentClaimId: "claim_002",
    status: "Primary Paid - Submit Secondary",
    patientName: "Maria Gonzalez",
    primaryPayor: "Aetna",
    secondaryPayer: "Medicaid",
    primaryMemberId: "1EG4-TE5-MK73",
    secondaryMemberId: "MED12345",
    dos: dAgo(20),
    diagnosis: "E11.9",
    type: "Original",
    primaryPaid: 850,
    primaryAdj: 200,
    primaryPayDate: dAgo(5),

    primarySentDate: dAgo(12),
    primaryIcn: "ABC123",
    remaining: 350,
    lines: [
      { id: "L1", product: "Insulin Pump", hcpcs: "E0784", modifiers: ["NU"],
        charge: 1200, primaryPaid: 850, primaryAdj: 200, remaining: 150,
        coinsuranceCopay: 30, deductible: 120, status: "Pending" },
      { id: "L2", product: "CGM Sensors", hcpcs: "A4239", modifiers: [],
        charge: 200, primaryPaid: 0, primaryAdj: 200, remaining: 200,
        coinsuranceCopay: 50, deductible: 150,
        status: "Pending — denied by primary" },
    ],
  },
  {
    id: "claim_sec_005",
    parentClaimId: "claim_005",
    status: "Primary Paid - Submit Secondary",
    patientName: "Tomas Rivera",
    primaryPayor: "United Healthcare",
    secondaryPayer: OTHER_PAYER,
    secondaryPayerOther: "Cigna Supplement Plan F",
    primaryMemberId: "UHC-998112-03",
    secondaryMemberId: "NYM-22041",
    dos: dAgo(16),
    diagnosis: "E10.9",
    type: "Original",
    primaryPaid: 410,
    primaryAdj: 90,
    primaryPayDate: dAgo(3),

    primarySentDate: dAgo(10),
    primaryIcn: "UHC-552014",
    remaining: 120,
    lines: [
      { id: "L1", product: "Infusion Sets", hcpcs: "A4230", modifiers: ["NU"],
        charge: 185, primaryPaid: 100, primaryAdj: 20, remaining: 65,
        coinsuranceCopay: 25, deductible: 40, status: "Pending" },
      { id: "L2", product: "Cartridges", hcpcs: "A4232", modifiers: ["NU"],
        charge: 95, primaryPaid: 35, primaryAdj: 5, remaining: 55,
        coinsuranceCopay: 20, deductible: 35, status: "Pending" },
    ],
  },
  // PATIENT
  {
    id: "claim_pat_001",
    parentClaimId: "claim_003",
    status: "Sent to Patient",
    patientName: "Maria Gonzalez",
    primaryPayor: "UHC",
    secondaryPayer: "Medicaid",
    primaryMemberId: "1EG4-TE5-MK73",
    secondaryMemberId: "MED12345",
    dos: dAgo(45),
    diagnosis: "E11.9",
    type: "Original",
    primaryPaid: 850,
    primaryAdj: 200,
    primaryPayDate: dAgo(25),

    primarySentDate: dAgo(32),
    primaryIcn: "UHC-44871",
    remaining: 150,
    prReason: "Deductible",
    prBreakdown: { coinsurance: 0, copay: 0, deductible: 150 },
    patientNote: "Patient deductible — please remit by " + dAhead(14),
    lines: [
      { id: "L1", product: "Insulin Pump", hcpcs: "E0784", modifiers: ["NU"],
        charge: 1200, primaryPaid: 850, primaryAdj: 200, remaining: 150,
        coinsuranceCopay: 0, deductible: 150,
        amountOwed: 150, reason: "Annual deductible", status: "Pending" },
    ],
  },
  {
    id: "claim_pat_002",
    parentClaimId: "claim_006",
    status: "Sent to Patient",
    patientName: "Lina Park",
    primaryPayor: "Cigna",
    secondaryPayer: null,
    primaryMemberId: "CIG-44-882201",
    secondaryMemberId: "—",
    dos: dAgo(33),
    diagnosis: "E11.65",
    type: "Original",
    primaryPaid: 280,
    primaryAdj: 60,
    primaryPayDate: dAgo(15),

    primarySentDate: dAgo(22),
    primaryIcn: "CIG-88102",
    remaining: 60,
    prReason: "Copay",
    prBreakdown: { coinsurance: 0, copay: 60, deductible: 0 },
    patientNote: "Patient copay due.",
    lines: [
      { id: "L1", product: "CGM Sensors", hcpcs: "A4239", modifiers: ["KX"],
        charge: 340, primaryPaid: 280, primaryAdj: 60, remaining: 60,
        coinsuranceCopay: 60, deductible: 0,
        amountOwed: 60, reason: "Plan copay", status: "Pending" },
    ],
  },
  {
    id: "claim_pat_003",
    parentClaimId: "claim_010",
    status: "Sent to Patient",
    patientName: "Renee Alvarez",
    primaryPayor: "BCBS",
    secondaryPayer: "AARP Supplement",
    primaryMemberId: "BCBS-7782-AA",
    secondaryMemberId: "AARP-994412",
    dos: dAgo(38),
    diagnosis: "E10.65",
    type: "Original",
    primaryPaid: 540,
    primaryAdj: 110,
    primaryPayDate: dAgo(18),
    primarySentDate: dAgo(25),
    primaryIcn: "BCBS-553311",
    remaining: 220,
    prReason: "Coinsurance",
    prBreakdown: { coinsurance: 95, copay: 0, deductible: 125 },
    patientNote: "Remaining balance after BCBS and AARP — please remit by " + dAhead(14),
    lines: [
      { id: "L1", product: "CGM Sensors", hcpcs: "A4239", modifiers: ["KX"],
        charge: 312, primaryPaid: 220, primaryAdj: 30, remaining: 130,
        coinsuranceCopay: 50, deductible: 80,
        amountOwed: 130, reason: "Deductible + 20% coinsurance", status: "Pending" },
      { id: "L2", product: "Insulin Pump Supplies", hcpcs: "A4230", modifiers: ["NU"],
        charge: 200, primaryPaid: 130, primaryAdj: 20, remaining: 90,
        coinsuranceCopay: 45, deductible: 45,
        amountOwed: 90, reason: "20% coinsurance", status: "Pending" },
    ],
  },
  // OUTSTANDING (review) — secondary already submitted, awaiting payer response
  {
    id: "claim_sec_006",
    parentClaimId: "claim_007",
    status: "Secondary Submitted",
    patientName: "Devon Wright",
    primaryPayor: "Aetna",
    secondaryPayer: "Medicaid",
    primaryMemberId: "AET-771-29A",
    secondaryMemberId: "MED77231",
    dos: dAgo(22),
    diagnosis: "E10.9",
    type: "Original",
    primaryPaid: 540,
    primaryAdj: 110,
    primaryPayDate: dAgo(9),

    primarySentDate: dAgo(16),
    primaryIcn: "AET-99812",
    remaining: 110,
    lines: [
      { id: "L1", product: "CGM Sensors", hcpcs: "A4239", modifiers: ["KX"],
        charge: 312, primaryPaid: 220, primaryAdj: 50, remaining: 60,
        coinsuranceCopay: 50, deductible: 10, status: "Pending" },
      { id: "L2", product: "Cartridges", hcpcs: "A4232", modifiers: ["NU"],
        charge: 95, primaryPaid: 60, primaryAdj: 15, remaining: 50,
        coinsuranceCopay: 40, deductible: 10, status: "Pending" },
    ],
  },
  // ERA REVIEW — secondary paid, ready to post
  {
    id: "claim_sec_era_001",
    parentClaimId: "claim_008",
    status: "Secondary ERA Received",
    patientName: "Harold Becker",
    primaryPayor: "Medicare A&B",
    secondaryPayer: "AARP Supplement",
    primaryMemberId: "2QW8-RN1-LP44",
    secondaryMemberId: "AARP-771199",
    dos: dAgo(40),
    diagnosis: "E10.65",
    type: "Original",
    primaryPaid: 620,
    primaryAdj: 130,
    primaryPayDate: dAgo(20),
    primarySentDate: dAgo(27),
    primaryIcn: "MED-44218",
    remaining: 90,
    secondarySentDate: dAgo(18),
    secondaryEraDate: dAgo(3),
    secondaryPayDate: dAgo(2),
    secondaryIcn: "AARP-ERA-55129",
    secondaryPaid: 80,
    secondaryAdj: 0,
    patientResp: 10,
    lines: [
      { id: "L1", product: "CGM Sensors", hcpcs: "A4239", modifiers: ["KX"],
        charge: 312, primaryPaid: 220, primaryAdj: 30, remaining: 60,
        coinsuranceCopay: 20, deductible: 40,
        secondaryPaid: 55, secondaryAdj: 0, patientResp: 5, status: "Paid" },
      { id: "L2", product: "Cartridges", hcpcs: "A4232", modifiers: ["NU"],
        charge: 95, primaryPaid: 50, primaryAdj: 15, remaining: 30,
        coinsuranceCopay: 10, deductible: 20,
        secondaryPaid: 25, secondaryAdj: 0, patientResp: 5, status: "Paid" },
    ],
  },
  // ERA REVIEW — secondary partially paid, leaves patient balance
  {
    id: "claim_sec_era_002",
    parentClaimId: "claim_009",
    status: "Secondary ERA Received",
    patientName: "Devon Wright",
    primaryPayor: "Aetna",
    secondaryPayer: "Medicaid",
    primaryMemberId: "AET-771-29A",
    secondaryMemberId: "MED77231",
    dos: dAgo(31),
    diagnosis: "E10.9",
    type: "Original",
    primaryPaid: 540,
    primaryAdj: 110,
    primaryPayDate: dAgo(14),
    primarySentDate: dAgo(21),
    primaryIcn: "AET-99812",
    remaining: 110,
    secondarySentDate: dAgo(11),
    secondaryEraDate: dAgo(2),
    secondaryPayDate: dAgo(1),
    secondaryIcn: "MCD-ERA-77001",
    secondaryPaid: 75,
    secondaryAdj: 20,
    patientResp: 15,
    lines: [
      { id: "L1", product: "CGM Sensors", hcpcs: "A4239", modifiers: ["KX"],
        charge: 312, primaryPaid: 220, primaryAdj: 50, remaining: 60,
        coinsuranceCopay: 50, deductible: 10,
        secondaryPaid: 45, secondaryAdj: 10, patientResp: 5, status: "Paid" },
      { id: "L2", product: "Cartridges", hcpcs: "A4232", modifiers: ["NU"],
        charge: 95, primaryPaid: 60, primaryAdj: 15, remaining: 50,
        coinsuranceCopay: 40, deductible: 10,
        secondaryPaid: 30, secondaryAdj: 10, patientResp: 10, status: "Paid" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const $ = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });

const STATUS_TONE: Record<SecLine["status"], "warning" | "danger" | "success" | "neutral"> = {
  "Pending": "warning",
  "Pending — denied by primary": "danger",
  "Paid": "success",
  "Denied/Partial": "danger",
};

function bucketOf(c: SecClaim): AnyBucket | null {
  if (c.status === "Awaiting Payor Confirmation") return "confirm";
  if (c.status === "Primary Paid - Submit Secondary") return "insurance";
  // Patient flow splits across THREE buckets based on lifecycle stage:
  //   Stage 1 (Submit > Patient)              — still needs Send Invoice.
  //                                             rawSecondaryStatus === "Submit"
  //   Stage 2 (Review > Outstanding Invoices) — invoice sent, awaiting payment.
  //                                             rawSecondaryStatus ∈ {Outstanding,
  //                                             Sent to Patient, ...}
  //   Stage 3 (Review > Invoice Review)       — patient marked it paid; needs
  //                                             operator verification (status =
  //                                             "Patient Paid", handled below).
  // The split is what lets "after sending, it shouldn't show up on the
  // Submit board anymore" actually work — pre-split, every patient row
  // sat in Submit > Patient regardless of stage.
  if (c.status === "Sent to Patient") {
    // Use OUR Send Invoice trigger (color_mm3x6qe6 → "Sent") as the
    // authoritative "operator actually sent the invoice" signal —
    // NOT Monday's Secondary Status. Josh's coins-form-payment
    // webhook prematurely writes Secondary Status = "Sent to Patient"
    // when a payment link is generated, well before the operator
    // clicks our Send Invoice button. Trusting Secondary Status alone
    // inflated Outstanding Invoices with 16 patients who had never
    // actually been invoiced (2026-06-03 audit). The trigger column
    // is only ever written by our own UI, so it's the trustworthy
    // signal.
    if (c.sendInvoiceTriggered) return "outstandingInvoices";
    return "patient";
  }
  // Patient marked the invoice paid. Land them in Invoice Review for
  // the operator to verify the full amount cleared before declaring
  // terminal Paid. Mark Paid (Patient stage 2) writes secondaryStatus
  // = "Patient Paid" on Monday; deriveStatus maps that to the frontend
  // status "Patient Paid", which is what this branch fires on.
  if (c.status === "Patient Paid") return "invoiceReview";
  // Awaiting Acceptance — mirrors the primary bucket. Submitted via
  // Stedi but the payer hasn't acknowledged with a clean 277 yet.
  // Graduates to "outstandingClaims" once status277 = "Payer Accepted".
  // Forwarded rows stay in outstandingClaims (no 277 expected — they're
  // waiting on the crossover ERA, not on payer ack).
  if (c.status === "Secondary Submitted" && c.status277 !== "Payer Accepted") {
    return "awaiting";
  }
  if (c.status === "Primary Paid - Forwarded" || c.status === "Secondary Submitted") return "outstandingClaims";
  // Any ERA-received row lands in the ERA Review bucket for operator
  // sign-off. Even when the secondary covered the patient's remaining
  // balance dollar-for-dollar, we still want a human eye on it (CARC/
  // RARC codes, denial line items, bank reconciliation) before it's
  // declared closed. Mark Posted moves it to "Secondary Paid" status,
  // which is what bucketOf reads to route into the Paid bucket.
  if (c.status === "Secondary ERA Received") return "eraReview";
  if (c.status === "Secondary Paid") return "paid";
  return null;
}

const BUCKET_META: Record<AnyBucket, { label: string; icon: React.ReactNode; tone: string; description?: string }> = {
  confirm:     { label: "Confirm Payor",    icon: <FileSearch className="h-4 w-4" />, tone: "text-warning-soft-foreground" },
  insurance:   { label: "Insurance",        icon: <Send className="h-4 w-4" />,      tone: "text-warning-soft-foreground" },
  patient:     {
    label: "Patient",
    icon: <UserRound className="h-4 w-4" />,
    tone: "text-primary",
    description: "Stage 1 — invoice not yet sent. Once you click Send Invoice the row leaves this bucket and shows up under Review > Outstanding Invoices.",
  },
  awaiting:    {
    label: "Awaiting Acceptance",
    icon: <Clock className="h-4 w-4" />,
    tone: "text-info-soft-foreground",
    description: "Submitted to the secondary payer (via Stedi) but no 'Payer Accepted' 277 yet. Stays here until the payer acknowledges, then graduates to Outstanding Claims.",
  },
  patientQuestions: {
    label: "Patient Questions",
    icon: <MessageCircleQuestion className="h-4 w-4" />,
    tone: "text-warning-soft-foreground",
    description: "Patient wrote a question on the pay-link form. Text or call back to answer.",
  },
  outstandingClaims: {
    label: "Outstanding Claims",
    icon: <Clock className="h-4 w-4" />,
    tone: "text-info-soft-foreground",
    description: "Insurance secondary submitted; awaiting the payer's ERA.",
  },
  outstandingInvoices: {
    label: "Outstanding Invoices",
    icon: <FileText className="h-4 w-4" />,
    tone: "text-info-soft-foreground",
    description: "Patient invoice sent (Send Invoice clicked); awaiting payment from the patient.",
  },
  eraReview:    {
    label: "ERA Review",
    icon: <FileSearch className="h-4 w-4" />,
    tone: "text-info-soft-foreground",
    description: "Secondary ERA received; verify CARC/RARC + bank deposit, then Mark Posted.",
  },
  invoiceReview: {
    label: "Invoice Review",
    icon: <FileSearch className="h-4 w-4" />,
    tone: "text-info-soft-foreground",
    description: "Patient marked the invoice paid. Verify the full amount cleared before declaring Paid & Closed.",
  },
  paid:        { label: "Paid",             icon: <CheckCircle2 className="h-4 w-4" />, tone: "text-success-soft-foreground" },
};

const MODE_BUCKETS: Record<SecondaryMode, AnyBucket[]> = {
  // Awaiting Acceptance sits alongside Insurance/Patient in the Submit
  // mode because that's where the operator monitors what's already
  // been 837'd and is in 277 limbo — same mental cohort as "things I
  // just submitted, watching the response."
  submit: ["confirm", "insurance", "patient", "awaiting"],
  // Review splits Outstanding into two flows (claims vs invoices) and
  // adds Invoice Review as a sign-off step before terminal Paid. ERA
  // Review remains the insurance side; Invoice Review is the patient
  // side equivalent.
  review: [
    "patientQuestions",
    "outstandingClaims",
    "outstandingInvoices",
    "eraReview",
    "invoiceReview",
    "paid",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Main board
// ─────────────────────────────────────────────────────────────────────────────

// One-shot deep-link target from the Action Items inbox. Versioned by
// object identity (new ref every chip click) so re-clicking the same
// chip after the operator has navigated internally still snaps back.
export interface SecondaryNavTo {
  secondaryBucket?: AnyBucket;
}

export function SecondaryBoard({ mode = "submit", navTo }: { mode?: SecondaryMode; navTo?: SecondaryNavTo | null }) {
  // Live data from Monday's Secondary Claims Board (id 18413019028).
  // Falls back to mock data when no Monday token is configured (local dev
  // without a .env, or PR previews) so the UI still renders something.
  const {
    data: mondayClaims,
    isFetching: secondaryLoading,
    refetch: refetchSecondary,
  } = useAllSecondaryClaims();
  const liveAvailable = hasMondayToken();
  const initialClaims: SecClaim[] = liveAvailable
    ? mondayClaims ?? []
    : INITIAL_SEC_CLAIMS;

  // Local working copy so the optimistic Submit / Mark Paid actions still
  // work without a round-trip. Each time the live list changes we replay
  // it into local state so newly-arrived items show up.
  const [claims, setClaims] = useState<SecClaim[]>(initialClaims);
  useEffect(() => {
    if (liveAvailable) setClaims(mondayClaims ?? []);
  }, [liveAvailable, mondayClaims]);

  const buckets = MODE_BUCKETS[mode];
  const [bucket, setBucket] = useState<AnyBucket>(buckets[0]);
  const [search, setSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState<string>("all");
  // Sort options:
  //   dos / patient / payer  — universal sorts available in every bucket
  //   prHigh / prLow         — patient-responsibility-amount sort, exposed
  //                            only in the Confirm Payor bucket where it's
  //                            the triage signal for routing.
  //
  // The sort value is c.remaining, which is the row's TOTAL patient
  // responsibility (coinsuranceCopay + deductible) — the same dollar
  // figure the row card shows next to "Remaining" / "Deductible" /
  // "Coinsurance" depending on which PR component dominates. We sort by
  // remaining regardless of which label is showing so $190 of pure
  // deductible sorts correctly against $190 of pure coinsurance.
  //
  // Earlier version summed line.coinsuranceCopay only, which broke for
  // deductible-only rows (e.g. Muggzy Jackson $190.78 deductible sorted
  // as $0 against actual-coinsurance rows). prHigh/prLow on c.remaining
  // gets every row right.
  const [sortBy, setSortBy] = useState<
    "dos" | "patient" | "payer" | "prHigh" | "prLow"
  >("dos");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Reset bucket when mode changes
  useMemo(() => {
    if (!buckets.includes(bucket)) setBucket(buckets[0]);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply inbox deep-link target when the prop reference changes.
  // Guards against a navTo for a bucket that isn't valid in the
  // current mode (e.g. inbox says "era" but mode just flipped to
  // "submit" before this effect runs — wait for the next render
  // when buckets array updates).
  useEffect(() => {
    if (!navTo?.secondaryBucket) return;
    if (buckets.includes(navTo.secondaryBucket)) {
      setBucket(navTo.secondaryBucket);
    }
  }, [navTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const out: Record<AnyBucket, number> = {
      confirm: 0, insurance: 0, patient: 0, awaiting: 0,
      outstandingClaims: 0, outstandingInvoices: 0,
      patientQuestions: 0,
      eraReview: 0, invoiceReview: 0, paid: 0,
    };
    for (const c of claims) {
      const b = bucketOf(c);
      if (b) out[b] += 1;
      // patientQuestions is additive — count any claim with a non-empty
      // patient question regardless of its routing bucket
      if (c.patientQuestion && c.patientQuestion.trim() && !c.patientQuestionAnswered) {
        out.patientQuestions += 1;
      }
    }
    return out;
  }, [claims]);

  // Awaiting Acceptance roll-ups — mirror PrimarySubmitBoard's pills so
  // the operator can see trouble on the tile without clicking in.
  //   red:   payer rejected (277 said no — needs rework)
  //   amber: Stedi-Accepted for ≥48h with no payer response (stale)
  const awaitingClaims = useMemo(
    () => claims.filter((c) => bucketOf(c) === "awaiting"),
    [claims],
  );
  const awaitingPayerRejectedCount = useMemo(
    () => awaitingClaims.filter((c) => c.status277 === "Payer Rejected").length,
    [awaitingClaims],
  );
  const awaitingStaleCount = useMemo(() => {
    const now = Date.now();
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    return awaitingClaims.filter((c) => {
      if (c.status277 !== "Stedi Accepted") return false;
      const sentIso = c.primarySentDate;
      if (!sentIso) return false;
      const sentMs = new Date(sentIso).getTime();
      if (!Number.isFinite(sentMs)) return false;
      return now - sentMs >= FORTY_EIGHT_HOURS_MS;
    }).length;
  }, [awaitingClaims]);

  const visible = useMemo(() => {
    return claims
      .filter((c) => bucket === "patientQuestions"
        ? !!(c.patientQuestion && c.patientQuestion.trim() && !c.patientQuestionAnswered)
        : bucketOf(c) === bucket)
      .filter((c) => payerFilter === "all" || c.primaryPayor === payerFilter || c.secondaryPayer === payerFilter)
      .filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          c.patientName.toLowerCase().includes(q) ||
          c.primaryPayor.toLowerCase().includes(q) ||
          (c.secondaryPayer ?? "").toLowerCase().includes(q) ||
          c.parentClaimId.toLowerCase().includes(q) ||
          c.primaryIcn.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === "patient") return a.patientName.localeCompare(b.patientName);
        if (sortBy === "payer") return (a.secondaryPayer ?? "").localeCompare(b.secondaryPayer ?? "");
        if (sortBy === "prHigh" || sortBy === "prLow") {
          // Sort by c.remaining (the row-level total of coinsuranceCopay
          // + deductible). That's the same dollar figure the row card
          // shows whether it's labeled "Remaining" / "Deductible" /
          // "Coinsurance" — sorting on c.remaining means the comparator
          // doesn't care which PR-component is dominant. Null/undefined
          // remaining treated as 0 so rows still sort predictably.
          const totalA = a.remaining ?? 0;
          const totalB = b.remaining ?? 0;
          return sortBy === "prHigh" ? totalB - totalA : totalA - totalB;
        }
        return a.dos.localeCompare(b.dos);
      });
  }, [claims, bucket, payerFilter, search, sortBy]);

  // When the operator switches buckets away from Confirm Payor and the
  // current sort is a coinsurance-only option, fall back to DOS — the
  // coinsurance signal isn't meaningful outside Confirm Payor (e.g.,
  // Paid rows already settled, Outstanding rows might not even have a
  // PR breakdown yet).
  useEffect(() => {
    if (bucket !== "confirm" && (sortBy === "prHigh" || sortBy === "prLow")) {
      setSortBy("dos");
    }
  }, [bucket, sortBy]);

  const allPayers = useMemo(
    () => Array.from(new Set(claims.flatMap((c) => [c.primaryPayor, c.secondaryPayer ?? ""]))).filter(Boolean).sort(),
    [claims],
  );

  const updateClaim = (id: string, patch: Partial<SecClaim>) =>
    setClaims((arr) => arr.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  async function submitSecondary(c: SecClaim, manual = false) {
    if (!c.mondayItemId) return;
    const name = displaySecondary(c);

    // Manual path: operator submitted outside Stedi (paper, fax, portal).
    // We don't call the backend submit endpoint — just flip Monday status
    // and move the row so the visual board reflects "tracked manually".
    if (manual) {
      updateClaim(c.id, { status: "Secondary Submitted" });
      try {
        await setSecondaryStatusAndMove(
          c.mondayItemId,
          "Submitted",
          "group_mm332zns",  // Insurance Outstanding
        );
        toast({
          title: `Secondary marked submitted manually: ${c.patientName}`,
          description: `Tracked outside Stedi (paper / fax / portal) → ${name}.`,
        });
        void refetchSecondary();
      } catch (e) {
        toast({
          title: "Couldn't update Monday",
          description: (e as Error).message,
        });
      }
      return;
    }

    // Auto path: actually send the 837 through Stedi. Backend handles
    // payload build (COB-shaped), Stedi POST, and writeback of Claim ID
    // + PCN + Claim Sent Date + Status=Submitted. We DON'T pre-flip the
    // local row because if Stedi 400's we want the row to stay in
    // Insurance / Submit Claim so the operator can fix and retry.
    if (!isSubmitSecondaryConfigured()) {
      toast({
        title: "Submit Secondary isn't configured",
        description:
          "Set VITE_API_BASE_URL and VITE_ADMIN_API_KEY at build time, or " +
          "use the Mark Submitted Manually option if you submitted outside Stedi.",
      });
      return;
    }
    // Round-trip is 3–8s (fetch parent → build payload → Stedi POST →
    // writeback to Monday). Pop an immediate "Submitting…" toast so
    // the operator has feedback while the button spinner spins. Since
    // TOAST_LIMIT=1 in use-toast, the success/error toast below
    // replaces it the moment Stedi responds — no manual dismiss needed.
    toast({
      title: `Submitting secondary: ${c.patientName}`,
      description: `Sending 837 to ${name}…`,
      duration: 30_000,
    });
    try {
      const result = await apiSubmitSecondary(c.mondayItemId);
      // Backend already wrote Claim ID/PCN/Sent Date/Status to Monday on
      // success. Refetch picks those up — no need to mutate locally.
      toast({
        title: `Secondary submitted: ${c.patientName}`,
        description:
          `837 sent to ${name}` +
          (result.claim_id ? ` · Claim ID ${result.claim_id}` : "") +
          (result.inline_277_status ? ` · 277: ${result.inline_277_status}` : ""),
        // Operators want to read the claim ID — 5s default is too short.
        duration: 12_000,
      });
      void refetchSecondary();
    } catch (e) {
      const status = e instanceof SubmitSecondaryError ? e.status : undefined;
      // 400s are operator-fixable (balance, missing IDs, etc.) — surface
      // the backend's exact detail so they can read which field is off.
      // 5xx is "the system didn't get a chance" — same surfacing.
      toast({
        title:
          status === 400
            ? `Submit blocked: ${c.patientName}`
            : `Couldn't submit: ${c.patientName}`,
        description: (e as Error).message,
        // Error details are long — give the operator time to read.
        duration: 15_000,
      });
    }
  }
  /**
   * Patient bucket — stage 1: Send Invoice. Secondary Status flips to
   * Outstanding so the row reads as "invoice sent, waiting on patient".
   * Direct Monday write; no backend hop since no cross-board state
   * changes (patient billing is closed-loop on the Secondary side
   * until they actually pay).
   */
  async function sendInvoice(c: SecClaim) {
    if (!c.mondayItemId) return;
    // Patient flow stage 1 — invoice sent. Row moves out of Send Invoice
    // group into Patient Responsibility Outstanding, status flips to
    // Outstanding so the two-stage body switches to the Mark Paid button.
    //
    // ALSO fire the Send Invoice trigger column (color_mm3x6qe6 → "Sent").
    // A Monday automation listens for that flip and texts the patient the
    // invoice link. The trigger is decoupled from the status / group move
    // so the SMS still fires even if a future caller wants to flip Send
    // Invoice without moving the row (e.g. a batch tool). Decoupled means
    // we await it separately and surface a distinct error if it fails —
    // the status write is the authoritative "we billed them" record; the
    // trigger is the side-effect.
    updateClaim(c.id, {
      status: "Sent to Patient",
      rawSecondaryStatus: "Outstanding",
    });
    try {
      await setSecondaryStatusAndMove(
        c.mondayItemId,
        "Outstanding",
        "group_mkwta260",  // Patient Responsibility Outstanding
      );
    } catch (e) {
      toast({ title: "Couldn't update Monday", description: (e as Error).message });
      return;
    }
    // Fire the SMS automation trigger. Failure here is reported but
    // doesn't roll back the status flip — the row still reads as
    // "patient billed" because that's the authoritative state on Monday.
    // The operator can manually flip Send Invoice → Done on Monday to
    // retry the SMS automation.
    try {
      await fireSendInvoiceTrigger(c.mondayItemId);
      toast({
        title: `Invoice sent: ${c.patientName}`,
        description: `Patient owes ${$(c.remaining)}. Status → Outstanding. SMS automation fired.`,
      });
    } catch (e) {
      toast({
        title: `Status saved but SMS trigger failed: ${c.patientName}`,
        description:
          `Status flipped to Outstanding on Monday, but the Send Invoice column couldn't be set to Done. ` +
          `Flip it manually to fire the SMS. Reason: ${(e as Error).message}`,
        duration: 12_000,
      });
    }
    void refetchSecondary();
  }

  /**
   * Outstanding Invoices — Send Follow-Up. Fires a second SMS using
   * the "Follow-up" label on the Send Invoice trigger column. Clears
   * the column first so Monday fires a fresh state-change event even
   * when the column was already "Sent". Does NOT touch Secondary
   * Status or the group — the row stays in Outstanding Invoices.
   */
  async function markQuestionAnswered(c: SecClaim) {
    if (!c.mondayItemId) return;
    // Optimistic local update so the row vanishes from the bucket
    // immediately; refetch reconciles state from Monday's truth.
    updateClaim(c.id, { patientQuestionAnswered: true });
    try {
      await fireQuestionAnswered(c.mondayItemId);
      toast({
        title: `Marked answered: ${c.patientName}`,
        description: `Question on Monday flagged as Answered. Question text stays on the row.`,
      });
    } catch (e) {
      // Roll back optimistic flip so the operator can retry
      updateClaim(c.id, { patientQuestionAnswered: false });
      toast({
        title: `Mark answered failed: ${c.patientName}`,
        description: (e as Error).message,
        duration: 8_000,
      });
    }
    void refetchSecondary();
  }

  async function sendFollowUp(c: SecClaim) {
    if (!c.mondayItemId) return;
    try {
      await fireSendFollowUpTrigger(c.mondayItemId);
      toast({
        title: `Follow-up sent: ${c.patientName}`,
        description: `SMS follow-up automation fired on Monday.`,
      });
    } catch (e) {
      toast({
        title: `Follow-up failed: ${c.patientName}`,
        description: `Couldn't fire the Follow-up trigger column. Reason: ${(e as Error).message}`,
        duration: 12_000,
      });
    }
    void refetchSecondary();
  }

  /**
   * Patient bucket — stage 2: Mark as Paid. Patient has paid; flip the
   * secondary's Monday status to Patient Paid. Doesn't fire the
   * Subscription Board "Secondary Claim Paid? = Fully Paid" write —
   * that's reserved for the ERA-driven mark-paid flow on the Secondary
   * Mark Paid endpoint. Patient-side payment is recorded but the
   * subscription propagation stays a separate decision.
   */
  async function markPatientPaid(c: SecClaim) {
    if (!c.mondayItemId) return;
    // Patient flow stage 2 — patient paid. Move to Paid And Closed.
    updateClaim(c.id, { status: "Patient Paid" });
    try {
      await setSecondaryStatusAndMove(
        c.mondayItemId,
        "Patient Paid",
        "group_mkxsng4r",  // Paid And Closed
      );
      toast({ title: `Marked paid: ${c.patientName}` });
      void refetchSecondary();
    } catch (e) {
      toast({ title: "Couldn't update Monday", description: (e as Error).message });
    }
  }
  /**
   * Operator approves the secondary ERA and posts it. This is the
   * mandatory review step before a row leaves the active queue. Writes
   * to Monday in one call:
   *   - Secondary Status -> "Paid" (replaces "Review" set on ERA arrival)
   *   - Group move:
   *       CHK payment method -> group_mm3qkck6 "Paid but need to EFT"
   *       (operator still needs to enroll the payer for EFT)
   *       Anything else      -> group_mkxsng4r "Paid And Closed"
   *
   * Optimistic local flip + refetch on success so the bucket transition
   * is instant. If the Monday write fails, the optimistic flip rolls
   * back via the next refetch (Monday is the source of truth).
   */
  async function markPosted(c: SecClaim) {
    if (!c.mondayItemId) return;
    const method = (c.bankPaymentMethod || "").trim().toUpperCase();
    const isCheck = method === "CHK";
    const groupId = isCheck ? "group_mm3qkck6" : "group_mkxsng4r";
    updateClaim(c.id, { status: "Secondary Paid" });
    try {
      await setSecondaryStatusAndMove(c.mondayItemId, "Paid", groupId);
      toast({
        title: `Posted: ${c.patientName}`,
        description: isCheck
          ? "Moved to Paid but need to EFT — enroll payer for EFT next."
          : "Moved to Paid And Closed.",
      });
      void refetchSecondary();
    } catch (e) {
      toast({
        title: "Couldn't post on Monday",
        description: (e as Error).message,
      });
    }
  }

  /**
   * Confirm Payor — operator picks the final destination (Insurance,
   * Patient, or Waived) for a freshly-spawned secondary. Writes
   * Submission Type + Payor Confirmed = Yes on Monday in one batch.
   * Row falls out of the Confirm bucket on the next refetch.
   *
   * Waived path: operator decided not to collect (write-off, courtesy
   * waiver). Backend stamps Secondary Status=Paid + Secondary Paid=0
   * and moves the row to Paid And Closed in one step.
   */
  async function confirmPayor(
    c: SecClaim,
    dest: "Insurance" | "Patient" | "Waived",
  ) {
    if (!c.mondayItemId) {
      toast({ title: "No Monday item id", description: c.patientName });
      return;
    }
    // Optimistic flip so the row drops out of the Confirm bucket instantly.
    updateClaim(c.id, {
      payorConfirmed: true,
      status:
        dest === "Insurance" ? "Primary Paid - Submit Secondary" :
        dest === "Waived"    ? "Secondary Paid" :
                                "Sent to Patient",
    });
    try {
      await confirmSecondaryPayor(c.mondayItemId, dest);
      const description =
        dest === "Insurance" ? `${c.patientName} → Submit to Insurance.` :
        dest === "Waived"    ? `${c.patientName} → Payment waived, row closed.` :
                                `${c.patientName} → Patient bucket.`;
      toast({
        title: `Confirmed: ${dest}`,
        description,
      });
      void refetchSecondary();
    } catch (e) {
      toast({
        title: "Couldn't confirm",
        description: (e as Error).message,
      });
    }
  }

  const gridCols =
    buckets.length >= 4 ? "md:grid-cols-4" :
    buckets.length === 3 ? "md:grid-cols-3" :
    "md:grid-cols-2";

  return (
    <div className="space-y-4">
      {/* Buckets */}
      <section className={cn("grid grid-cols-1 gap-3", gridCols)}>
        {buckets.map((k) => (
          <button
            key={k}
            onClick={() => setBucket(k)}
            className={cn(
              "rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent",
              bucket === k && "ring-2 ring-primary",
            )}
          >
            <div className={cn("flex items-center gap-2 text-xs uppercase tracking-wide", BUCKET_META[k].tone)}>
              {BUCKET_META[k].icon}
              {BUCKET_META[k].label}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-2xl font-semibold">{counts[k]}</span>
              {/* Awaiting Acceptance — surface trouble so the operator
                  notices it on the tile, same pattern as PrimarySubmitBoard.
                  red = payer rejected, amber = Stedi-Accepted ≥48h stale. */}
              {k === "awaiting" && awaitingPayerRejectedCount > 0 && (
                <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                  {awaitingPayerRejectedCount} payer rejected
                </span>
              )}
              {k === "awaiting" && awaitingStaleCount > 0 && (
                <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning-soft-foreground">
                  {awaitingStaleCount} stale 48h+
                </span>
              )}
            </div>
          </button>
        ))}
      </section>

      {/* Filters */}
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Patient, payer, claim ID"
            className="h-9 w-64 pl-8"
          />
        </div>
        <Select value={payerFilter} onValueChange={setPayerFilter}>
          <SelectTrigger className="h-9 w-48"><SelectValue placeholder="All payers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payers</SelectItem>
            {allPayers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="h-9 w-44">
            <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dos">Sort by DOS</SelectItem>
            <SelectItem value="patient">Sort by Patient</SelectItem>
            <SelectItem value="payer">Sort by Secondary Payer</SelectItem>
            {/* Patient-owes sorts — only meaningful in Confirm Payor where
                they help triage: high-PR rows usually want a secondary-
                payer call, near-zero PR rows can often go straight to
                Patient. Sorts by the row's total remaining (coinsurance
                + deductible) so it matches whichever dollar figure the
                row card shows, regardless of breakdown label. */}
            {bucket === "confirm" && (
              <>
                <SelectItem value="prHigh">Sort by Patient Owes (high → low)</SelectItem>
                <SelectItem value="prLow">Sort by Patient Owes (low → high)</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {liveAvailable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => void refetchSecondary()}
              disabled={secondaryLoading}
            >
              {secondaryLoading ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Refreshing
                </>
              ) : (
                "Refresh"
              )}
            </Button>
          )}
          <span>
            Showing {visible.length} of {counts[bucket]}{" "}
            {BUCKET_META[bucket].label.toLowerCase()}
          </span>
        </div>
      </Card>

      {/* Rows */}
      <section className="space-y-3">
        {visible.length === 0 ? (
          <Card className="px-6 py-16 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-success-soft text-success-soft-foreground">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-base font-medium">Nothing in this bucket.</p>
            <p className="text-sm text-muted-foreground">All caught up.</p>
          </Card>
        ) : bucket === "patientQuestions" ? (
          <PatientQuestionsList rows={visible} onMarkAnswered={(c) => void markQuestionAnswered(c)} />
        ) : bucket === "eraReview" || bucket === "outstandingClaims" || bucket === "paid" ? (
          // ERA Review + Outstanding Claims + Paid all render as a
          // primary-style table. ERA Review (showActions=true): Status
          // dropdown + Submit button. Outstanding Claims + Paid
          // (showActions=false): identical column layout but read-only.
          // Paid still shows the full ERA Review detail body (incl.
          // Bank Info strip) on row expand.
          //
          // Insurance, Patient, Outstanding Invoices, and Invoice
          // Review buckets fall through to the SecondaryRow card
          // layout below because their workflows need patient-side
          // controls (Preview Link, Send Invoice, Mark Paid).
          <SecondaryClaimsTable
            rows={visible}
            expanded={expanded}
            onToggle={(id) =>
              setExpanded((p) => ({ ...p, [id]: !p[id] }))
            }
            onMarkPosted={(c) => markPosted(c)}
            showActions={bucket === "eraReview"}
          />
        ) : (
          visible.map((c) => (
            <SecondaryRow
              key={c.id}
              c={c}
              expanded={!!expanded[c.id]}
              onToggle={() => setExpanded((p) => ({ ...p, [c.id]: !p[c.id] }))}
              onUpdate={(patch) => updateClaim(c.id, patch)}
              onSubmitSecondary={(manual) => submitSecondary(c, manual)}
              onGenerateStatement={() => void sendInvoice(c)}
              onSendFollowUp={() => sendFollowUp(c)}
              onMarkPatientPaid={() => void markPatientPaid(c)}
              onMarkPosted={() => markPosted(c)}
              onConfirmPayor={(dest) => void confirmPayor(c, dest)}
            />
          ))
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

function SecondaryRow({
  c, expanded, onToggle, onUpdate,
  onSubmitSecondary, onGenerateStatement, onSendFollowUp, onMarkPatientPaid, onMarkPosted,
  onConfirmPayor,
}: {
  c: SecClaim;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (p: Partial<SecClaim>) => void;
  onSubmitSecondary: (manual?: boolean) => void;
  onGenerateStatement: () => void;
  onSendFollowUp: () => Promise<void>;
  onMarkPatientPaid: () => void;
  onMarkPosted: () => void;
  onConfirmPayor: (dest: "Insurance" | "Patient" | "Waived") => void;
}) {
  const b = bucketOf(c);

  const accent =
    b === "outstandingClaims" || b === "outstandingInvoices"
                            ? "border-l-info" :
    b === "insurance"       ? "border-l-warning-soft-foreground" :
    b === "eraReview" || b === "invoiceReview"
                            ? "border-l-info" :
                              "border-l-primary";

  const totalCoins = c.lines.reduce((s, l) => s + (l.coinsuranceCopay ?? 0), 0);
  const totalDed = c.lines.reduce((s, l) => s + (l.deductible ?? 0), 0) + (c.claimLevelDeductible ?? 0);
  const hasBreakdown = totalCoins > 0 || totalDed > 0;

  return (
    <Card className={cn("overflow-hidden border-l-4", accent)}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.patientName}</span>
            <span className="text-xs text-muted-foreground">
              {c.primaryPayor}
              {c.secondaryPayer && (
                <> {" → "}
                  <span className={cn(c.secondaryPayer === OTHER_PAYER && "italic")}>
                    {displaySecondary(c)}
                  </span>
                </>
              )}
            </span>
            <span className="text-xs text-muted-foreground">· DOS {fmt(c.dos)}</span>
            {/* 277 lifecycle pill — only on Awaiting Acceptance rows.
                Mirrors the per-row badge on PrimarySubmitBoard so the
                operator can see Stedi-Accepted vs Payer-Rejected vs
                still-no-277 at a glance without expanding. */}
            {b === "awaiting" && <Row277Badge status={c.status277 ?? null} />}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Primary paid: <span className="tabular-nums text-foreground">{$(c.primaryPaid)}</span>
            {hasBreakdown ? (
              <>
                {totalCoins > 0 && <>{"  ·  "}Coinsurance: <span className="tabular-nums text-foreground">{$(totalCoins)}</span></>}
                {totalDed > 0 && <>{"  ·  "}Deductible: <span className="tabular-nums text-foreground">{$(totalDed)}</span></>}
              </>
            ) : c.remaining > 0 ? (
              <>{"  ·  "}Remaining: <span className="tabular-nums text-foreground">{$(c.remaining)}</span></>
            ) : (
              <>{"  ·  "}No remaining balance</>
            )}
          </div>
        </div>
        {/* On Awaiting Acceptance rows the 277 badge is the lifecycle
            indicator — the generic "Secondary Submitted" status pill
            would be redundant + visually competing. On every other
            bucket keep the existing StatusPill. */}
        {b === "awaiting" ? null : <StatusPill status={c.status} bucket={b} />}
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-4">
          {b === "confirm" && (
            <ConfirmPayorBody c={c} onConfirm={onConfirmPayor} />
          )}
          {b === "insurance" && (
            <SubmitSecondaryBody c={c} onUpdate={onUpdate} onSubmit={onSubmitSecondary} />
          )}
          {/* SendToPatientBody serves THREE buckets — the body itself
              switches between Stage 1 (Send Invoice) and Stage 2
              (Mark Paid) based on rawSecondaryStatus, and Preview
              Link is always visible. So patient (stage 1) AND
              outstandingInvoices (stage 2) AND invoiceReview (after
              Mark Paid was clicked) all render this same component:
                patient              -> Preview Link + Send Invoice
                outstandingInvoices  -> Preview Link + Mark Paid
                invoiceReview        -> Preview Link + Mark Paid (read-only-ish,
                                        operator verifies and can re-fire payment
                                        flow if needed) */}
          {(b === "patient" || b === "outstandingInvoices" || b === "invoiceReview") && (
            <SendToPatientBody
              c={c}
              onUpdate={onUpdate}
              onGenerate={onGenerateStatement}
              onSendFollowUp={onSendFollowUp}
              onMarkPaid={onMarkPatientPaid}
              bucket={b}
            />
          )}
          {b === "awaiting" && (
            <AwaitingAcceptanceBody c={c} />
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * 277 lifecycle badge — exact visual + label vocabulary as
 * PrimarySubmitBoard.Status277Badge so the two boards stay coherent.
 * Display priority:
 *   1. Status277 from the 277 acknowledgment.
 *   2. "Submitted" — 837 went out, no 277 back yet.
 * Payer Accepted graduates out of the Awaiting bucket before render; it
 * stays in the switch for type-union completeness.
 */
function Row277Badge({ status }: { status: import("@/lib/claims/types").Status277 }) {
  const { label, classes } =
    status === "Payer Accepted"  ? { label: "Payer Accepted",   classes: "bg-emerald-100 text-emerald-800 border-emerald-200" }
    : status === "Stedi Accepted"  ? { label: "Stedi Accepted",   classes: "bg-amber-100 text-amber-800 border-amber-200" }
    : status === "Payer Rejected"  ? { label: "Payer Rejected",   classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : status === "Stedi Rejected"  ? { label: "Stedi Rejected",   classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : { label: "Submitted", classes: "bg-sky-100 text-sky-800 border-sky-200" };
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center justify-center rounded-md border px-2 text-xs font-medium",
        classes,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Expanded body for Awaiting Acceptance rows. Read-only — surfaces the
 * 277 status, rejection reason (if any), and key submission timestamps
 * so the operator can decide whether to resubmit or just keep waiting.
 *
 * No action buttons here on purpose: rejected rows route through the
 * regular Resubmit flow on the primary board (the operator spawns a
 * corrected secondary from the parent), and stale-Stedi-Accepted rows
 * just need patience.
 */
function AwaitingAcceptanceBody({ c }: { c: SecClaim }) {
  const status = c.status277 ?? null;
  const isRejected = status === "Stedi Rejected" || status === "Payer Rejected";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground">277 status:</span>
        <Row277Badge status={status} />
        {c.primarySentDate && (
          <span className="text-muted-foreground">
            · Submitted: <span className="text-foreground tabular-nums">{fmt(c.primarySentDate)}</span>
          </span>
        )}
        {c.payorId && (
          <span className="text-muted-foreground">
            · Trading partner: <span className="text-foreground tabular-nums">{c.payorId}</span>
          </span>
        )}
      </div>
      {isRejected && c.rejectionReason277 && (
        <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <div className="font-medium text-destructive">Rejection reason</div>
          <div className="mt-1 whitespace-pre-wrap text-foreground">
            {c.rejectionReason277}
          </div>
        </div>
      )}
      {!status && (
        <p className="text-xs text-muted-foreground">
          837 sent to Stedi. Waiting on the first 277 acknowledgement —
          typically lands within minutes for Stedi-Accepted, longer for the
          payer-side response. Row will graduate to Outstanding once the
          payer accepts.
        </p>
      )}
      {status === "Stedi Accepted" && (
        <p className="text-xs text-muted-foreground">
          Stedi accepted the claim and forwarded it to the payer. Waiting on
          the payer's 277. Stale rows ({"≥"}48h since submission) get a yellow
          pill on the tile so they don't get forgotten.
        </p>
      )}
    </div>
  );
}

function StatusPill({ status, bucket }: { status: SecondaryStatus; bucket: AnyBucket | null }) {
  // In the Submit > Patient bucket, Monday's Secondary Status is
  // misleading: Josh's coins-form-payment webhook writes "Sent to
  // Patient" the moment a pay link is generated — well before the
  // operator clicks our Send Invoice button. The row is still in
  // Stage 1 (review-before-send), so showing "Sent to Patient" on
  // the pill contradicts the bucket label. Override the display
  // here. The bucket filter already uses our authoritative
  // sendInvoiceTriggered flag to decide patient vs outstandingInvoices
  // (see bucketOf), so when bucket === "patient" we KNOW the
  // operator hasn't actually sent yet.
  const displayStatus =
    bucket === "patient" && status === "Sent to Patient"
      ? "Needs Invoice"
      : status === "Primary Paid - Forwarded"
        ? "Awaiting Crossover ERA"
        : status;

  const tone: "info" | "warning" | "success" | "neutral" | "danger" =
    status === "Secondary Paid" || status === "Patient Paid" ? "success" :
    status === "Secondary ERA Received" ? "info" :
    status === "Primary Paid - Forwarded" ? "info" :
    status === "Bad Debt" ? "neutral" :
    bucket === "patient" && status === "Sent to Patient" ? "info" :
    status === "Sent to Patient" ? "warning" :
    "warning";
  return (
    <StatusBadge tone={tone} className={cn(bucket === "outstandingClaims" && "animate-pulse")}>

      {displayStatus}
    </StatusBadge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ERA Review table — mirrors the primary board's Review ERA table layout.
// Columns: Patient | DOS | Products | Primary Payor | Secondary Payor |
//          Paid | PR | Difference | Action
//
//   Paid       = what the secondary paid (sum of line-level secondary paid)
//   PR         = patient responsibility LEFT after the secondary
//   Difference = expected secondary pay - actual paid - patient remaining.
//                ~0 = clean; positive = secondary underpaid; negative = paid
//                more than we expected (rare, but possible when allowed > PR).
//
// Each row toggles to reveal the existing EraReviewBody for full detail.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User-controllable per-row state for the ERA Review table. Mirrors
 * primary's per-line LineUserStatus pattern but applies at the claim row.
 *   "Paid"        - operator confirmed this secondary ERA is fully posted
 *   "Outstanding" - operator left it pending (waiting on something / patient
 *                   move / etc). Default until they pick.
 */
type RowUserStatus = "Paid" | "Outstanding";

/**
 * Shared table layout for the Secondary Board. Two consumers today:
 *   - ERA Review bucket (showActions=true): Status dropdown + Submit
 *     button to write the chosen Monday Secondary Status.
 *   - Outstanding bucket (showActions=false): same columns, read-only,
 *     no Status/Action columns.
 */
function SecondaryClaimsTable({
  rows,
  expanded,
  onToggle,
  onMarkPosted,
  showActions,
}: {
  rows: SecClaim[];
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onMarkPosted: (c: SecClaim) => void;
  showActions: boolean;
}) {
  const [rowStatus, setRowStatus] = useState<Record<string, RowUserStatus>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  function effectiveStatus(c: SecClaim): RowUserStatus {
    if (rowStatus[c.id]) return rowStatus[c.id]!;
    if (c.status === "Secondary Paid") return "Paid";
    // Pre-select "Paid" when the secondary fully covered the PR
    // (difference ≈ $0). Terry Bates / Karen Weinstock pattern —
    // crossover ERAs come in matching PR exactly and the operator
    // just needs to confirm; defaulting to Paid saves a click and
    // surfaces these rows as the ones ready to close out.
    const paid = c.secondaryPaid ?? 0;
    if (paid > 0 && paid >= c.remaining - 0.5) return "Paid";
    return "Outstanding";
  }

  /**
   * Submit the operator's chosen Status. The Paid path routes through
   * the backend coordinator (/claims/secondary/mark-paid) so the
   * Secondary Board update, primary lookup, and Subscription Board
   * propagation happen atomically. The Outstanding path is a simple
   * direct Monday write — no cross-board effects.
   */
  async function onSubmit(c: SecClaim) {
    const status = effectiveStatus(c);
    if (!c.mondayItemId) {
      toast({
        title: "Can't submit — no Monday item id",
        description: c.patientName,
      });
      return;
    }
    setSubmitting((p) => ({ ...p, [c.id]: true }));
    try {
      if (status === "Paid") {
        if (!isMarkSecondaryPaidConfigured()) {
          toast({
            title: "Secondary Mark Paid not wired",
            description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
          });
          return;
        }
        await apiMarkSecondaryPaid(c.mondayItemId);
        // Endpoint returns ~1-2s after the Secondary Status flip; the
        // cross-board Subscription sync runs as a Railway background
        // task. Operator gets immediate feedback; if the background
        // sync fails it logs as [SECONDARY-BG] in Railway, not in the UI.
        toast({
          title: `${c.patientName}: Paid`,
          description: "Secondary set to Paid. Subscription Board syncing in background.",
        });
        onMarkPosted(c);
      } else {
        // Outstanding — direct Monday write, no cross-board chain to update.
        await setSecondaryStatus(c.mondayItemId, status);
        toast({
          title: `${c.patientName}: ${status}`,
          description: "Secondary status updated on Monday.",
        });
      }
    } catch (e) {
      const msg = e instanceof MarkSecondaryPaidError ? e.message : (e as Error).message;
      toast({ title: "Couldn't update Monday", description: msg });
    } finally {
      setSubmitting((p) => ({ ...p, [c.id]: false }));
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>DOS</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Primary Payor</TableHead>
                <TableHead>Secondary Payor</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">PR</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                {showActions && (
                  <>
                    <TableHead className="w-[130px]">Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr>td]:align-top">
              {rows.map((c) => (
                <EraReviewTableRow
                  key={c.id}
                  c={c}
                  expanded={!!expanded[c.id]}
                  onToggle={() => onToggle(c.id)}
                  status={effectiveStatus(c)}
                  onStatusChange={(s) =>
                    setRowStatus((p) => ({ ...p, [c.id]: s }))
                  }
                  onSubmit={() => onSubmit(c)}
                  submitting={!!submitting[c.id]}
                  showActions={showActions}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function EraReviewTableRow({
  c,
  expanded,
  onToggle,
  status,
  onStatusChange,
  onSubmit,
  submitting,
  showActions,
}: {
  c: SecClaim;
  expanded: boolean;
  onToggle: () => void;
  status: RowUserStatus;
  onStatusChange: (s: RowUserStatus) => void;
  onSubmit: () => void;
  submitting: boolean;
  showActions: boolean;
}) {
  // PR column = patient responsibility the primary left = what we *expected*
  // the secondary to pay. For Karen: Medicare's $190.78 PR carries over to
  // AARP as the amount AARP needs to cover.
  const totalCoins = c.lines.reduce((s, l) => s + (l.coinsuranceCopay ?? 0), 0);
  const itemDed = c.lines.reduce((s, l) => s + (l.deductible ?? 0), 0);
  const claimDed = c.claimLevelDeductible ?? 0;
  const pr = totalCoins + itemDed + claimDed || c.remaining;

  // Has the secondary ERA arrived? Only ERA-received rows have a real
  // Paid amount; Outstanding/Forwarded rows are still waiting. For
  // pending rows we render "—" in Paid/Difference so it doesn't look
  // like the secondary paid $0.
  const eraReceived =
    c.status === "Secondary ERA Received" || c.status === "Secondary Paid";

  // Paid column = what the secondary actually paid.
  const secPaid =
    c.secondaryPaid ?? c.lines.reduce((s, l) => s + (l.secondaryPaid ?? 0), 0);

  // Difference = expected (PR) minus actual paid. Positive = secondary
  // underpaid, leftover rolls to patient. Zero = balanced. Negative = paid
  // more than expected (rare; happens when allowed > PR).
  const difference = pr - secPaid;
  // Only color the row by Difference once we actually have an ERA to
  // judge against. Pre-ERA rows render neutral.
  const balanced = eraReceived && Math.abs(difference) <= 0.5;

  // Forwarded crossover gets a pill — anyone who ended up in ERA Review from
  // the Forwarded path. Insurance-type ERAs (we sent a new 837) don't show
  // the pill — they didn't auto-crossover.
  const forwarded = !!c.forwardedFlag;

  // Display name for secondary payor — prefer the exact name from the 835
  // (e.g. "AARP SUPPLEMENTAL HEALTH PLANS FROM UNITEDHEALTHCARE") so the
  // operator sees the real payer instead of "Medicare Suppl." sentinel.
  const secondaryPayorDisplay =
    c.secondaryPayerRawName ||
    (c.secondaryPayer === OTHER_PAYER
      ? c.secondaryPayerOther?.trim() || "Custom payor"
      : c.secondaryPayer) ||
    "—";

  // Priority coloring. Pre-ERA rows stay neutral (we haven't heard back
  // yet — no judgment to render). ERA-received rows color by Difference.
  const cls = !eraReceived
    ? "row-priority-gray"
    : balanced
      ? "row-priority-green"
      : Math.abs(difference) > 50
        ? "row-priority-red"
        : "row-priority-yellow";

  const products = uniqueProducts(c.lines);

  return (
    <Fragment>
      <TableRow
        className={cn(cls, "hover:bg-muted/40 cursor-pointer")}
        onClick={onToggle}
      >
        <TableCell className="font-medium">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>{c.patientName}</span>
          </div>
          <div className="ml-5 text-xs text-muted-foreground leading-tight">
            <span className="font-bold select-none">ID: </span>
            <span className="[user-select:all]">{c.primaryMemberId || "—"}</span>
          </div>
        </TableCell>
        <TableCell className="text-sm">{c.dos ? fmt(c.dos) : "—"}</TableCell>
        <TableCell className="text-sm">
          <div className="flex flex-wrap gap-1">
            {products.map((p) => (
              <span
                key={p}
                className="inline-flex h-6 items-center rounded-md bg-muted px-1.5 text-xs font-medium whitespace-nowrap"
              >
                {p}
              </span>
            ))}
          </div>
        </TableCell>
        <TableCell className="text-sm">{c.primaryPayor || "—"}</TableCell>
        <TableCell className="text-sm max-w-[160px]">
          {/* AARP / UHC supplemental payer names regularly run 40-60 chars.
              Cap the column width so the rest of the row stays scannable;
              full name surfaces on hover. */}
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block truncate cursor-help">
                  {secondaryPayorDisplay}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                {secondaryPayorDisplay}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
        <TableCell
          className={cn(
            "text-right tabular-nums",
            !eraReceived && "text-muted-foreground",
          )}
        >
          {eraReceived ? $(secPaid) : "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <div className="flex flex-col items-end gap-1">
            <span>{$(pr)}</span>
            {forwarded && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex h-5 items-center rounded-md bg-blue-100 px-1.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 cursor-help">
                    Forwarded
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Primary auto-forwarded to secondary (Medicare crossover)
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>
        <TableCell
          className={cn(
            "text-right tabular-nums",
            !eraReceived
              ? "text-muted-foreground"
              : balanced
                ? "text-success-soft-foreground"
                : difference > 0
                  ? "text-warning-soft-foreground"
                  : "text-info-soft-foreground",
          )}
        >
          {eraReceived ? $(difference) : "—"}
        </TableCell>
        {showActions && (
          <>
            <TableCell>
              {/* Status dropdown — the operator picks Paid or Outstanding,
                  then clicks Submit to write that label to Monday's
                  Secondary Status column. */}
              <Select
                value={status}
                onValueChange={(v) => onStatusChange(v as RowUserStatus)}
              >
                <SelectTrigger
                  className={cn(
                    "h-8 w-[120px] font-medium",
                    status === "Paid" &&
                      "bg-success-soft text-success-soft-foreground border-success-soft",
                    status === "Outstanding" &&
                      "bg-muted text-foreground",
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Paid">Paid</SelectItem>
                  <SelectItem value="Outstanding">Outstanding</SelectItem>
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell className="text-right">
              <Button
                size="sm"
                disabled={submitting}
                onClick={(e) => {
                  e.stopPropagation();
                  onSubmit();
                }}
                className={cn(
                  status === "Paid"
                    ? "bg-emerald-700 text-white hover:bg-emerald-800"
                    : "",
                )}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    Submitting
                  </>
                ) : (
                  "Submit"
                )}
              </Button>
            </TableCell>
          </>
        )}
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell
            colSpan={showActions ? 10 : 8}
            className="p-4"
          >
            <EraReviewBody c={c} onMarkPosted={onSubmit} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

/** Distinct product labels across the claim's lines, preserving line order. */
function uniqueProducts(lines: SecLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.product && !out.includes(l.product)) out.push(l.product);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT TO SECONDARY body
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Payor body — first stop for any freshly-spawned non-Forwarded
// secondary. Operator reviews the primary ERA snapshot + patient's
// insurance info and decides whether to send the claim to the
// secondary insurance (Insurance bucket) or bill the patient (Patient
// bucket). Suggested destination is shown but the operator must
// explicitly click to commit.
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmPayorBody({
  c,
  onConfirm,
}: {
  c: SecClaim;
  onConfirm: (dest: "Insurance" | "Patient" | "Waived") => void;
}) {
  // Suggested destination — backend already classified at spawn. We use
  // c.secondaryPayer (the Monday status label set during spawn) to hint
  // the operator at the rules-based pick. They can override either way.
  //
  // Bill-the-Patient signals:
  //   - secondaryPayer === "Patient"  (operator already marked it)
  //   - secondaryPayer === "None"     (no secondary insurance on file —
  //                                    patient owes the balance directly)
  //   - secondaryPayer is null/blank  (nothing on file at all)
  //
  // Everything else (Medicare Suppl., a named insurance plan, etc.)
  // suggests Insurance because there's a real payer to bill first.
  // "Bad Debt" / "No Patient Responsibility" are technically also
  // non-insurance flags but the operator typically routes those to
  // Waive Payment rather than billing the patient; we keep them on
  // the Insurance side of the toggle for now so the operator has to
  // make the explicit Waive choice.
  const NO_SECONDARY_INSURANCE = new Set(["Patient", "None"]);
  const suggested: "Insurance" | "Patient" =
    c.secondaryPayer && !NO_SECONDARY_INSURANCE.has(c.secondaryPayer)
      ? "Insurance"
      : "Patient";

  const hasSecondaryId =
    !!c.secondaryMemberId && c.secondaryMemberId !== "—";

  return (
    <div className="space-y-4">
      {/* Primary ERA snapshot — what the primary actually paid + what
          they passed down as PR. This is the operator's source for
          deciding whether a real secondary insurance can pay. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MoneyCard label="Primary Paid" value={$(c.primaryPaid)} tone="success" sub={c.primaryPayDate ? `Paid ${fmt(c.primaryPayDate)}` : undefined} />
        <MoneyCard label="Patient Resp" value={$(c.remaining)} tone="primary" sub="Carried over from primary" />
        <Stat label="Primary Payor" value={c.primaryPayor || "—"} />
        <Stat label="DOS" value={c.dos ? fmt(c.dos) : "—"} />
      </div>

      {/* Insurance ID block — the call: does this patient have a real
          secondary insurance on file? If yes -> Insurance. If no (or
          if the on-file payer is "Patient" / "No Patient Responsibility")
          -> Patient. */}
      <div className="rounded-md border bg-background p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Insurance IDs on file
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Primary Member ID</div>
            <div className="font-mono text-sm">{c.primaryMemberId || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Secondary Member ID
              {!hasSecondaryId && (
                <span className="ml-2 inline-flex h-4 items-center rounded bg-muted px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  none
                </span>
              )}
            </div>
            <div className="font-mono text-sm">
              {hasSecondaryId ? c.secondaryMemberId : "Not on file"}
            </div>
          </div>
        </div>
        <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          Suggested:{" "}
          <span className="font-medium text-foreground">{suggested}</span>
          {suggested === "Insurance"
            ? ` (Secondary Payer on file: ${c.secondaryPayer ?? "—"})`
            : c.secondaryPayer === "None"
              ? ' (Secondary Payer = "None" — no insurance on file, bill the patient)'
              : " (no secondary insurance — patient owes the balance)"}
        </div>
      </div>

      {/* Three big buttons — operator picks one. Suggested gets the
          emerald default emphasis; the other two stay as outlines.
          Waive Payment is the operator-driven write-off path:
          terminal-zero, used when there's no secondary insurance AND
          we've decided not to bill the patient (courtesy waiver,
          small balance, etc). Confirms via a dialog because it's a
          destructive-ish action — sets Secondary Paid to $0 + closes
          the row. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Button
          size="lg"
          className={cn(
            suggested === "Insurance"
              ? "bg-emerald-700 text-white hover:bg-emerald-800"
              : "",
          )}
          variant={suggested === "Insurance" ? "default" : "outline"}
          onClick={() => onConfirm("Insurance")}
        >
          <Send className="mr-2 h-4 w-4" />
          Submit to Insurance
        </Button>
        <Button
          size="lg"
          className={cn(
            suggested === "Patient"
              ? "bg-emerald-700 text-white hover:bg-emerald-800"
              : "",
          )}
          variant={suggested === "Patient" ? "default" : "outline"}
          onClick={() => onConfirm("Patient")}
        >
          <UserRound className="mr-2 h-4 w-4" />
          Bill the Patient
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => {
            const remaining = $(c.remaining);
            if (
              confirm(
                `Waive ${remaining} for ${c.patientName}?\n\nThis closes the row at $0. ` +
                "Use this when you're not collecting the balance (write-off, courtesy waiver, etc).",
              )
            ) {
              onConfirm("Waived");
            }
          }}
        >
          <Ban className="mr-2 h-4 w-4" />
          Waive Payment
        </Button>
      </div>
    </div>
  );
}

function SubmitSecondaryBody({
  c, onUpdate, onSubmit,
}: {
  c: SecClaim;
  onUpdate: (p: Partial<SecClaim>) => void;
  // Accepts Promise<void> so we can await the round-trip and show a
  // spinner. Older call sites that pass a non-async fn still work — we
  // just resolve immediately in that case.
  onSubmit: (manual?: boolean) => Promise<void> | void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Pending = backend round-trip in flight. Disables the button +
  // swaps the icon for a spinner so the operator knows the click
  // registered (without this, the 3–8s Stedi round-trip looks like a
  // dead click).
  const [submitting, setSubmitting] = useState(false);
  const isOther = c.secondaryPayer === OTHER_PAYER;
  const otherName = c.secondaryPayerOther?.trim() ?? "";
  const otherInvalid = isOther && otherName.length === 0;

  // Totals — line-level breakdowns
  const sum = (fn: (l: SecLine) => number) => c.lines.reduce((s, l) => s + fn(l), 0);
  const totalCharge = sum((l) => l.charge);
  const totalPrimaryPaid = sum((l) => l.primaryPaid);
  const totalCoins = sum((l) => l.coinsuranceCopay ?? 0);
  const totalDed = sum((l) => l.deductible ?? 0) + (c.claimLevelDeductible ?? 0);
  const totalExpected = totalCoins + totalDed;
  const claimDed = c.claimLevelDeductible ?? 0;

  const handleSelect = (v: string) => {
    // Auto-fill PR Payor ID when the new Secondary Payor has a known
    // Stedi trading partner (e.g. NY Medicaid -> MCDNY). Skipped for
    // "Other" and for payors not in the map.
    const autoStediId = SECONDARY_PAYER_TO_STEDI_ID[v];
    if (v === OTHER_PAYER) {
      onUpdate({ secondaryPayer: OTHER_PAYER });
    } else if (autoStediId) {
      onUpdate({ secondaryPayer: v, secondaryPayerOther: null, payorId: autoStediId });
    } else {
      onUpdate({ secondaryPayer: v, secondaryPayerOther: null });
    }
    if (c.mondayItemId) {
      // For "Other" we leave Monday's status column empty — the
      // operator types the custom name into Secondary Payor Raw Name
      // (separate text column), which is what backend reads.
      const label = v === OTHER_PAYER ? null : v;
      setSecondaryPayer(c.mondayItemId, label).catch((e) => {
        toast({
          title: `Couldn\'t save Secondary Payor: ${c.patientName}`,
          description: (e as Error).message,
          duration: 8_000,
        });
      });
      if (autoStediId) {
        setSecondaryText(c.mondayItemId, SECONDARY_PARENT_COL.payor_id, autoStediId)
          .catch((e) => {
            toast({
              title: `Couldn\'t auto-save PR Payor ID: ${c.patientName}`,
              description: (e as Error).message,
              duration: 8_000,
            });
          });
      }
    }
  };

  const submitBtn = isOther ? (
    <div className="flex items-center gap-1 self-end">
      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={otherInvalid}
        className="bg-emerald-700 text-white hover:bg-emerald-800"
      >
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark as Submitted Manually →
      </Button>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Why manual?">
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            Custom secondaries aren't submitted through Stedi. Track them manually (paper, fax, payer portal).
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  ) : (
    <Button
      onClick={async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
          await onSubmit(false);
        } finally {
          setSubmitting(false);
        }
      }}
      disabled={submitting}
      className="self-end bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-80"
    >
      {submitting ? (
        <>
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Submitting…
        </>
      ) : (
        <>
          <Send className="mr-1 h-3.5 w-3.5" /> Submit Secondary
        </>
      )}
    </Button>
  );

  return (
    <div className="space-y-5">
      {/* Header form */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.1fr_0.85fr_0.85fr_0.85fr_0.6fr_0.85fr_0.65fr_0.6fr_auto]">
          <Field label="Name"><div className="text-sm font-semibold">{c.patientName}</div></Field>
          <Field label="Primary Payor">
            <div className="rounded bg-muted px-2 py-1 text-xs">{c.primaryPayor}</div>
          </Field>
          <Field label="Member ID (Pri.)">
            <div className="rounded bg-muted px-2 py-1 text-xs tabular-nums">{c.primaryMemberId}</div>
          </Field>
          <Field label="Secondary Payor">
            <Select value={c.secondaryPayer ?? ""} onValueChange={handleSelect}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {SECONDARY_PAYER_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
                <SelectItem value={OTHER_PAYER}>Other…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {/* PR Payor ID — Stedi trading partner ID we send the secondary
              837 to. Operator needs to set this before Submit Secondary
              works (backend's build_secondary_payload refuses an empty
              value). Saves directly to Monday on blur — no debounce because
              this is a short opaque code; risk of overlap is low. */}
          <Field label="PR Payor ID">
            <Input
              value={c.payorId ?? ""}
              placeholder="ZTXQE"
              onChange={(e) => onUpdate({ payorId: e.target.value })}
              onBlur={(e) => {
                if (!c.mondayItemId) return;
                const next = (e.target.value || "").trim();
                void setSecondaryText(
                  c.mondayItemId,
                  SECONDARY_PARENT_COL.payor_id,
                  next,
                );
              }}
              className="h-8 text-xs"
            />
          </Field>
          <Field label="Member ID (Sec.)">
            <Input value={c.secondaryMemberId} onChange={(e) => onUpdate({ secondaryMemberId: e.target.value })} className="h-8 text-xs" />
          </Field>
          <Field label="DOS">
            <Input value={fmt(c.dos)} readOnly className="h-8 text-xs" />
          </Field>
          <Field label="Dx">
            <Select value={c.diagnosis} onValueChange={(v) => onUpdate({ diagnosis: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIAGNOSIS_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {submitBtn}
        </div>

        {/* Animated free-text payor name when "Other" is selected */}
        <div
          className={cn(
            "grid overflow-hidden transition-all duration-200 ease-out",
            isOther ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0">
            <div className="rounded-md border border-dashed bg-background p-3">
              <Field
                label={
                  <>Secondary Payor Name <span className="text-destructive">*</span></>
                }
              >
                <Input
                  value={c.secondaryPayerOther ?? ""}
                  onChange={(e) => onUpdate({ secondaryPayerOther: e.target.value })}
                  placeholder="e.g. Cigna Supplement Plan F"
                  className={cn("h-8 text-xs", otherInvalid && "border-destructive")}
                  aria-invalid={otherInvalid}
                />
              </Field>
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                This payor isn't in our routing list. You'll submit it manually (paper, fax, payer portal).
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FROM THE PRIMARY ── */}
      <SectionDivider label="From the Primary" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat label="Primary Paid" value={$(c.primaryPaid)} />
        <Stat label="Primary Paid Date" value={fmt(c.primaryPayDate)} />
        <Stat
          label={
            <span className="inline-flex items-center gap-1">
              Primary ICN
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="hover:text-foreground" aria-label="What is ICN?">
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    Internal Control Number — the unique claim ID the primary payer assigned on its ERA.
                    Required when billing the secondary so they can link back to the primary's adjudication.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          }
          value={c.primaryIcn}
        />
      </div>

      {/* ── WHAT WE'RE BILLING THE SECONDARY ── */}
      <SectionDivider label="What We're Billing the Secondary" />

      <div className="rounded-lg border bg-background px-4 py-3">
        <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[2fr_1fr]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Total Expected from Secondary
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{$(totalExpected)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Sum of patient responsibility the primary left for {displaySecondary(c)}.
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x rounded-md border bg-muted/30">
            <div className="px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Coinsurance/Copay</div>
              <div className="text-sm font-semibold tabular-nums">{$(totalCoins)}</div>
            </div>
            <div className="px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Deductible</div>
              <div className="text-sm font-semibold tabular-nums">{$(totalDed)}</div>
              {claimDed > 0 && (
                <div className="text-[10px] text-muted-foreground">incl. {$(claimDed)} claim-level</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Subitems table — 7 columns */}
      <SubmitItemsTable c={c}
        totals={{ totalCharge, totalPrimaryPaid, totalCoins, totalDed, claimDed }} />

      {/* Manual submit confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as submitted manually?</DialogTitle>
            <DialogDescription>
              This claim has a custom secondary payor ({otherName || "unnamed"}). We can't submit
              through Stedi automatically. Confirm you've submitted it manually (paper, fax, payer
              portal) and we'll flag it as Submitted in the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-700 text-white hover:bg-emerald-800"
              onClick={() => { setConfirmOpen(false); onSubmit(true); }}
            >
              Yes, mark as submitted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubmitItemsTable({
  c,
  totals,
}: {
  c: SecClaim;
  totals: { totalCharge: number; totalPrimaryPaid: number; totalCoins: number; totalDed: number; claimDed: number };
}) {
  const cols = "grid-cols-[1.4fr_0.7fr_0.6fr_0.5fr_1fr_1fr_1fr_1fr]";
  const { totalCharge, totalPrimaryPaid, totalCoins, totalDed, claimDed } = totals;
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className={`grid ${cols} border-b bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
        <div>Subitem</div>
        <div>HCPC</div>
        <div>Mods</div>
        <div className="text-right">Qty</div>
        <div className="text-right">Charge</div>
        <div className="text-right">Primary Paid</div>
        <div className="text-right">Coinsur/Copay</div>
        <div className="text-right">Deductible</div>
      </div>
      {c.lines.map((l) => (
        <div key={l.id} className={`grid ${cols} border-b px-3 py-1.5 text-xs last:border-b-0`}>
          <div className="truncate">{l.product}</div>
          <div className="truncate">{l.hcpcs}</div>
          <div className="truncate">{l.modifiers.join(", ") || "—"}</div>
          <div className="text-right tabular-nums">1</div>
          <div className="text-right tabular-nums">{$(l.charge)}</div>
          <div className="text-right tabular-nums">{$(l.primaryPaid)}</div>
          <div className="text-right tabular-nums">{$(l.coinsuranceCopay ?? 0)}</div>
          <div className="text-right tabular-nums">{$(l.deductible ?? 0)}</div>
        </div>
      ))}
      {claimDed > 0 && (
        <div className={`grid ${cols} border-b bg-amber-50 px-3 py-1.5 text-xs italic text-muted-foreground dark:bg-amber-950/20`}>
          <div className="truncate">Claim-level deductible</div>
          <div>—</div><div>—</div>
          <div className="text-right">—</div>
          <div className="text-right">—</div>
          <div className="text-right">—</div>
          <div className="text-right">—</div>
          <div className="text-right font-medium tabular-nums text-foreground">{$(claimDed)}</div>
        </div>
      )}
      <div className={`grid ${cols} border-t-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold`}>
        <div>Total</div>
        <div /><div /><div />
        <div className="text-right tabular-nums">{$(totalCharge)}</div>
        <div className="text-right tabular-nums">{$(totalPrimaryPaid)}</div>
        <div className="text-right tabular-nums">{$(totalCoins)}</div>
        <div className="text-right tabular-nums">{$(totalDed)}</div>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEND TO PATIENT body
// ─────────────────────────────────────────────────────────────────────────────

const PR_REASONS: PrReason[] = ["Deductible", "Coinsurance", "Copay", "Non-covered service", "Bad debt (write off)"];

function SendToPatientBody({
  c, onGenerate, onSendFollowUp, onMarkPaid, bucket,
}: {
  c: SecClaim;
  onUpdate: (p: Partial<SecClaim>) => void;
  onGenerate: () => void;
  onSendFollowUp: () => Promise<void>;
  onMarkPaid: () => void;
  bucket: AnyBucket | null;
}) {
  const allowed = c.primaryPaid + c.remaining;
  const insurancePaid = c.primaryPaid;
  const youOwe = c.remaining;

  // Per-line ded / coins-copay (fall back to claim-level breakdown if missing)
  const lineDed = (l: SecLine) => l.deductible ?? 0;
  const lineCoins = (l: SecLine) => l.coinsuranceCopay ?? 0;
  const totalDed = c.lines.reduce((s, l) => s + lineDed(l), 0)
    || ((c.prBreakdown?.deductible) ?? 0);
  const totalCoins = c.lines.reduce((s, l) => s + lineCoins(l), 0)
    || (((c.prBreakdown?.coinsurance ?? 0) + (c.prBreakdown?.copay ?? 0)));

  return (
    <div className="space-y-3">
      {/* Compact header strip */}
      <div className="rounded-lg border bg-background px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{c.patientName}</div>
            <div className="text-[11px] text-muted-foreground">
              DOS {fmt(c.dos)} · {c.primaryPayor}{c.secondaryPayer ? ` → ${displaySecondary(c)}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span><span className="text-muted-foreground">Allowed </span><span className="font-medium tabular-nums">{$(allowed)}</span></span>
            <span className="text-muted-foreground">−</span>
            <span><span className="text-muted-foreground">Ins. paid </span><span className="font-medium tabular-nums text-emerald-700">{$(insurancePaid)}</span></span>
            <span className="text-muted-foreground">=</span>
            <div className="flex flex-col items-end leading-tight">
              <span><span className="text-muted-foreground">Patient owes </span><span className="text-base font-semibold tabular-nums text-primary">{$(youOwe)}</span></span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                Ded. {$(totalDed)} · Co-ins/Copay {$(totalCoins)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Items table — Ins. paid split into Deductible + Co-ins/Copay */}
      <div className="rounded-lg border bg-background">
        <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.8fr_0.9fr_0.8fr] gap-2 border-b bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Item</div>
          <div className="text-right">Allowed</div>
          <div className="text-right">Ins. paid</div>
          <div className="text-right">Deductible</div>
          <div className="text-right">Co-ins / Copay</div>
          <div className="text-right">Patient owes</div>
        </div>
        <div className="divide-y">
          {c.lines.map((l) => {
            const lineAllowed = l.primaryPaid + l.remaining;
            const owed = l.amountOwed ?? l.remaining;
            return (
              <div key={l.id} className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.8fr_0.9fr_0.8fr] gap-2 px-3 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.product}</div>
                  {l.reason && <div className="truncate text-[10px] text-muted-foreground">{l.reason}</div>}
                </div>
                <div className="text-right tabular-nums">{$(lineAllowed)}</div>
                <div className="text-right tabular-nums text-emerald-700">{$(l.primaryPaid)}</div>
                <div className="text-right tabular-nums">{$(lineDed(l))}</div>
                <div className="text-right tabular-nums">{$(lineCoins(l))}</div>
                <div className="text-right font-semibold tabular-nums text-primary">{$(owed)}</div>
              </div>
            );
          })}
          <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.8fr_0.9fr_0.8fr] gap-2 bg-muted/20 px-3 py-1.5 text-xs font-semibold">
            <div>Total</div>
            <div className="text-right tabular-nums">{$(allowed)}</div>
            <div className="text-right tabular-nums text-emerald-700">{$(insurancePaid)}</div>
            <div className="text-right tabular-nums">{$(totalDed)}</div>
            <div className="text-right tabular-nums">{$(totalCoins)}</div>
            <div className="text-right tabular-nums text-primary">{$(youOwe)}</div>
          </div>
        </div>
      </div>

      {/* Two-stage action — driven by the row's raw Monday Secondary
          Status. Submit -> still owe the patient an invoice (Preview
          + Send Invoice buttons). Anything else (Outstanding / Sent
          to Patient) -> we already billed, now waiting on payment
          (Preview + Mark Paid buttons).

          Preview Link sits in BOTH stages: before send, so the
          operator can sanity-check what the patient will get; after
          send, so they can resend the link out of band (read it back
          to the patient on the phone, paste in a follow-up email,
          etc.) without flipping any state. Default Button variant
          (app primary blue, matches the Uploaded Docs to Payer
          button on ClaimDetail). */}
      <div className="flex items-center justify-end gap-2">
        {/* Preview Link — always visible; disabled when no URL on the
            Monday row yet. */}
        <Button
          size="sm"
          disabled={!c.payLinkUrl}
          onClick={() => {
            if (!c.payLinkUrl) return;
            // noopener/noreferrer keeps the new tab from accessing
            // window.opener — standard for opening untrusted /
            // patient-facing URLs from an internal tool.
            window.open(c.payLinkUrl, "_blank", "noopener,noreferrer");
          }}
          title={
            c.payLinkUrl
              ? "Open the patient's invoice link in a new tab"
              : "No Pay Link URL on this row yet — populate the Monday column first."
          }
          className="h-8"
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" /> Preview Link
        </Button>

        {(c.rawSecondaryStatus ?? "Submit") === "Submit" ? (
          // Stage 1 — invoice not yet sent. Send Invoice flips
          // Secondary Status to Outstanding AND fires the SMS
          // automation trigger column (color_mm3x6qe6 → Done).
          <Button
            size="sm"
            onClick={onGenerate}
            className="h-8 bg-emerald-700 text-white hover:bg-emerald-800"
          >
            <FileText className="mr-1 h-3.5 w-3.5" /> Send Invoice
          </Button>
        ) : (
          // Stage 2 — invoice sent, awaiting payment.
          // Send Follow-Up only in Outstanding Invoices (the operator
          // shouldn't be sending a follow-up SMS to a row that's
          // already in Invoice Review with the patient having declared
          // paid). Clears color_mm3x6qe6 then writes "Follow-up" so
          // Monday fires a fresh automation event with different copy.
          <>
            {bucket === "outstandingInvoices" && (
              <SendFollowUpButton onClick={onSendFollowUp} disabled={!c.mondayItemId} />
            )}
            <Button
              size="sm"
              onClick={onMarkPaid}
              className="h-8 bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark Paid
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function MoneyCard({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: "success" | "primary" }) {
  const valueClass =
    tone === "success" ? "text-success-soft-foreground" :
    tone === "primary" ? "text-primary" :
    "text-foreground";
  return (
    <div className="rounded-lg border bg-background px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", valueClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORWARDED body
// ─────────────────────────────────────────────────────────────────────────────

function ForwardedBody({ c, onMarkPosted }: { c: SecClaim; onMarkPosted: () => void }) {
  const totalPaid = c.lines.reduce((s, l) => s + l.primaryPaid, 0);
  const itemDed = c.lines.reduce((s, l) => s + (l.deductible ?? 0), 0);
  const totalCoins = c.lines.reduce((s, l) => s + (l.coinsuranceCopay ?? 0), 0);
  const claimDed = c.claimLevelDeductible ?? 0;
  const totalDed = itemDed + claimDed;
  const totalPR = totalDed + totalCoins;

  const cols = "grid-cols-[1.4fr_0.7fr_1fr_1fr_1.1fr_1.1fr]";

  return (
    <div className="space-y-4">
      {/* Key facts */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_1fr_1fr]">
        <Stat label="Primary Paid" value={$(totalPaid)} />

        {/* Wider Secondary Amount card with sub-breakdown */}
        <div className="rounded border bg-background px-2 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Total Patient Responsibility
          </div>
          <div className="mt-1 grid grid-cols-3 divide-x">
            <div className="pr-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Deductible</div>
              <div className="text-xs font-semibold tabular-nums">{$(totalDed)}</div>
              {claimDed > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  incl. {$(claimDed)} claim-level
                </div>
              )}
            </div>
            <div className="px-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Coinsurance/Copay</div>
              <div className="text-xs font-semibold tabular-nums">{$(totalCoins)}</div>
            </div>
            <div className="pl-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="text-xs font-semibold tabular-nums">{$(totalPR)}</div>
            </div>
          </div>
        </div>

        <Stat label="Primary Sent" value={c.primarySentDate ? fmt(c.primarySentDate) : "—"} />
        <Stat label="Primary Paid Date" value={fmt(c.primaryPayDate)} />
      </div>

      {/* Forwarded confirmation */}
      <div className="flex items-center gap-2 rounded-md border bg-info-soft px-3 py-2 text-xs text-info-soft-foreground">
        <CheckCircle2 className="h-4 w-4" />
        <span>
          {c.forwardedFlag
            ? "Forwarded to secondary — confirmed via CARC 19 on primary ERA."
            : "Forwarded flag not yet confirmed on primary ERA."}
        </span>
      </div>

      {/* Items */}
      <div className="overflow-hidden rounded-md border bg-background">
        <div className={`grid ${cols} border-b bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
          <div>Subitem</div>
          <div>HCPC</div>
          <div className="text-right">Primary Paid</div>
          <div className="text-right">Deductible</div>
          <div className="text-right">Coinsurance/Copay</div>
          <div className="text-right">Total Patient Resp.</div>
        </div>
        {c.lines.map((l) => {
          const ded = l.deductible ?? 0;
          const coins = l.coinsuranceCopay ?? 0;
          return (
            <div key={l.id} className={`grid ${cols} border-b px-3 py-1.5 text-xs last:border-b-0`}>
              <div className="truncate">{l.product}</div>
              <div className="truncate">{l.hcpcs}</div>
              <div className="text-right tabular-nums">{$(l.primaryPaid)}</div>
              <div className="text-right tabular-nums">{$(ded)}</div>
              <div className="text-right tabular-nums">{$(coins)}</div>
              <div className="text-right tabular-nums">{$(ded + coins)}</div>
            </div>
          );
        })}
        {claimDed > 0 && (
          <div className={`grid ${cols} border-b bg-amber-50 px-3 py-1.5 text-xs italic text-muted-foreground dark:bg-amber-950/20`}>
            <div className="truncate">Claim-level deductible</div>
            <div className="truncate">—</div>
            <div className="text-right tabular-nums">—</div>
            <div className="text-right font-medium tabular-nums text-foreground">{$(claimDed)}</div>
            <div className="text-right tabular-nums">—</div>
            <div className="text-right font-medium tabular-nums text-foreground">{$(claimDed)}</div>
          </div>
        )}
        <div className={`grid ${cols} border-t-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold`}>
          <div>Total</div>
          <div />
          <div className="text-right tabular-nums">{$(totalPaid)}</div>
          <div className="text-right tabular-nums">{$(totalDed)}</div>
          <div className="text-right tabular-nums">{$(totalCoins)}</div>
          <div className="text-right tabular-nums">{$(totalPR)}</div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline">
          <ExternalLink className="mr-1 h-4 w-4" /> Open in Monday
        </Button>
        <Button onClick={onMarkPosted} className="bg-emerald-700 text-white hover:bg-emerald-800">
          <CheckCircle2 className="mr-1 h-4 w-4" /> Mark as Posted
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny shared
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ERA REVIEW body — secondary ERA has been received, ready to post
// ─────────────────────────────────────────────────────────────────────────────

function EraReviewBody({ c, onMarkPosted }: { c: SecClaim; onMarkPosted: () => void }) {
  void onMarkPosted; // Mark Paid lives on the table row now — keep the prop
                     // so the API stays compatible with the rest of the file.
  // Whether the secondary ERA has actually arrived. Outstanding rows (still
  // waiting on the crossover) shouldn't be styled as if the payer paid $0 —
  // line-level Status should render "Pending" in that case.
  const eraReceived =
    c.status === "Secondary ERA Received" || c.status === "Secondary Paid";
  const itemDed = c.lines.reduce((s, l) => s + (l.deductible ?? 0), 0);
  const totalCoins = c.lines.reduce((s, l) => s + (l.coinsuranceCopay ?? 0), 0);
  const claimDed = c.claimLevelDeductible ?? 0;
  const totalDed = itemDed + claimDed;
  const expected = totalDed + totalCoins;

  const totalPrimaryPaid = c.primaryPaid ||
    c.lines.reduce((s, l) => s + l.primaryPaid, 0);
  const totalSecPaid = c.secondaryPaid ??
    c.lines.reduce((s, l) => s + (l.secondaryPaid ?? 0), 0);
  // Total Expected = what the full allowed amount looked like across both
  // payers. Primary paid + secondary expected. For a clean Forwarded
  // crossover (Karen) this equals primary paid + primary PR = original
  // expected payment.
  const totalExpected = totalPrimaryPaid + expected;

  return (
    <div className="space-y-4">
      {/* Money summary — four boxes, payment dates embedded inline so the
          operator has everything in one place without a separate dates
          strip below the table. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryBox label="Total Expected" value={$(totalExpected)} />
        <SummaryBox
          label="Primary Paid"
          value={$(totalPrimaryPaid)}
          sub={c.primaryPayDate ? `Paid ${fmt(c.primaryPayDate)}` : undefined}
        />
        <SummaryBox label="Secondary Expected" value={$(expected)} />
        <SummaryBox
          label="Secondary Paid"
          value={$(totalSecPaid)}
          sub={
            c.secondaryEraDate
              ? `ERA ${fmt(c.secondaryEraDate)}${
                  c.secondaryPayDate ? ` · Paid ${fmt(c.secondaryPayDate)}` : ""
                }`
              : undefined
          }
          tone="success"
        />
      </div>

      {/* Bank Info strip — appears when the secondary 835 populated the
          BPR / TRN columns on Monday. Gives the operator the four pieces
          of info needed to Ctrl+F the deposit in Chase / TD without
          jumping back to Stedi. Mirrors the primary ClaimDetail strip.
          Surfaces the X12 TRN trace number rather than the BPR payer
          originator id — for PayPlus/ECHO-mediated payments the BPR
          originator is the underlying payer (e.g. AARP) while Chase
          shows the processor's ORIG ID; the TRN trace is the universal
          identifier that always appears in the bank's ACH addenda. */}
      {(c.bankDepositTotal != null ||
        c.bankPaymentMethod ||
        c.bankTraceNumber ||
        c.bankEftDate) && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Bank Info
              </div>
              <span className="text-[10px] text-muted-foreground/80">
                use these to search your bank for the deposit
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment Amount
                </div>
                <div className="mt-1 text-sm font-medium tabular-nums">
                  {c.bankDepositTotal != null
                    ? $(c.bankDepositTotal)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  EFT Date
                </div>
                <div className="mt-1 text-sm font-medium">
                  {c.bankEftDate ? fmt(c.bankEftDate) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Trace # (TRN)
                </div>
                <div className="mt-1 font-mono text-sm">
                  {c.bankTraceNumber || "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment Method
                </div>
                {/* Raw BPR method code + an interpretive pill (see
                    BankPaymentMethodBadge). CHK/FWT → "Enroll in EFT" so
                    the operator knows to chase EFT enrollment with the
                    payer; NON → "No Payment Received" since a NON BPR is
                    a zero-pay remit (typically a full denial / takeback). */}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{c.bankPaymentMethod || "—"}</span>
                  <BankPaymentMethodBadge method={c.bankPaymentMethod} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service Lines — mirrors primary detail's Service Lines table style,
          trimmed to the columns relevant for a secondary ERA review:
          Product | Patient Resp | Paid | Difference | Status. */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Patient Resp</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.lines.map((l) => {
                  // Patient Resp for the line = what the primary passed to
                  // the secondary on this line (PR breakdown + deductible).
                  const linePR =
                    (l.deductible ?? 0) + (l.coinsuranceCopay ?? 0);
                  // hasLineEra: line-level Secondary Paid data actually
                  // came through. undefined means the ERA was CLP-only
                  // (typical Medicare-supplement crossover) — we DON'T
                  // know what the secondary applied to this line, so
                  // showing "$0 / Denied" would be misleading.
                  const hasLineEra = l.secondaryPaid !== undefined;
                  const linePaid = l.secondaryPaid ?? 0;
                  const lineDiff = linePR - linePaid;
                  // No ERA yet → "Pending". CLP-only secondary ERA (no
                  // line-level breakdown) → "—". Otherwise classify as
                  // Paid / Partial / Denied.
                  const lineState:
                    | "Pending"
                    | "Paid"
                    | "Partial"
                    | "Denied"
                    | "—" =
                    !eraReceived
                      ? "Pending"
                      : !hasLineEra
                        ? "—"
                        : linePR <= 0.5
                          ? "Paid"
                          : linePaid <= 0.5
                            ? "Denied"
                            : Math.abs(lineDiff) <= 0.5
                              ? "Paid"
                              : "Partial";
                  return (
                    <TableRow key={l.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{l.product}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {$(linePR)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {eraReceived && hasLineEra ? $(linePaid) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          !eraReceived || !hasLineEra
                            ? "text-muted-foreground"
                            : Math.abs(lineDiff) <= 0.5
                              ? "text-muted-foreground"
                              : lineDiff > 0
                                ? "text-warning-soft-foreground"
                                : "text-info-soft-foreground",
                        )}
                      >
                        {eraReceived && hasLineEra ? $(lineDiff) : "—"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex h-7 w-full items-center justify-center rounded-md px-2 text-xs font-medium",
                            lineState === "Pending" &&
                              "bg-muted text-muted-foreground",
                            lineState === "—" &&
                              "bg-muted text-muted-foreground",
                            lineState === "Paid" &&
                              "bg-success-soft text-success-soft-foreground",
                            lineState === "Partial" &&
                              "bg-warning-soft text-warning-soft-foreground",
                            lineState === "Denied" &&
                              "bg-danger-soft text-danger-soft-foreground",
                          )}
                        >
                          {lineState}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {claimDed > 0 && (
                  <TableRow className="bg-amber-50 italic dark:bg-amber-950/20">
                    <TableCell className="text-muted-foreground">
                      Claim-level deductible
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {$(claimDed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      —
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      —
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
                <TableRow className="border-t-2 bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {$(expected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {$(totalSecPaid)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {$(expected - totalSecPaid)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

/** Compact stat box used by the ERA Review detail. */
function SummaryBox({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success";
}) {
  return (
    <div
      className={cn(
        "rounded border bg-background px-2.5 py-2",
        tone === "success" && "bg-success-soft",
      )}
    >
      <div
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
          tone === "success" && "text-success-soft-foreground",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums",
          tone === "success" && "text-success-soft-foreground",
        )}
      >
        {value}
      </div>
      {sub && (
        <div
          className={cn(
            "mt-0.5 text-[10px] text-muted-foreground",
            tone === "success" && "text-success-soft-foreground/80",
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="rounded border bg-background px-2 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function LineTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div
        className="grid border-b bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}
      >
        {headers.map((h) => <div key={h}>{h}</div>)}
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid items-center border-b px-3 py-1.5 text-xs last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}
        >
          {r.map((cell, j) => <div key={j} className="min-w-0 truncate">{cell}</div>)}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patient Questions list — additive bucket surfaced on the Review tab.
// Each row shows the patient's question text alongside enough context
// (claim id, payor, balance) for an operator to text/call back without
// opening the claim. No bucket routing — same claim still appears in
// its real bucket (eraReview, outstandingClaims, etc.).
// ─────────────────────────────────────────────────────────────────────────────
function PatientQuestionsList({ rows, onMarkAnswered }: { rows: SecClaim[]; onMarkAnswered: (c: SecClaim) => void }) {
  return (
    <div className="space-y-3">
      {rows.map((c) => (
        <Card key={c.id} className="p-4">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{c.patientName}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {c.id.slice(-8)}
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">
                  {c.secondaryPayer ?? c.primaryPayor}
                </span>
                {typeof c.patientResp === "number" && c.patientResp > 0 && (
                  <>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs font-medium tabular-nums">
                      ${c.patientResp.toFixed(2)} due
                    </span>
                  </>
                )}
              </div>
              <blockquote className="mt-2 border-l-2 border-warning-soft-foreground/30 bg-warning-soft/30 px-3 py-2 text-sm italic">
                {c.patientQuestion}
              </blockquote>
            </div>
            <div className="flex flex-col items-stretch gap-2 min-w-[140px]">
              <Button size="sm" variant="outline" asChild>
                <a href={`tel:${(c as unknown as { patientPhone?: string }).patientPhone ?? ""}`}>
                  Text / Call
                </a>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onMarkAnswered(c)} disabled={!c.mondayItemId}>
                Mark answered
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// SendFollowUpButton — local loading state so the operator gets
// immediate visual feedback on click (button disables, shows spinner +
// 'Sending…'), then briefly flashes a success state before returning
// to idle. The async Monday write can take 1-2s; without this it looks
// like the click did nothing.
function SendFollowUpButton({ onClick, disabled }: {
  onClick: () => Promise<void>;
  disabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  async function handleClick() {
    if (state !== "idle") return;
    setState("sending");
    try {
      await onClick();
      setState("sent");
      window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("idle");
    }
  }
  return (
    <Button
      size="sm"
      variant={state === "sent" ? "default" : "outline"}
      onClick={handleClick}
      disabled={disabled || state === "sending"}
      title={disabled
        ? "No Monday item id on this row — can\'t fire the follow-up."
        : "Resend the invoice SMS with follow-up copy (clears + sets Send Invoice → Follow-up)"}
      className={cn(
        "h-8 transition-colors",
        state === "sent" && "bg-emerald-600 text-white hover:bg-emerald-600",
      )}
    >
      {state === "sending" ? (
        <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Sending…</>
      ) : state === "sent" ? (
        <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Sent</>
      ) : (
        <><Send className="mr-1 h-3.5 w-3.5" /> Send Follow-Up</>
      )}
    </Button>
  );
}
