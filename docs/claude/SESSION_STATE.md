# Claude Code - Project Session State

## Project Information
- Project: Enterprise POS (multi-tenant retail POS + online store), d:\Learning\pos
- Architecture: Laravel modular monolith — see CLAUDE.md, docs/ARCHITECTURE.md, docs/MODULE_STRUCTURE.md
- Frontend: React 19 + TypeScript + Tailwind 4 (admin + POS terminal `frontend/src`, storefront `frontend/src/storefront`)
- Backend: Laravel 13 / PHP 8.4 (`backend/`; PHP 8.4 at `/c/laragon/bin/php/php-8.4.16-nts-Win32-vs17-x64`)
- Database: PostgreSQL 18 on 127.0.0.1:5432, DBs `pos` / `pos_test`, role `pos_app`
- Last Updated: 2026-11-26 16:15 (Asia/Dhaka)

## Current Task
- Task: Close the FEATURE_GAP_AUDIT gaps phase by phase. Order: G1c → ST1 → BD1 → POS1 → **ST2** → R1 → BD2 → VAT/Mushak + accounting
- Status: POS1 is finished and pushed (branch `phase-8-ai`, HEAD 909458f). Waiting for the user's go on ST2
- Priority: HIGH

## Objective
Ship each roadmap phase complete:
- backend and frontend code
- tests: backend on PostgreSQL, vitest, mocked Playwright, and a full-stack Playwright test on a demo store
- docs and CHANGELOG updated

Checkpoint with the user after each phase. Commit and push only when the user says "yes" or "push".

## Completed Work
Each phase was committed and pushed on its own:
- ST1 2f7492a: bulk import, barcodes/labels, stocktakes, supplier money in the drawer
- BD1a 662ce6f: SMS gateway, phone OTP, phone-only checkout, order SMS
- BD1b 7752b4d: staff-entered/editable web orders, COD checks, blocked phones
- BD1c 89342d6: bKash/Nagad/Rocket Send Money, COD advance, pixels/CAPI
- POS1a e7844a1: till PIN, tills, manager PIN approval, price changes, till promotions
- POS1b 49ee931: store credit, gift cards / vouchers / credit notes
- POS1c 1a8e22b: exchanges at the till
- POS1d 909458f: ESC/POS printing (Web Serial/WebUSB), no-sale drawer, receipts by SMS/e-mail
  - Last full verification: backend 1994 (1 opt-in skip), vitest 3247, mocked Playwright 625, full-stack 65 — all green

## Currently In Progress
- Nothing is being edited. Untracked folders: `.claude/`, `.serena/` and `docs/claude/`.

## Pending Tasks
1. ST2, which needs the user's go. Start with a spec, then the agents, verification, docs, and a checkpoint.
2. Then:
   - R1: reports and reminders, WhatsApp / due (বাকি) reminders
   - BD2
   - VAT/Mushak and accounting
3. docs/USER_MANUAL.bn.md: write it only when the user asks. The pending items are in the claude-mem work_state list `pos-manual-pending`: G1b, ST1, BD1a/b/c and POS1a–d.
4. POS1d hardware check: test a real 58/80 mm printer, a Bangla raster print and the drawer kick on each printer model.
5. Open items, documented and not yet fixed:
   - Storefront sells open-price items at their catalog price.
   - The promotion report counts web orders only.
   - Cancelling a sale paid with a gift card voided in the meantime restores value onto the void card.
   - The payment-collections report excludes advances, payouts and gift card sales.
   - The register sessions export has no no-sale column.

## Important Files Changed
- Per phase: see `git log` and that phase's CHANGELOG.md section.
- Docs updated every phase:
  - docs/API_DOCUMENTATION.md
  - docs/DATABASE_DESIGN.md
  - docs/DEPLOYMENT_GUIDE.md
  - docs/MODULE_STRUCTURE.md
  - docs/FEATURE_GAP_AUDIT.md
- Specs, docs scripts and full-stack tests are backed up in `C:\Users\PC\.claude\projects\d--Learning-pos\lead-backup\`.

## Database Changes
- Laravel migrations live per module: `backend/app/Modules/<Module>/Infrastructure/Database/Migrations/`.
- Latest:
  - 2026_12_08_* (POS1b): store credit, gift cards
  - 2026_12_09_* (POS1c): exchanges, approval `return`
  - 2026_12_10_* (POS1d): drawer openings, receipt links / deliveries, SMS purpose `sale_receipt`
- Deploy: `php artisan migrate` and `php artisan pos:permissions:sync`.
- Executed: local test DBs only. No production DB.

## Important Decisions
- **Dependencies:** none added. The ESC/POS encoder, QR and Web Serial/WebUSB code are written in-house.
- **Tests:** backend tests run on PostgreSQL only, never SQLite.
- **Payment methods held as a balance:** `loyalty_points`, `store_credit`, `gift_card` and `exchange` are value, not money, and never go into the payments ledger.
- **Secrets:**
  - Gift card codes are stored as a hash plus last 4 and shown once.
  - Idempotency replay bodies are encrypted.
  - Phones and e-mails are stored and audited masked.
- **Manager PIN approvals:** `pos_approvals` rows are single-use and valid for 10 minutes. Actions are `price_override`, `discount`, `return` and `no_sale`.
- **Scope decisions:**
  - SMS uses a generic HTTP gateway.
  - Payment gateways and courier APIs come later.
  - No offline POS.
  - Retail only.

## Existing Functionality Protection
- Never read or print `backend/.env`. Never write the postgres password anywhere.
- Business logic goes in module Domain/Application. Controllers stay thin. Money goes through `Money`/NUMERIC strings. Queries are tenant-scoped. Checkout and payments are idempotent.
- Every phase must keep the full backend suite, vitest, the mocked Playwright suite and the full-stack suite (integration + demo stores) green.

## Build and Testing
- Backend Build: Passed. Pint is clean, and `php artisan test` passes via the scratchpad `backend-test.sh`.
- Frontend Build: Passed (`npm run typecheck`, `lint`, `build`).
- Tests: Passed. Run vitest from `D:\` (uppercase drive). Mocked Playwright uses `E2E_PORT=5191`.
- Regression: Completed. Full-stack: `e2e-backend.sh` (PORT=8071, FRONT_PORT=5186, DEMOS=1), then integration + demo-stores on desktop-chromium.

## Blockers and Risks
- The old DB password is in git history (commits 6532e59, f12421d). The user must rotate it. No history rewrite unless the user asks.
- The PostgreSQL Windows service `postgresql-x64-18` fails at boot. Start it with `pg_ctl start -D "C:\Program Files\PostgreSQL\18\data"`.
- POS1d printing has not been tested on real printers.
- Known e2e flakes under load:
  - P2a (storefront order form)
  - B21 (builder tour)
- The demo-stores full-stack file needs a fresh DB to re-run (B1 can't run twice).

## Next Session Instructions
1. Verify Git status and existing changes. Branch should be `phase-8-ai`.
2. Read this session state and the claude-mem work_state (`pos-pos1`, `pos-manual-pending`).
3. Check that PostgreSQL accepts connections on 127.0.0.1:5432.
4. Continue from the first pending task, ST2, only after the user's go.
5. Do not repeat completed investigation unless necessary.
6. Preserve all existing functionality.

## Important Notes
- This file's earlier HealthCareERP content (a different project) is backed up at `C:\Users\PC\.claude\projects\d--Learning-pos\lead-backup\SESSION_STATE.healthcareerp.md`.
