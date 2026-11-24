# Feature gap audit — Enterprise POS + online store

**Date:** 2026-11-23 · **Branch:** `phase-8-ai` at `53178c1` · **Scope:** the whole product (in-store POS, products & stock,
purchasing & supply chain, online store & orders, store builder, platform, reports, AI, operations).

**Method.** Five read-only investigations ran in parallel; each compared what the README roadmap, `docs/*.md`, the CHANGELOG and the
Bangla user manual promise against the code that exists, and against what a Bangladeshi retail / online SME normally needs. A
sixth pass (wiring) cross-checked all 579 backend routes against the 483 API calls in the frontend. Every **P0** claim and the
contradictions below were then re-checked by hand in the code (marked ✔). "Missing" means searched for and not found.

**Priorities.** **P0** — blocks real use or risks data / money · **P1** — important for day-to-day business · **P2** — nice to have.

---

## 1. Fix first — the documentation and the software disagree (small fixes, real risk)

> **Status (2026-11-23):** all six fixed in phase **Q1** (see CHANGELOG), together with the §7 P1 items and clean-up. Offers at the till (#3) are fixed in the manual; the feature itself is part of POS1.

| # | Problem | Evidence | Risk | Fix size |
|---|---|---|---|---|
| 1 | **Stock adjustment: the manual says "enter the actual counted number", the system adds the number as a change** | `USER_MANUAL.bn.md` (*স্টক মেলানো*: "আসল গোনা সংখ্যা") vs `PostAdjustmentRequest.php:20` (signed `-?…`) and the form hint "Positive adds stock, negative removes it" ✔ | A count of 50 on an item with 45 in stock makes it **95**. Wrong stock everywhere. | Small (fix the manual now; a "set counted quantity" mode is part of stocktake below) |
| 2 | **"Add a new customer" at the till** is promised but missing | Manual line 135 ("বা নতুন যোগ করুন") vs `pos/components/customer-picker.tsx` (search only) ✔ | Cashier must leave the till to create a credit (বাকি) customer | Small |
| 3 | **Offers "lower prices automatically"** — only online, never at the till | Manual line 383 vs `PromotionPricing` used only by `Cart/…/CartPricer.php` ✔ | Shop staff expect the sale price at the counter | Medium (promotions at POS, §3) |
| 4 | **Receipt says "Tax invoice" but prints no seller BIN** | `organizations.tax_number` exists; `SalePresenter` / `receipt.tsx` don't print it ✔ | Not a valid VAT invoice | Small |
| 5 | **Cancelled order still uses up the shopper's coupon** | `CancelOrder.php:36` "Promotion redemptions are not reversed" ✔ | A once-per-customer coupon (e.g. WELCOME50) is lost on cancel | Small |
| 6 | **Public sign-up is on by default**, the login page always offers "Create an account" even when it is switched off | `config/pos.php:14` default `true` ✔; `login-page.tsx:51` ignores the flag | Anyone can create organizations on a public install; dead link when off | Small |

## 2. Before going live (operations & safety)

| Gap | Status | Evidence | Pri |
|---|---|---|---|
| Phase 9 (security review, performance) and Phase 10 (production deployment) | Open | README roadmap ☐; CHANGELOG "Phase 9 part 1" was UI fixes + `npm audit` only | **P0** |
| Backups + restore drill, error monitoring (Sentry-like), queue dashboard | **Done (G1b)** | `pos:backup` + nightly check, built-in error log + alert e-mails, failed jobs on *System status* | **P0** |
| Health check covers database + cache only — not the queue worker, scheduler or mail | **Done (G1b)** | heartbeats + mail / backup / disk checks on the platform *System status*; public `/health` deliberately unchanged | P1 |
| Security headers (CSP, X-Frame-Options, HSTS); no nginx / Docker / CI files in the repo | Headers **done (G1a)**; deployment files → G1c | Laravel middleware + admin CSP in DEPLOYMENT_GUIDE; storefront `script-src` CSP still open | P1 |
| Two-factor login for owners / accountants; account lockout after many failed logins | **Done (G1a)** | TOTP + recovery codes, organization policy, lockout with unlock | P1 |
| `EXPLAIN` on production-sized data (sales, P&L, tax, dashboard, storefront, insights) | Pending | README, DEPLOYMENT_GUIDE | P1 |
| Live AI call never made (AI1, AI2a, AI2b) | Unverified | AI_INTEGRATION | P1 before switching AI on |
| E-mail actually sending: default mailer is `log`, e-mails are queued | Config | `.env.example` | P0 at deploy (configure SMTP + worker) |
| Data retention (audit logs, login history, notifications, failed jobs, AI logs grow forever) | **Done (G1b)** | `pos:prune-records` daily; audit kept unless configured | P2 |
| API tokens always full access (`['*']`), no outbound webhooks | Missing | `IssueDeviceToken.php:19` ✔ | P2 |

## 3. In-store POS

**Works today:** server-priced cart, split payment (cash / card / mobile banking / points), credit sales with limits, held carts,
returns with approval, register X/Z reports, expenses, basic loyalty, per-branch gap-free invoice numbers, browser receipt printing.

| Gap | Pri | Notes |
|---|---|---|
| **Offline selling** (internet / power cuts stop sales) | P0/P1 | Out of scope by ADR for v1 — needs a product decision |
| **Bangladesh VAT / Mushak** (6.3 invoice, 6.1/6.2 registers, 9.1 return, supplementary duty stacked on VAT) | P1 | Only a generic tax report exists |
| **Promotions & coupons at the till** | P1 | Online only (see §1 #3) |
| **Price override / open-price items with manager approval at the till** | P1 | Today a manager must log in themselves |
| **Exchanges**, **store credit / gift cards / vouchers**, customer advances | P1 | Return → approval → new sale; no credit balance |
| **Receipts by SMS / e-mail / WhatsApp**, due (বাকি) reminders | P1 | Print only; no SMS provider at all |
| **Silent receipt printing** (ESC/POS / print helper), **"no sale" drawer open** | P1 | Every print opens the browser dialog; drawer only via printer driver; real 58/80 mm printers untested |
| **Cashier PIN login / quick switch / screen lock** | P1 | — |
| **Restaurant mode** (tables, kitchen tickets, modifiers, service charge, tips, split bill) | P1 if restaurants are a target | — |
| Customer display, weighing scale & weight barcodes, barcode/shelf labels | P2 | Labels are P0 under stock (§4) |
| Cash rounding to the taka; till payments by bank transfer / cheque; bKash / Nagad as separate methods with transaction check | P2 | — |
| Register close by note/coin count, blind close, variance approval, safe drops | P2 | — |
| Loyalty: point expiry, tiers, birthday, points on web orders, balance on receipt | P2 | — |
| Layaway / deposits (held carts reserve no stock and never expire) | P2 | — |
| Salesperson & commission on a sale, clock-in / attendance | P2 | — |
| Per-branch receipt header and prices, other branches' stock visible at the till, invoice numbers per fiscal year, "COPY" on reprints | P2 | — |
| End-to-end tests: only a cash sale and a cash refund run against the real backend | — | split / credit / points / register close have backend + mocked tests only |

## 4. Products, stock, purchasing

**Works today:** purchase orders, goods receipts, purchase returns, landed cost, requisitions & RFQs, reorder suggestions, FEFO
batches, weighted-average cost, transfers, adjustments, CSV/Excel/PDF export of every list.

| Gap | Pri | Evidence / notes |
|---|---|---|
| **Bulk import** (CSV/Excel) of products, opening stock, customers, suppliers, price updates | **P0** | No import route or library ✔ — onboarding a shop with thousands of SKUs is manual |
| **Barcode generation & label printing** (product / shelf labels) | **P0** | `Barcode.php` only validates; no barcode library ✔ |
| **Stocktake / cycle count** (count session, counted vs system, variance report, freeze) | **P0** | Only signed adjustments; see the manual error in §1 #1 |
| **Supplier payments outside the cash register & payments ledger; no supplier refunds** | P0/P1 | Paying a supplier from the till doesn't change expected cash ✔ |
| Box / carton units usable in buying & selling (unit conversions exist but no line uses them) | P1 | — |
| Wholesale price used anywhere (stored, never used); price lists, quantity tiers, branch prices | P1 | — |
| Purchase discounts and **bonus / free quantity** (10+1) on PO / receipt | P1 | Standard in BD FMCG & pharma — costs come out wrong without it |
| Short-close a partly received PO; purchase return without a goods receipt (expired stock back to the rep) | P1 | — |
| Transfer received short / damaged, transfer request & approval, challan print | P1 | Receive takes no quantities |
| Print / e-mail PO, goods receipt, transfer documents | P1 | Only the RFQ has a document |
| Serial-number stock register (phones, electronics) | P1 | Serials only captured at sale (deferred by design) |
| Stock valuation as of a past date (month-end) | P1 | Only "as of now"; FIFO option P2 |
| Recipes / BOM / kits & combos | P2 (P1 restaurants) | — |
| Bin / shelf locations, bulk product edits, near-expiry alerts, write-off approval, wastage & dead-stock reports, supplier invoice allocation & advances | P2 | — |

## 5. Online store & orders (Facebook-driven, cash-on-delivery-heavy shops)

**Works today:** full storefront, cart, checkout (COD & bank transfer), shipping by district, orders board, couriers with tracking
links, COD remittances, returns, reviews, promotions & coupons, landing pages, campaigns, social posting, product feeds, Bangla
storefront, the page builder (B1–B21), shop assistant (AI2b).

| Gap | Pri | Evidence / notes |
|---|---|---|
| **Online payment: SSLCommerz, bKash, Nagad (E8c)** | **P0** | Gateway codes only `cod`, `bank_transfer` ✔; waiting on sandbox credentials |
| **Record the shopper's bKash / Nagad "Send Money" transaction ID** (manual mobile payment) | **P0** | No field anywhere |
| **SMS** (order placed / confirmed / shipped / delivered, OTP) | **P0** | No SMS provider in the code ✔ |
| **Phone-number checkout & OTP login** (e-mail is required today) | **P0** | `StoreCheckoutController.php:137` e-mail required ✔ |
| **Staff-entered orders** (phone / Messenger / comment orders) and **editing an order** after the confirmation call | **P0** | `orders.source` allows only storefront / landing page ✔; no create/edit route |
| **Fake-order protection for COD** (phone blocklist, verify-before-confirm, delivery success ratio, advance delivery charge) | **P0** | Nothing ✔; COD orders start confirmed |
| **Facebook Pixel + Conversions API, GA4, TikTok pixel** (or at least a "paste tracking code" setting) | **P0** for ad-driven shops | Nothing ✔ |
| Courier API booking & automatic status (Pathao, Steadfast, RedX, Paperfly) | P1 | Couriers are name + phone + tracking link |
| Abandoned-cart recovery; shipped / out-for-delivery / delivered notifications to shoppers; guest "track my order" page | P1 | — |
| Messenger inbox / comment-to-order; e-mail campaigns & web push (newsletter sign-up exists, nothing sends) | P1 | — |
| Delivery areas below district (upazila / thana), weight-based fees | P1 | — |
| Bangla order e-mails, gift cards, click & collect, loyalty on web orders, review photos, change e-mail, link POS & online customer by phone | P2 | — |
| Better search (typo tolerance, Banglish → Bangla; trigram index exists but unused) | P2 | — |
| Meta live posting tested only against a fake Graph API; checkout load test; Lighthouse | Unverified | — |

*Out of scope by decision (ADR-017):* multi-currency, subscriptions, product bundles, digital products, offline PWA checkout.

## 6. Platform, reports, accounting

| Gap | Pri | Notes |
|---|---|---|
| **Accounting core**: chart of accounts, journals, ledger, trial balance, balance sheet, bank accounts & reconciliation, period lock, Tally/QuickBooks export | P1 | Only P&L and tax reports exist |
| **Admin in Bangla** (the back office and e-mails are English only; the staff manual is Bangla) | P1 | ARCHITECTURE: "back office stays English" — worth revisiting for Bangla-only cashiers |
| **Reports missing**: dead stock / stock aging, voids & discounts & cancelled sales (loss prevention), returns | P1 | Balance sheet, cash flow, hourly sales, transfers, purchases by supplier, loyalty liability, Z-report as a report — P2 |
| Scheduled jobs promised in ARCHITECTURE: daily summaries to owners, batch-expiry alerts, unclosed-register reminders | P1 | Not built |
| SaaS: plans, billing, usage limits, tenant usage view, support impersonation, tenant export / deletion, CAPTCHA + e-mail verification on sign-up | P0 only if sold as SaaS | — |
| Payroll / HR, per-user notification preferences, approval chains, staging & rollback runbook, automated accessibility tests (axe), row-level security evaluation, deadlock retry | P2 | — |

## 7. Wiring and clean-up (no broken connections found)

All 483 frontend API calls resolve to real routes; all 14 scheduled commands, 3 jobs, 13 queued notifications and 12 events are wired;
all 86 permissions are used; no TODO/FIXME markers. Remaining:

- **P1:** organization-wide sign-in history (`GET /login-activities`) has no screen; an RFQ supplier can't be removed from the UI
  (`DELETE purchasing/rfqs/{rfq}/suppliers/{supplierId}`); the registration flag (§1 #6).
- **P2:** unused `GET /inventory/valuation` (the report covers it), unused detail endpoints (adjustment, transfer, expense, purchase
  return, branch, user, role, short link), legacy `PUT /storefront/theme` + dead hooks (`useSaveThemeMutation`, `useClearCartMutation`,
  `useVersionsQuery`, `useCreateGlobalMutation`), the leftover `refunds.*` role pattern, a stale skip in `StoreBuilderB17Test.php:439`,
  and no "please use a computer" notice for the desktop-only page builder on phones.

> **Status (Q1):** the P1 items, the theme route, dead hooks, role pattern, stale skip and phone notice are done; the
> adjustment detail endpoint now has a page. Still open, found during Q1: a stock count can't enter a *new* batch number
> from the screen (the API accepts `batch_number`); the page builder's read-only mode swaps the drag sensors list for an
> empty one (`editor.tsx`, React dev warning "final argument passed to useEffect changed size"; harmless in production);
> AVIF pictures are not accepted by the media upload; dropping pictures on an empty builder page does nothing.

---

## 8. Suggested order of work

1. **Q1 — Quick fixes (one short phase):** §1 #1–#6 (manual + a "set counted quantity" option, add customer at the till, BIN on
   receipts, release coupons on cancel, registration off by default + flag-aware login page), sign-in history screen, RFQ supplier
   removal, §7 clean-up.
2. **G1 — Go-live essentials:** backups & restore drill, error monitoring, queue / scheduler / mail health, security headers,
   2FA, Phase 9 review, `EXPLAIN`, deployment files (Phase 10).
3. **BD1 — Bangladesh commerce pack:** SMS provider (pluggable), phone OTP login & phone-only checkout, order & due-reminder SMS,
   staff-entered / editable orders, COD fraud controls, Facebook Pixel + CAPI / GA4 (+ "paste tracking code"), manual bKash/Nagad
   transaction ID.
4. **ST1 — Stock operations:** bulk import, barcode & label printing, stocktake sessions, supplier payments in the cash ledger,
   carton units, wholesale price lists, purchase discount & bonus quantity, PO short-close, returns without receipt, transfer
   discrepancies, document printing.
5. **POS1 — Counter upgrades:** promotions at the till, price override with approval, exchanges & store credit / gift cards, cashier
   PIN, silent printing & drawer, receipts by SMS.
6. **PAY1 / SHIP1:** SSLCommerz / bKash / Nagad (needs sandbox credentials), courier APIs (Pathao / Steadfast / RedX — needs merchant
   accounts).
7. **Decisions needed:** offline POS (out of scope for v1 today), Bangla admin, Mushak VAT, accounting core, restaurant mode, SaaS
   billing.
