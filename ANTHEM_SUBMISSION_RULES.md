# Anthem / BCBS Claim Submission Rules — Pre-Submit Validation Spec

**Purpose:** Codify the routing + payer-selection rules so we can pre-check a claim before submission and surface specific errors instead of letting them come back as 277 rejects or ERA denials. This doc is the reference for the future pre-submit guard in the Claims UI Tool.

---

## TL;DR — the routing decision

Three columns drive every BCBS claim: **Patient's home address state**, **Payer ID we submit to**, and **Place of Service**. The member's plan (the card they hold) only matters for AUTH, not for billing routing.

| Patient lives in | Payer ID to bill | Place of Service |
|------------------|------------------|------------------|
| **New York**     | **803** (Anthem BCBS NY / Empire) | **12 — Home** |
| **New Jersey**   | **11348** (Horizon BCBS NJ via CareCentrix) | **12 — Home** |
| Any other state  | **803** (Anthem BCBS NY / Empire) | **11 — Office** |

The address rule is the master switch. Member ID and home plan don't enter the routing decision — they only drive the AUTH workflow described below.

---

## The underlying concept — BlueCard / "host plan"

BCBS plans operate as a federation. A member's card is issued by their **home plan** (typically tied to their employer's state). When that member gets services in a different state, the claim goes through the local **host plan** — the BCBS plan that operates in the state where services are rendered.

For our patient population, "services rendered" = where the patient lives, because that's where we ship the supplies. So:

- **Patient lives in NY** → host plan is Empire BCBS NY (Anthem NY) → **submit to payer ID 803**, regardless of what the patient's card says.
- **Patient lives in NJ** → host plan is Horizon BCBS NJ → **submit to payer ID 11348** (we route through CareCentrix who handles NJ Horizon claims).
- **Patient lives elsewhere** → we still bill payer 803 (Anthem NY is our contracted Blues plan that handles the BlueCard inter-plan routing on our behalf), but POS flips to **11 (Office)** because we're outside Anthem NY's home market and they expect provider-office billing for those.

### Two separate questions: AUTH vs BILL

| Question | Driven by | Example |
|----------|-----------|---------|
| **Do I need an auth?** And from whom? | **Member's home plan** (their card's BCBS plan, the "originating" plan) | Member has a BCBS PA card → auth path goes through BCBS PA, even if the patient lives in NJ |
| **Where do I send the 837?** | **Patient's home address** (the local host plan) | Patient lives in NJ → bill goes to Horizon NJ (11348 via CareCentrix), even though their card says BCBS PA |

This separation matters because the auth requirement is set by the contract between the member and the plan that issued the card, but billing always lands with the local plan that has a network presence where the service happened.

---

## Auth rules (work in progress)

The auth path depends on the member ID prefix (which encodes the home plan). General guidance so far:

- **Anthem NY (member ID typical Anthem NY format):** largely no auth required for our HCPCS set.
- **BCBS PA, BCBS NJ Horizon (NJX prefix), other out-of-state plans:** check with the home plan first. If they require auth, secure it through them.
- **Auths from non-local plans should NOT go through CareCentrix**, even if CareCentrix is the billing route. CareCentrix manages auth only when the home plan IS Horizon NJ. Other out-of-state Blues plans get their own auth workflow direct with the member's home plan.

> **Concrete corrections from operations:**
>
> 1. *"Auth dept told me to go through CareCentrix but I'm getting an error that the service area isn't managed by CareCentrix"* — Yes, the auth dept's referral is wrong. The patient's home plan handles auth; CareCentrix is only the billing route when patient lives in NJ. Tell the home plan you'll be billing the local host plan (Empire NY in metro-NY, Horizon NJ in NJ).
>
> 2. *"Patient has BCBS PA, lives in NJ, do we bill Horizon BCBS NJ?"* — Yes. **Auth through BCBS PA, bill the claim to CareCentrix (Horizon NJ).** The home plan validates coverage; the host plan handles the money.

A full auth-by-prefix matrix is still being built. Operator should treat the auth step as a manual lookup against the member's home plan until that table is firm.

---

## Pre-submit validation — error scenarios the tool should catch

The Claims UI Tool should run these checks before allowing a Submit click on a BCBS / Anthem claim. Each failure surfaces an explicit error with the operator-facing fix.

### Routing checks (hard stops)

| Check | Error message | Fix |
|-------|---------------|-----|
| Patient address state can be parsed (NY / NJ / other) | "Can't determine patient state from address — please confirm the address on file" | Edit Patient Address field |
| Payer ID matches the patient's state | "Patient lives in NY but Payer ID is set to 11348. NY patients bill to Empire BCBS NY (803)." | Change Payer ID to 803 |
| POS matches the patient's state | "Patient lives in NY/NJ but POS is set to 11 (Office). NY/NJ patients bill at POS 12 (Home)." | Change POS to Home (12) |
| POS = 11 only when patient is NOT in NY or NJ | "Patient lives in NY/NJ — POS should be 12 (Home), not 11 (Office)." | Change POS to Home |

### Soft warnings (allow submit but flag for review)

| Check | Warning |
|-------|---------|
| Patient lives in NY but member ID looks like out-of-state BCBS (NJX, PA prefix, etc.) | "Heads up: out-of-state member ID. Confirm auth was obtained through the member's home plan (not Empire NY), then submit." |
| Patient lives in NJ but member ID looks like NY or out-of-state | "Heads up: out-of-state member ID. Confirm auth was obtained through the member's home plan (not CareCentrix), then submit." |
| Other state patient with no documented auth | "Out-of-state Blues — confirm whether the member's home plan required auth before submitting." |

### Pure address sanity (catches the obvious data bugs)

These caught the Kai Burridge case (stale Waltham MA address on a NY patient) and the Jerry Domanico POS=Office case.

| Check | Error |
|-------|-------|
| Subscription / Patient Demographics state ≠ Claims Board Patient Address state | "Address mismatch — Subscription says NY, Claims Board says MA. Pick one and update the other." |
| POS = 11 with a state that should be 12 (or vice versa) | (already covered above) |

---

## Reference: Payer IDs in play

| Payer ID | Plan name | Used for |
|----------|-----------|----------|
| **803**  | Anthem Blue Cross Blue Shield of New York / Empire BCBS | All BCBS claims where patient lives in NY, AND all BCBS claims where patient lives outside NY/NJ (Anthem handles BlueCard routing for those) |
| **11348** | Horizon Blue Cross and Blue Shield of New Jersey | Patient lives in NJ, regardless of their card's home plan. Submitted via CareCentrix. |

If we expand to more Blues plans (Tennessee, Florida, Wyoming etc. — already in `STEDI_TRADING_PARTNER_NAME_BY_PAYER_ID`), this matrix grows. For now: NY/NJ are the only branched cases; everything else funnels through 803 + POS 11.

---

## Modifiers by billing route

Modifiers are **route-specific**, not just code-specific. The same supply code carries *different* modifiers depending on which payer the claim goes to, so this must be set per billing route — never copied across from another claim. The billing route is itself determined by the address master switch (NY/other → 803, NJ → 11348).

| HCPCS (product) | **803** — Anthem NY / Empire (NY + out-of-state) | **11348** — Horizon NJ via CareCentrix |
|-----------------|--------------------------------------------------|----------------------------------------|
| **A4230** (Infusion Sets) | `KX` | `NU` + `SC` |
| **A4232** (Cartridges) | `KX` | `NU` + `SC` |
| **A4239** (CGM Sensors) | `KF` + `KX` + `CG` | `NU` |

`NU + SC` on the 11348 side is the set used once an auth is obtained from CareCentrix and the claim is submitted to them. `E0784` / `E2103` modifier conventions are not yet codified and are not policed by the guard.

**Operator-facing rule:** the supply-line modifiers must match the row's billing route. Two bugs this catches:

- **Esther Reich** — NJ resident correctly routed to **11348**, but the lines came over with `KX` instead of `NU + SC`.
- A line built with `NU + SC` while routing to **803** is equally wrong — Empire expects `KX` (and `KF + KX + CG` on A4239).

> **Now enforced (2026-06-09):** the pre-submit guard (`bcbsSubmitGuard.ts`, `EXPECTED_LINE_MODIFIERS_BY_PAYER`) raises a **soft warning** (`MODIFIER_MISMATCH`, "submit anyway?") when a supply line is missing the canonical modifiers for its billing route. It checks against the *required* payer for the patient's state, and only flags **missing** required modifiers (extras like ERA-derived codes don't trip it). `SC` was also missing from the modifier dropdown (`MODIFIER_OPTIONS` in `PrimarySubmitBoard.tsx`) and has been added so operators can actually select it.

---

## Open questions for the next iteration

1. **Auth-by-prefix table.** What's the canonical mapping from member-ID prefix → home plan → "is auth required for our HCPCS set"? Once we have that table, the soft warning becomes a hard check.
2. **POS edge cases.** Are there any in-NY/in-NJ scenarios where POS 11 IS correct? (e.g. patient picks up in-person at the office.) If yes, the tool should allow an explicit override with a note.
3. **Member ID format detection.** Need a confidence heuristic for "this ID looks like NJX-prefix Horizon" vs "this ID looks like out-of-state". Probably a regex per plan.
4. **What about Medicare Advantage Blues plans?** Some BCBS plans operate MA products with different routing. Out of scope today; flagged for future.

---

## Versioning

| Date | Author | Change |
|------|--------|--------|
| 2026-05-28 | Brandon (notes) + Claude (synthesis) | Initial draft from email exchange + routing rules |
| 2026-06-09 | Brandon + Claude | Added "Modifiers by billing route" — 11348/CareCentrix requires NU + SC on supply lines; added SC to the UI modifier dropdown |
| 2026-06-09 | Brandon + Claude | Completed the per-route modifier table (803 = KX / KX / KF+KX+CG; 11348 = NU+SC / NU+SC / NU) and wired the MODIFIER_MISMATCH soft warning into the pre-submit guard |
