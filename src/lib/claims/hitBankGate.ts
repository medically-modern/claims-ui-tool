// Master switch for the "Hit Bank?" gate (Brandon, 2026-10-03).
//
// OFF (false) = work as usual: a paid claim counts as landed as soon as
// its ERA pay date passes, and Mark Paid / Mark Posted close rows straight
// into Paid And Closed. Hit Bank? is ignored and the "Paid, not in bank"
// Cash Flow tile is hidden.
//
// ON (true) = the gate: money only counts as landed once Hit Bank? = Yes;
// until then claims sit in "Paid, but NOT in Bank".
//
// Turn it on once Josh's QuickBooks job is filling Hit Bank? reliably.
// The backend has its own matching switch (Railway variable
// HIT_BANK_GATE_ENABLED) — flip both together.
export const HIT_BANK_GATE_ENABLED = false;
