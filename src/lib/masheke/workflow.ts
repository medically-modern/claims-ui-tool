// Medical Necessity workflow types

export interface Patient {
  id: string;
  name: string;

  // Demographics (read-only context)
  gender?: string;
  dob: string;
  phone?: string;
  address?: string;
  memberId1?: string;
  memberId2?: string;
  primaryInsurance?: string;
  serving?: string;
  referralType?: string;
  referralSource?: string;
  pumpType?: string;
  cgmType?: string;
  requestType?: string;

  // Coverage paths
  ipCoveragePath?: string;
  cgmCoveragePath?: string;

  // Doctor info
  doctorName?: string;
  doctorPhone?: string;
  doctorNpi?: string;
  clinicalsMethod?: string;
  doctorEmail?: string;
  doctorFax?: string;
  clinicName?: string;

  // Pipeline tracking
  masterStage?: string;
  subStage?: string;
  daysSinceIntake?: string;
  daysSinceStageStart?: string;
  dateOfIntake?: string;
  dateOfStageStart?: string;

  // Clinical eval checklist
  cgmScript?: string;
  hypoLanguage?: string;
  insulinLanguage?: string;
  ipScript?: string;
  diabetesEducation?: string;
  threeInjections?: string;
  cgmUse?: string;
  bloodSugarIssues?: string;
  lmn?: string;
  oowDate?: string;
  malfunction?: string;
  diagnosis?: string;

  // MRs / Clinicals
  mrsClinicals?: string;
  lastVisit?: string;
  mrExpiryDate?: string;
  medicalNecessity?: string;
  mnEvalNotes?: string;

  // MN Invalid Reasons (read as comma-separated text from Monday dropdowns)
  generalMnInvalidReasons?: string;
  cgmMnInvalidReasons?: string;
  ipMnInvalidReasons?: string;
  /** Doctor-facing rolled-up ask list (the consolidated dropdown that
   *  replaces the 3 raw reason dropdowns end-to-end). */
  mnRequestConsolidated?: string;
  requestSentAt?: string;

  // Script generation
  generateCgmScript?: string;
  generateIpScript?: string;

  // Confirm Receipt / Chase
  confirmChaseNotes?: string;
  confirmReceiptNotes?: string;
  /** Per-attempt confirm-receipt records. Each holds "Name — M/D/YY"
   *  for that attempt; written by the Confirm Receipt panel. */
  confirmAttempt1?: string;
  confirmAttempt2?: string;
  confirmAttempt3?: string;
  receiptConfirmedDate?: string;
  receiptConfirmedName?: string;
  /** Per-attempt chase-clinicals records — same format as the confirm
   *  attempts; written by the Chase Clinicals panel. */
  chaseAttempt1?: string;
  chaseAttempt2?: string;
  chaseAttempt3?: string;
  chaseRecipientName?: string;
  mnAttempts?: string;
  nextActionDate?: string;
  /** Escalation status — "Escalation Required" or "Done". */
  escalation?: string;

  // Advancers
  advancer2a?: string;
  advancer2b?: string;
  advancer2c?: string;
  advancer2d?: string;

  // Blocked
  blocked?: string;
  blockedDate?: string;

  // Follow Up
  followUp?: string;
  followUpDate?: string;

  // Notes
  // Profile Send Off Notes
  profileSendOffNotes?: string;
  notes: string;
  lastUpdated?: string;
}
