# Subscription Board Project — Handoff

Drop this file into your new Cowork project so Claude has everything it needs
to work on the Subscription Board flow on day one. It's a living index of
credentials, repos, board IDs, deploy targets, and the existing code that
already touches subscriptions.

> **Last verified:** 2026-05-29. If a board/repo/token changes, update the
> relevant section here and the file works for the next project too.

---

## Credentials

### Monday.com API token

```
<MONDAY_API_TOKEN — see Cowork project instructions or Render env>
```

Tied to Brandon's account, `tid=507301923`, `me:write` scope, US-East-1.
Used by every backend service in `stedi-monday-integration` and by Claude's
ad-hoc Monday queries. Curl it with:

```bash
curl -X POST https://api.monday.com/v2 \
  -H "Authorization: <token>" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { me { name } }"}'
```

### GitHub Personal Access Token

```
<GH_PAT — see Cowork project instructions / 1Password>
```

Confirmed working against **all four repos across both orgs** (`medically-modern`
and `medicallymodern1`) — read/write/clone/push. Earlier guidance about
needing separate tokens per org is outdated.

```bash
# Verify scope quickly
for repo in medically-modern/claims-ui-tool medicallymodern1/stedi-monday-integration medically-modern/reorder-patient-form medically-modern/automate-dvs; do
  curl -s -o /dev/null -w "$repo: %{http_code}\n" \
    -H "Authorization: Bearer <GH_PAT — see Cowork project instructions / 1Password>" \
    "https://api.github.com/repos/$repo"
done
# All should print 200
```

To clone or push, embed the token in the URL:

```bash
git clone https://<GH_PAT — see Cowork project instructions / 1Password>@github.com/medicallymodern1/stedi-monday-integration.git
```

### Stedi

Stedi credentials live in the backend's environment, not in this repo.
On Render, they're set on the `stedi-monday-integration` service as
`STEDI_API_KEY` + `STEDI_CLAIM_ENDPOINT`. If a new project needs to talk to
Stedi directly, fetch the key from the deployed service's env (or ask
Brandon).

### Other env values that the existing backend uses

From `stedi-monday-integration/main.py` docstring:

```
MONDAY_API_TOKEN              — see above
MONDAY_ORDER_BOARD_ID         — see board table below
MONDAY_CLAIMS_BOARD_ID
MONDAY_INTAKE_BOARD_ID
MONDAY_SUBSCRIPTION_BOARD_ID  — defaults to 18407459988
STEDI_API_KEY
STEDI_CLAIM_ENDPOINT
WEBHOOK_SECRET                — Monday webhook signing secret
PORT                          — default 5000 local
```

---

## Repositories

### 1. `medically-modern/claims-ui-tool` (frontend, React + Vite + TS)

The Claims Command Center UI. Built on Vite/React/TypeScript with shadcn/ui.
Deployed to **GitHub Pages** automatically on every push to `main`
(`.github/workflows/deploy.yml`).

- **Live:** https://medically-modern.github.io/claims-ui-tool/
- **Source of truth as of 2026-05-12** — was on Lovable before; do not edit
  there.
- Source paths to know:
  - `src/api/` — Monday GraphQL clients and per-feature wrappers
  - `src/lib/claims/` — pure logic (cashflow, bcbsSubmitGuard, threadStore, etc.)
  - `src/components/claims/` — UI components (PrimarySubmitBoard, SecondaryBoard,
    ActionItemsInbox, etc.)
  - `src/pages/Claims.tsx`, `src/pages/ClaimDetail.tsx` — the main views
  - `MONDAY_BOARD_SCHEMA.md` — full Claims Board column reference, **auto-generated**
    by `scripts/refresh-monday-schema.sh`. **Never hand-edit.** Re-run the script
    after any Monday column add/remove/rename.
- Build/typecheck commands:

  ```bash
  npm install
  npm run build        # Vite (Rollup) — stricter than tsc, catches import errors tsc misses
  npx tsc --noEmit     # type-only pass
  npx vitest run       # unit tests (e.g. bcbsSubmitGuard.test.ts)
  ```

### 2. `medicallymodern1/stedi-monday-integration` (backend, FastAPI + Python 3)

The webhook + service layer between Monday, Stedi, and the frontend RPC.
Hosted on **Render** (NOT Railway).

- Stack: FastAPI, requests, gspread, apscheduler. No DB — Monday is the
  state store.
- Entry: `main.py` (mounts routers from `routes/`).
- Layout:
  - `routes/` — FastAPI routers, one per webhook trigger
  - `services/` — business logic
  - `claim_assumptions.py` — payer rate schedule, modifier rules, HCPC maps
  - `EraParser.py` — X12 835 parser
- Run locally:

  ```bash
  pip install -r requirements.txt
  uvicorn main:app --reload --port 5000
  ```

- CORS allows `https://medically-modern.github.io` and `http://localhost:8080`,
  which is how the GH Pages frontend talks to it.
- **`requirements.txt` has no `playwright`** — anything browser-driven
  (DVS, web scraping) belongs in `automate-dvs`, not here.

### 3. `medically-modern/reorder-patient-form` (Josh's reorder flow)

The patient-facing reorder confirmation form. Sent to patients ~20 days
before their re-order is due.

- **Frontend** — vanilla HTML/CSS/JS (no build step):
  - `frontend/index.html`
  - `frontend/styles.css`
  - `frontend/app.js`
  - `frontend/oopEstimator.js`  ← out-of-pocket math, useful pattern for the
    subscription-side OOP work
- **Backend** — Node.js + Express (?), uses Redis + RingCentral + S3:
  - `backend/src/index.js` — server entry
  - `backend/src/monday.js` — Monday API client (Node)
  - `backend/src/queue.js` — Redis-backed job queue
  - `backend/src/redis.js`
  - `backend/src/cron.js` — schedules the 20-day-out send
  - `backend/src/auth.js` — JWT auth (token in the reorder link)
  - `backend/src/sms.js` — RingCentral integration
  - `backend/src/s3.js` — patient insurance card uploads
  - `backend/src/notify.js`
- **Backend `.env`** keys (from `backend/.env.example`):

  ```
  MONDAY_TOKEN
  REDIS_URL
  JWT_SECRET
  REORDER_URL                  — public link base (https://reorder.medicallymodern.com)
  RC_SERVER_URL                — RingCentral
  RC_CLIENT_ID
  RC_CLIENT_SECRET
  RC_JWT
  RC_FROM_NUMBER               — +13475037148
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION                   — us-east-1
  S3_BUCKET                    — mm-insurance-cards
  ADMIN_API_KEY
  PRODUCTION_SMS_ENABLED       — keep false unless texting for real
  PRODUCTION_MODE              — keep false in dev
  PORT                         — 3001
  ```

- Where it deploys: ask Josh — this repo isn't covered by either of the
  Render/Railway setups we own on the claims side. Look at hosting clues in
  `package.json` or `docs/` first.

### 4. `medically-modern/automate-dvs` (Josh's Playwright bot)

Headless ePACES driver for NY Medicaid DVS submission. Receives Monday
webhooks, drives ePACES with Playwright/Chromium, writes Review IDs back.

- Stack: FastAPI + Playwright + Chromium (in Docker)
- Deploys to **Railway** (`railway.toml` in repo root: Dockerfile builder,
  uvicorn start command, `/healthz` healthcheck)
- Entry: `app/webhook.py`
- Orchestrator: `app/engine.py`
- ePACES driver: `app/epaces_driver.py`
- Monday client: `app/monday_client.py`
- Reference docs already in the repo:
  - `EPACES_RECON.md` — full ePACES reverse-engineering notes (selectors,
    page transitions)
  - `MONDAY_BOARD_REFERENCE.md` — 200 column IDs for the Onboarding board
- Env (`.env.example`):

  ```
  MONDAY_API_TOKEN
  ONBOARDING_BOARD_ID           — 18406060017
  MONDAY_WEBHOOK_SECRET
  EPACES_USERNAME
  EPACES_PASSWORD
  EPACES_LOGIN_URL              — https://epaces.emedny.org/
  DATABASE_URL                  — Railway-provisioned Postgres (optional)
  DRY_RUN                       — true = fill+screenshot, false = real submit
  SENTRY_DSN, SLACK_WEBHOOK_URL — optional
  ```

- Single Railway service. No Postgres/Redis/Celery in the runtime path —
  Monday is the queue.

---

## Monday boards (the ones you'll touch)

| Purpose | Board ID | Env var | Notes |
|---|---|---|---|
| **Subscription Board** | `18407459988` | `MONDAY_SUBSCRIPTION_BOARD_ID` | This is the one your new project centers on |
| Claims Board | `18245429780` | `MONDAY_CLAIMS_BOARD_ID` | Primary claims; subitems = service lines |
| Claims Subitems Board | `18245429979` | (derived) | Per-line ERA, modifiers, paid amounts |
| Secondary Claims Board | `18413019028` | `MONDAY_SECONDARY_BOARD_ID` | COB / secondary submissions |
| Secondary Subitems Board | `18413019033` | (derived) | |
| New Order Board | (see env) | `MONDAY_ORDER_BOARD_ID` | Orders that spawn Claims Board rows |
| Intake Board | (see env) | `MONDAY_INTAKE_BOARD_ID` | Initial patient onboarding |
| Onboarding Board (DVS) | `18406060017` | `ONBOARDING_BOARD_ID` | What automate-dvs reads |

### Subscription Board — what exists today

The Subscription Board already has two backend features wired up:

#### Stedi eligibility check (`subscription_eligibility_*`)

Webhook trigger: flip **Run Check** column to **"Run"** → POST to
`/subscription-eligibility/trigger`.

- Route: `routes/subscription_eligibility_webhook.py`
- Service: `services/subscription_eligibility_service.py`
- Monday I/O: `services/subscription_eligibility_monday_service.py`

**Subscription Board column IDs (verified 2026-05-19):**

Input columns:
- `color_mm254qxj` — Primary Insurance (status; specific label e.g.
  "Fidelis Low-Cost")
- `text_mkvp6zfg` — Member ID 1
- `text_mkvdefh1` — DOB
- `color_mm2nnjam` — Run Check (trigger; label "Run", "Failed")
- `name` — Item name ("Firstname Lastname", split inside the service)

Output columns (written by the eligibility flow):
- `color_mm2nzm33` — Active (status: "Active" / "Inactive" / "Medicare Advantage")
- `text_mm3grb6t` — Plan Begin (text; was originally a date column, schema drift)
- `text_mm2phve4` — Stedi Member ID
- `dropdown_mm2nz3wd` — Payer Name
- `dropdown_mm2n7ps1` — Plan Name
- `text_mm3g32ja` — Deductible (text; was numeric, schema drift)
- `color_mm2pj23n` — Prior Auth Required ("Yes" / "No" / "Evaluate")
- `color_mm2p8v3m` — Insurance Change ("Yes" / "No")
- `dropdown_mm3gkcmc` — Facility Flags ("Hospice" / "Hospital/SNF" — 30-day recency)

**Gotcha:** `change_multiple_column_values` is atomic — one bad column ID
nukes the whole batch. The subscription eligibility flow had this exact
issue when two columns were silently retyped from date/numeric to text;
the old IDs poisoned every successful write. Always pair the multi-write
with a per-column fallback. See `feedback_monday_batch_writes.md` in
auto-memory for the canonical version of this lesson.

**Eligibility STC code:** Pure Medicaid 270 requests (payer_id `MCDNY`) must
carry `serviceTypeCodes: ["30"]`. STC `12` silently breaks every check on
those rows. See `feedback_medicaid_eligibility_stc.md`.

**AAA error handling:** transient AAA codes (41, 42, 79, 80, 97, T4, 58,
65–67, 71–74, 76, 77) bucket as "Failed Check" rather than "Inactive".
Codes 75/78 are real "not in plan" — leave those as Inactive. See
`subscription_eligibility_service.py::_is_coverage_unavailable` and
`feedback_aaa_classification.md`.

#### Financial estimate (`financial_estimate_*`)

Pure math for "Calculate Financials" trigger on a subscription row.
Returns per-fill sensors + supplies Revenue / Cost / GP.

- Route: `routes/financial_estimate_webhook.py`
- Service: `services/financial_estimate_service.py`
- Monday I/O: `services/financial_estimate_monday_service.py`
- Uses `claim_assumptions.PAYER_RATE_SCHEDULE` for unit rates and the same
  Medicaid-supplies-split logic the intake resolver uses.

#### Subscription paid sync (`subscription_claim_paid_service`)

Called from `/claims/mark-paid`, `/secondary/mark-paid`, and the ERA
webhook. Mirrors `effectivePr` from the frontend so primary-paid and
patient-responsibility totals on the Subscription row stay in sync.

---

## Subscription flow at a glance (existing)

```
Subscription Board row
  │
  ├─ operator hits Run Check = "Run"
  │     │
  │     └─▶ /subscription-eligibility/trigger
  │            │
  │            ├─ extract inputs (name, DOB, member ID, primary insurance)
  │            ├─ resolve Stedi payer ID via PAYER_ID_MAP
  │            ├─ build + POST 270 to Stedi
  │            ├─ parse 271 response
  │            └─ write back: Active, Plan, Deductible, PA req, facility flags
  │
  ├─ operator hits Calculate Financials
  │     └─▶ /financial-estimate/trigger
  │            └─ writes Sensors GP, Supplies GP, etc.
  │
  ├─ time passes; reorder window approaches
  │     └─▶ Josh's reorder-patient-form sends SMS 20 days out
  │
  └─ patient confirms → Order Board row created → /order/webhook
        └─ creates Claims Board parent + service-line subitems
        └─ (Medicare A&B + E0784 pump) creates 12 future-month rentals
```

The new project picks up wherever you want to extend / overhaul that flow.

---

## Auto-memory pointers (Brandon's per-session memory)

A few facts persist across Claude sessions. The ones most relevant to a
Subscription Board project:

- `claims_ui_source_of_truth` — claims-ui-tool repo is authoritative as of
  2026-05-12, deploys to GH Pages.
- `monday_schema_refresh` — run `scripts/refresh-monday-schema.sh` after
  any Monday board structure change. Never hand-edit `MONDAY_BOARD_SCHEMA.md`.
- `monday_batch_writes` — `change_multiple_column_values` is atomic; one
  bad column ID nukes the batch. Always pair with per-column fallback.
- `medicaid_eligibility_stc` — pure-Medicaid 270 needs STC `["30"]`, not
  `["12"]`.
- `emedny_cycle_math` — `cycle_end = next Wed ON OR AFTER (sent + 21d)`;
  Wed submissions stay in that cycle.
- `automate_dvs` — Josh's Playwright bot for ePACES DVS lives at
  `medically-modern/automate-dvs`, deploys to Railway.

You can drop these as `references` in the new project's auto-memory the
first time Claude needs them.

---

## Quick verification script

Drop this into the new project as `scripts/verify-access.sh` and run it
once you've cloned everything to confirm tokens still work:

```bash
#!/usr/bin/env bash
set -euo pipefail

MONDAY_TOKEN="<MONDAY_API_TOKEN — see Cowork project instructions or Render env>"
GH_TOKEN="<GH_PAT — see Cowork project instructions / 1Password>"

echo "== Monday =="
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { me { name email } boards(ids: [18407459988]) { name id } }"}' \
  | python3 -m json.tool

echo "== GitHub =="
for repo in \
  medically-modern/claims-ui-tool \
  medicallymodern1/stedi-monday-integration \
  medically-modern/reorder-patient-form \
  medically-modern/automate-dvs; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GH_TOKEN" \
    "https://api.github.com/repos/$repo")
  echo "$repo: $code"
done
```

Expected: Monday returns Brandon's name + Subscription Board name; all four
repos return `200`.
