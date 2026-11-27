# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### T1 — Storefront theme presets and layout variants

The online store can wear four looks — *Default* (unchanged), *Vegan Store*, *Handmade*, *Classic Shop* — over the same catalog, cart, checkout and POS data. Plan: [STOREFRONT_THEMES_PLAN.md](docs/ecommerce/STOREFRONT_THEMES_PLAN.md).

#### Added
- `ThemeSchema`: top-level `preset`; layout keys `header_style`, `footer_style`, `card_style`, `hero_style`, `heading_case`, `top_bar` (defaults = the existing look; old themes read unchanged); fonts `playfair` (serif) and `jost` (`@fontsource-variable/playfair-display`, `@fontsource-variable/jost` 5.3.0). No migration (theme JSON).
- `Domain/ThemePresets` + `ApplyThemePreset`; `GET /storefront/theme/presets`, `POST /storefront/theme/presets/{preset}/apply` (keeps logo, announcement, footer, custom CSS; audited). All presets pass WCAG AA (4.5:1) for button, text, heading, sale and accent-as-text pairs (unit-tested).
- Storefront variants: header *centered* (search panel) and *commerce* (wide search, cart total, dark menu bar); top bar *ticker* (pausable marquee, still under reduced motion) and *utility*; footer *showcase* (popular / new product widgets) and *widgets* (about, latest posts, best selling, top rated, newsletter); product card *minimal* (image-led, no buttons) and *commerce* (hover second image, wishlist + quick view on hover/focus, category, stars, Sale / New / Out of stock, add to cart); hero *tiles* and *sale*; heading case. Mobile keeps the existing header and drawer.
- Admin *Online store → Theme*: preset picker (miniature preview, confirm, apply) and a Layout card; the form always sends `preset` and the layout keys.

#### Fixed / improved
- Homepage section editor: banner sections can create a banner inline (shared `BannerForm`, also used by *Online store → Banners*), so an empty banner picker is no longer a dead end.
- Local development: on `localhost` / `127.0.0.1`, signed-in staff see **their own** organization's store (so *View store* shows the theme just saved); anonymous visitors still get `storefront.default_host`, and real hosts always decide the store.

#### Tests
- Backend 768 (PostgreSQL: 767 pass, 1 opt-in skip); vitest 900; mocked Playwright `storefront-themes.spec.ts` (each preset, desktop + mobile) and the admin preset mock.

### BD2b — Cart reminders, shipped / delivered e-mails, newsletter campaigns

Second part of BD2 from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §5 (P1). No new packages. From this phase on browser (Playwright) tests are not run, on the owner's instruction.

#### Added
- **Cart reminders** (Online store settings): a signed-in shopper who leaves items in the cart gets one reminder after N hours — e-mail, or SMS (*Cart reminder* template) without an e-mail; off by default; "Sent · ordered (30 days)" on the settings page.
- **Shipped / delivered e-mails** to shoppers (courier, tracking link; review link once delivered), on by default with switches.
- **Newsletter campaigns** (Marketing → Newsletter): draft, preview, send a test, send to every confirmed subscriber; each e-mail has a working unsubscribe link (signed, no sign-in).

#### Tests
- Backend 2131 (2130 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3347; typecheck, lint, build clean.
- Browser tests (mocked and full-stack Playwright) not run.

#### Upgrade
- `php artisan migrate`; mail, queue worker and scheduler running.

### BD2a — Delivery areas inside a district, weight-based delivery fees

First part of BD2 from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §5 (P1). Abandoned carts, shipped / delivered e-mails and newsletter campaigns follow in BD2b. No new packages.

#### Added
- **Delivery areas** (Shipping → zone → Areas): the shop's own areas or thanas in a district, each with a fee up or down (e.g. Mirpur +20, Savar +40). Checkout, the order form on landing pages and staff orders ask for the area when a district has areas.
- **Weight pricing** on delivery methods (kg included, fee per extra kg, rounded up) and a **Weight (g)** per product variant; the store explains the delivery fee ("incl. ৳20 for your area · ৳40 for the parcel weight").

#### Tests
- Backend 2111 (2110 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3335; mocked Playwright 660 (new `bd2a-delivery-areas`).
- Full-stack (PostgreSQL, desktop) 71 across runs (integration 28 and 42 demo-store tests in the full and fresh-database runs — ST2b's receipt PDF download dropped once under the single-threaded test server and passed on the rerun; the new BD2a test first quoted an unpublished product (no weight is priced for an unavailable line) and opened the wrong Shipping page, was fixed to publish the product and passed) — new **BD2a** on Bazar Fresh: an area +30 and weight pricing (1 kg included, 20 per kg); a 3 kg staff quote to that area shows base + 30 + 40; the store lists the area (no fees); a staff order there without the area is refused; the Shipping page offers the area editor.

#### Upgrade
- `php artisan migrate`.

### R1 — Loss-prevention, returns and dead-stock reports; daily summary and alerts; due reminders

From [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §6 and the due (বাকি) reminders (P1). No new packages.

#### Added
- Reports **Loss prevention** (per cashier: cancelled sales, discounts, price overrides, no-sale drawer openings, returns, exchanges — or every event with a link), **Returns** (by reason, product or cashier) and **Dead stock** (nothing sold in N days, value, stock aging).
- **Alerts** (Organization → Alerts & reminders): a **daily summary** to owners in the app and by e-mail, **batch-expiry** alerts, and a reminder when a **register stays open** too long.
- **Due reminders**: automatic SMS weekly or monthly to customers who owe at least a set amount (off by default), **Send due reminder** on the customer page, and a **WhatsApp** link with the reminder text; new SMS template *Due reminder*.

#### Tests
- Backend 2094 (2093 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3320; mocked Playwright 654 (two older specs — till set-up and store link sharing — failed once under full load and passed on rerun) (new `r1-reports-reminders`).
- Full-stack (PostgreSQL, desktop) 70 — new **R1** on Bazar Fresh: alert settings saved, a customer owing 350 reminded by SMS (test mode) with a WhatsApp link, a cancelled sale in the loss-prevention report (API and page), the dead-stock report, and the daily summary in the owner's notifications.

#### Upgrade
- `php artisan migrate`; keep the scheduler and a queue worker running.

### ST2d — Serial-number register, stock value as of a past date

Last part of ST2 from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §4 (P1). No new packages.

#### Added
- **Serial numbers** (Inventory → Serial numbers): phones and electronics are tracked one by one — entered on goods receipts, stock adjustments, transfers and purchase returns (with a picker of the serials in stock), checked at the till (a phone already sold or at another store cannot be sold), back in stock on returns and cancellations; each serial shows its history with links to the documents. Stock from before the register still sells.
- **Stock valuation** page (Inventory → Valuation) with an **As of** date: the value at a past month-end, also in the export.

#### Tests
- Backend 2070 (2069 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3300; mocked Playwright 646 (new `st2d-serials`).
- Full-stack (PostgreSQL, desktop) 69 — new **ST2d** on Bazar Fresh: two phones received with their serials, one sold, selling it again refused (`SERIAL_NOT_IN_STOCK`), its history (receipt, sale) on the Serial numbers page; valuation as of 30 days ago, today (= live) and a future date (refused).

#### Upgrade
- `php artisan migrate` (the valuation backfill replays the stock history once).

### ST2c — Carton barcodes, wholesale price, quantity breaks, branch prices

Third part of ST2 from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §4 (P1). Serial register and past-date valuation (ST2d) follow. No new packages.

#### Added
- **Pack barcodes** on products (e.g. *Carton* = 24): one scan at the till adds 24, a stocktake scan counts 24; purchase orders and receipts can be entered in packs (Pack, packs, pack cost → quantity and cost per unit). Stock and prices stay per unit.
- **Quantity breaks** (e.g. 27 each from 24), **branch prices**, and the **wholesale price** for customers in a *Wholesale* customer group (Customer groups → Price level). The till shows *Qty price* / *Wholesale* on the line; promotions apply only to normal prices. The online store keeps the normal price.

#### Tests
- Backend 2048 (2047 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3284; mocked Playwright 644 (one builder test, B20, failed once under full load and passed on rerun) (new `st2c-pricing`).
- Full-stack (PostgreSQL, desktop) 68 (the first run failed the new ST2c test — it scanned before the till had chosen its store — and timed out once in a web-order test; the test now waits for the till, and a fresh run passed all 68) — new **ST2c** on Bazar Fresh: a product at 30 with a branch price 32, wholesale 25 and 27 each from 24; the price check gives 32 / 27 (tier) / 25 (wholesale customer); one till scan of its carton barcode adds 24 at 27 and the sale totals 648.
- The A/B test results test now runs at 23:45 UTC from the start (it depended on the time of day).

#### Upgrade
- `php artisan migrate`.

### ST2b — Transfers received short / damaged, transfer requests, challan / PO / GRN documents

Second part of ST2 from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §4 (P1). No new packages.

#### Added
- **Receive a transfer** with what really arrived: received, damaged and short per line; only good units enter stock; the loss value and a **Discrepancy** badge show on the transfer.
- **Request stock** from any store (e.g. the central warehouse); the sending store **dispatches** (quantities and batches can be reduced) or **rejects** it; the requester can cancel.
- **Print challan** for transfers; **Print** purchase orders and goods receipts; **E-mail to supplier** sends the purchase order as a PDF.

#### Fixed
- Marketing campaign stats, page insights and A/B test results counted orders by UTC day bounds instead of the shop's day between midnight and 6 am Dhaka time (orders of the morning fell outside "today").

#### Tests
- Backend 2033 (2032 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3274; mocked Playwright 637 (new `st2b-transfers`).
- Full-stack (PostgreSQL, desktop) 67 — new **ST2b** on Bazar Fresh: a new back store requests 3 units from the shop floor, the floor dispatches them, 1 is received, 1 damaged, 1 short (stock, loss, discrepancy); the challan, a purchase order and its receipt print as PDFs and the order is e-mailed to the supplier.

#### Upgrade
- `php artisan migrate`.

### ST2a — Purchase discounts and free quantity, short-close, returns without a receipt

First part of ST2 (stock gaps) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §4 (P1). Transfers & documents (ST2b), selling units & price lists (ST2c), serial register & past-date valuation (ST2d) follow. No new packages.

#### Added
- **Disc %** and **Free qty** (e.g. 10 + 1) on purchase orders and goods receipts. Stock comes in with the free units at the true cost per unit; the supplier is owed the discounted total; landed costs are spread over the free units too; returns can send free units back at that cost.
- **Close short** a part-received purchase order with a reason; the rest is no longer on order (reorder suggestions, supplier fill rate).
- **Return without a receipt** (Purchase returns → New return): expired or damaged stock back to the rep, credited at the average cost or an agreed cost.

#### Tests
- Backend 2008 (2007 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3259; mocked Playwright 631 (new `st2a-purchasing`).
- Full-stack (PostgreSQL, desktop) 66 (the first run caught the free-quantity box's label containing "Quantity of line 1"; renamed "Free qty of line 1", then all passed) — new **ST2a** on Bazar Fresh: 10 ordered at 5 % off with 1 free, 4 + 1 received at 76 each (380 owed), the order closed short from its page, one unit returned without a receipt (304 owed).

#### Upgrade
- `php artisan migrate`.

### POS1d — Receipt printers, the cash drawer, and receipts by SMS / e-mail

Last part of POS1 (counter upgrades) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §2 (P1). No new packages: the ESC/POS encoder, Web Serial / WebUSB access and the QR command are written here.

#### Added
- **Receipt printer** per till (Till → Receipt printer): USB or serial receipt printers print **without the print dialog** in Chrome / Edge — paper 58 / 80 mm, cut, copies, print after every sale, **open the drawer on cash sales**, Test print, Forget printer. Bangla receipts print as a picture; a QR code links to the online receipt. Other browsers keep browser printing.
- **Open drawer** without a sale (Till → Open drawer): a reason is required; cashiers need a manager's PIN; every opening is listed on the register session and its close report.
- **Send receipt** by SMS or e-mail from the till and the sale page; a public **receipt page** on the shop (`/receipt/…`); new SMS template **Sale receipt**; the sale page lists where its receipt went.

#### Security
- Receipt links are long random tokens; the public receipt never shows costs, the customer's phone, e-mail or balance. Phone numbers and e-mail addresses are stored and audited only masked (`017••••678`). Sends are limited (10 a minute per user, 5 per sale); the page 30 a minute per address.

#### Tests
- Backend 1994 (1993 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3247; mocked Playwright 625 (one builder test, B21, failed once under full load and passed on rerun) (new `pos1d-till` with a fake serial printer checking the bytes, `pos1d-admin`).
- Full-stack (PostgreSQL, desktop) 65 — new **POS1d** on Bazar Fresh: the owner opens the drawer without a sale (on the session's list), a sale's receipt goes out by SMS (test mode) from the sale page and by e-mail, and a shopper opens the public receipt (no phone number on it; an unknown link says not found).
- Not tested on real printers: the bytes are checked against the ESC/POS commands; check a print (and a Bangla print) on each printer model.

#### Upgrade
- `php artisan migrate`, `php artisan pos:permissions:sync`.

### POS1c — Exchanges at the till

Third part of POS1 (counter upgrades) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §2 (P1). Printing / drawer / SMS receipts follow in POS1d. No new packages.

#### Added
- **Exchange** at the till: find the invoice (type or scan), choose what comes back (serials, reason, restock), check its value, then ring up the new items. The returned value pays the new sale; the customer pays the difference with any till method, or gets it back (cash, card, store credit, gift card credit note). Return and new sale are saved together and link to each other.
- A cashier without return approval gets a **manager's PIN approval** for the return, tied to that invoice.
- Receipt shows the exchange (items back, value, refund) before the new items; sale and return pages show the link and an **Exchange** badge; an exchange sale cannot be cancelled (return its items instead).

#### Tests
- Backend 1973 (1972 pass, 1 opt-in skip) (PostgreSQL); Pint clean. vitest 3193; mocked Playwright 617 (new `pos1c-exchange`, `pos1c-admin`).
- Full-stack (PostgreSQL, desktop) 64 (28 integration + 36 demo stores; the demo-store file passed in full on a fresh database after one run timed out in P2a, an online-shop test this phase did not change) — new **POS1c** on Bazar Fresh: an invoice of two units is exchanged at the till for two more (one back, the customer pays one in cash), the receipt shows the exchange, both documents link, the exchange sale refuses cancelling, then it is exchanged again with the difference refunded to store credit.

#### Upgrade
- `php artisan migrate`.

### POS1b — Store credit (customer advances) and gift cards / vouchers

Second part of POS1 (counter upgrades) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §2 (P1). Exchanges follow in POS1c, printing / drawer / SMS receipts in POS1d. No new packages.

#### Added
- **Store credit** per customer: **advances** at the till or on the customer page (receipt `ADV-…`), **pay with store credit** at the till, **refund a return to store credit**, manager **adjustments** and **payouts**; the balance shows at the till, on receipts and on the customer page.
- **Gift cards** sold at the till (any value, pre-printed numbers allowed, 12 months or no expiry; slip with the code shown once), **vouchers** issued free by managers, **credit notes** when a return is refunded to a gift card; **Gift cards** page (list, history, void); **Gift card balance** check at the till; pay with one or more gift cards, partly or fully.
- Cancelling a sale gives back what it took from store credit and gift cards.

#### Security
- Gift card codes are stored only as a hash (plus the last four); the full code appears once. Stored idempotent replies are encrypted, so a code is not kept in clear even for retries. Lookups are limited to 20 a minute per user.

#### Tests
- Backend 1955 (PostgreSQL: 1954 pass, 1 opt-in PDF skip) (PostgreSQL); Pint clean. vitest 3163; mocked Playwright 609 (new `pos1b-till`, `pos1b-admin`).
- Full-stack (PostgreSQL, desktop) 63 (62 in one run; the new POS1b test then failed only on a drawer left open by its earlier single run, fixed and passed) — new **POS1b** on Bazar Fresh: a customer advance and a gift card sold by card (the list never shows the code); at the till one sale is paid with the store credit, the gift card (typed in lower case) and cash, the receipt names the card by its last four, both balances are spent; one unit is returned and refunded as a credit note that can pay.

#### Upgrade
- `php artisan migrate`, `php artisan pos:permissions:sync`.

### POS1a — Till PIN, tills, manager approval, price changes and promotions at the till

First part of POS1 (counter upgrades) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §2 (P1). No new packages.

#### Added
- **Tills** (*Settings → Tills*, `pos.terminals.manage`): a manager sets up a counter computer as a till once; tills can be revoked.
- **Till PIN** (*Profile → Till PIN*, 4–6 digits; *Users → Clear PIN*): on a till cashiers pick their name and type their PIN; 5 wrong PINs lock it for 15 minutes. **Lock** button and auto-lock after 5 minutes without use (the whole back office leads back to the lock screen); **Switch cashier** holds the current sale and signs in the next cashier.
- **Manager approval by PIN** on the till screen: price changes and discounts by cashiers without the permission; each approval is for one sale, one cashier and (for prices) one item, valid 10 minutes, and kept on the sale.
- **Change price** at the till (`sales.price_override` or approval) and **open-price products** (*Products → Price is entered at the till*).
- **Promotions and coupons at the till**: promotions say where they apply (online store / till); the till shows each offer, the coupon status and "You save"; one discount per level (manual item discount over a promotion; on the sale: manual discount, then promotion or coupon, then the customer-group discount).
- Sale and receipt show list vs charged price, who approved, the offers, the coupon and the savings.

#### Changed
- The Cashier role has `pos.sell` instead of all POS permissions (it cannot set up tills).
- A cashier without `sales.discount` gets `APPROVAL_REQUIRED` instead of `DISCOUNT_NOT_ALLOWED` (the product's maximum discount still applies to everyone).
- The promotion report counts online orders only (till sales show in the redemptions list).

#### Tests
- Backend 1927 (PostgreSQL: 1926 pass, 1 opt-in PDF skip) (PostgreSQL); Pint clean. vitest 3130; mocked Playwright 599 (new `pos1a-till`, `pos1a-admin`).
- Full-stack (PostgreSQL, desktop) 62 (59 in one run; BD1b failed once under load and passed on a rerun together with BD1c and POS1a) — new **POS1a** on Bazar Fresh: the owner adds a cashier and sets an approval PIN, the cashier sets a till PIN, the owner sets up the till and signs out; the cashier signs in on the till with the PIN, opens a drawer, locks and unlocks, changes a price that the owner approves with a PIN on the same screen, and is paid in cash; the sale keeps the list price, the charged price and the approver.

#### Upgrade
- `php artisan migrate`, `php artisan pos:permissions:sync`; set up each counter computer as a till; tick *Till* on promotions that should apply at the counter.

### BD1c — bKash / Nagad / Rocket Send Money, advance delivery charge, ad pixels and tracking code

Third and last part of BD1 (Bangladesh commerce pack) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §5 (P0). No new packages; no payment-gateway or ad-platform SDK.

#### Added
- **bKash, Nagad and Rocket (Send Money)** as payment methods (*Online payments*): the shop's receiving number, account type (Personal / Agent / Merchant — the shop tells the shopper to Send Money, Cash Out or Make a Payment accordingly) and hours to pay.
- **Transaction ID (TrxID):** after placing the order the shopper sends the money and enters the sender number and TrxID on the thank-you page, the order page, the account order page or the *Track order* page. Staff see *Payment to check* on *Web orders* and confirm or reject each TrxID; a rejected one can be sent again; a TrxID cannot be used twice.
- **Advance delivery charge** for cash on delivery (*Online store settings*): off, only risky numbers or all orders; the delivery charge or a fixed amount, paid by Send Money; the courier then collects only the rest (*Partly paid*).
- **Ad tracking** (*Marketing → Tracking & pixels*): Meta pixel with the **Conversions API** (server-side Purchase, deduplicated with the pixel by the order number; write-only access token; test event), **GA4**, **TikTok** pixel, and pasted code for `<head>` / before `</body>` (Organization Admin only). The shop sends page views, product views, add to cart, checkout started and one purchase per order; nothing in previews.
- Ad click ids (`fbclid`, `gclid`, `ttclid`) are kept for 30 days and sent with the order.

#### Changed
- Staff confirm a Send Money order through its TrxID while one waits (the plain *Confirm payment* is hidden then).
- `_fbp`, `_fbc` and `_ttp` cookies are no longer encrypted by the app.

#### Tests
- Backend 1877 (PostgreSQL: 1876 pass, 1 opt-in PDF skip) (PostgreSQL); Pint clean. vitest 3078; mocked Playwright 583 (new `bd1c-admin`, `bd1c-storefront`).
- Full-stack (PostgreSQL, desktop) 61 — new **BD1c** on Bazar Fresh: bKash Send Money switched on with the Meta pixel and pasted code (checked in the page the backend serves; not in a draft preview); a guest pays by bKash and sends the TrxID from the thank-you page; the pixel queued one Purchase with the order number as event id; staff confirm the TrxID (paid); with the advance delivery charge on, a cash-on-delivery order waits for the advance, the TrxID is confirmed and the order is partly paid.

#### Upgrade
- `php artisan migrate`; a queue worker for the Conversions API; outbound HTTPS to `graph.facebook.com`.

### BD1b — Staff-entered and editable web orders, cash-on-delivery checks

Second part of BD1 (Bangladesh commerce pack) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §5 (P0). No new packages.

#### Added
- **New order** on *Web orders* (`web_orders.create`): staff enter an order taken by phone, Facebook, WhatsApp, Instagram or in person — customer search or a typed contact, products, delivery address and method, payment method, coupon, note — with live totals from the server. It follows the normal workflow (process, ship, cash-on-delivery remittance, returns, e-mail and SMS). Staff cash-on-delivery orders start confirmed.
- **Edit order** (`web_orders.edit`): change the products, quantities, contact, address, delivery method, coupon or note of an unpaid order that has not been handed to a courier. Prices and promotions are recalculated, stock goes back and is taken again, and a *Changes* card shows every change (who, when, why, total before → after, changed lines).
- **Cash on delivery check** (*Online store settings*): hold shop and landing-page cash-on-delivery orders as *Awaiting confirmation* — off, only risky orders (success rate below a minimum, optionally new numbers) or all — until staff *Confirm order* after a call (one by one or in bulk).
- **Delivery history** of a mobile number on the order page, the order list and the new-order form: orders, delivered, returned, cancelled, success rate.
- **Blocked numbers** (*Web orders → Blocked numbers*, block from an order too): a blocked number cannot choose cash on delivery in the shop (it can still pay another way); staff orders only show a warning.
- Shoppers see *Awaiting confirmation* and "We will call you to confirm your order." on the order and track pages.

#### Changed
- The sidebar marks only the most specific entry as active (e.g. *Blocked numbers*, not also *Web orders*).
- The promotion report no longer counts a promotion use twice when an order edit recorded it again; the "X of Y claimed" note on the shop ignores released uses (cancelled or edited orders), like the usage limits do.

#### Tests
- Backend 1837 (PostgreSQL: 1836 pass, 1 opt-in PDF skip) (PostgreSQL); Pint clean. vitest 3018; mocked Playwright 573 (new `bd1b-order-entry`, `bd1b-cod-controls`).
- Full-stack (PostgreSQL, desktop) 60 — new **BD1b** on Bazar Fresh: the review is set to all orders; a guest's cash-on-delivery order waits for confirmation; staff see the number's history, confirm the order after a call and block the number; the blocked number cannot pick cash on delivery; staff enter an order taken by phone (confirmed at once) and change its quantity (revision 2, *Changes* card). Builder acceptance 5 (fresh database).

#### Upgrade
- `php artisan migrate`, `php artisan pos:permissions:sync`. Give `web_orders.create` / `web_orders.edit` (with `products.view` and `customers.view`) to staff who take orders by phone.

### BD1a — SMS, phone sign-in with a code, phone-only checkout, order SMS

First part of BD1 (Bangladesh commerce pack) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §5 (P0). No new packages; no SMS vendor SDK — a generic HTTP gateway any Bangladeshi SMS provider can be set up with.

#### Added
- **SMS settings** (*Settings → SMS*, `sms.view` / `sms.manage`): test mode (messages written to the server log) or an HTTP SMS gateway (URL, GET/POST, form/JSON, parameter names, write-only API key, sender ID, phone format, extra parameters, success text, monthly limit); *Send a test SMS*; English and Bangla templates for order placed / payment confirmed / shipped / delivered / cancelled with placeholders and an SMS-parts counter; message log with filters.
- **Order SMS** to the shopper on those events (once per order and event, in the order's language).
- **Sign in with a code** on the online store: mobile number → 6-digit SMS code; a new number gets a short "Almost done" step (name, optional e-mail). Profiles can verify the phone, add an e-mail once and set a first password.
- **Checkout:** *Customer e-mail at checkout* (required / optional / hidden) and *Check the phone with an SMS code* (off / cash on delivery orders / all orders), also on landing-page order forms.
- **Track order** page (`/track-order`): order number + mobile number, no account.
- Per-customer promotion limits also count guests by phone.

#### Changed
- **Contact e-mail at checkout is optional by default** (was required). Order e-mails are skipped when there is none; the SMS carries the order link.
- Shopper accounts may have no e-mail or no password; e-mail/password sign-in is unchanged for accounts that have both.

#### Security
- The SMS gateway address is checked on every send (https only; private, loopback, link-local / metadata and reserved addresses refused; the checked address is pinned; no redirects). The API key is encrypted, never returned, logged or audited. Codes are stored as HMACs, masked in the message log, rate-limited per phone / IP / store, 5 tries each; phone sign-in never opens an account whose number was not verified.

#### Tests
- Backend 1810 (PostgreSQL: 1809 pass, 1 opt-in PDF skip); Pint clean. vitest 2973; mocked Playwright 565 (new `bd1a-sms-admin`, `bd1a-phone-login`, `bd1a-checkout`, `bd1a-track-order`).
- Full-stack (PostgreSQL, desktop) 59 — new **BD1a** on Bazar Fresh: SMS in test mode, e-mail hidden and a code required for cash on delivery; a guest verifies the phone with the code read from the SMS log, places the order, the log shows the masked code and the order SMS, the order is tracked by number + phone, and the same number signs in with a code and creates an account. Builder acceptance 5 (fresh database).

#### Upgrade
- `php artisan migrate`, `php artisan pos:permissions:sync`; a queue worker must run for SMS. Stores that want e-mail at checkout set it back to Required.

### ST1 — Stock operations: bulk import, barcodes & labels, stocktakes, supplier money in the drawer

From [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §4 (P0). No new packages (Excel/CSV through the existing OpenSpout; barcodes drawn in-house).

#### Added
- **Bulk import** from Excel or CSV: products (with variants, categories and brands), price updates, opening stock, customers and suppliers (with opening balances). Download a template, upload, see a check first (what will be created, updated, skipped and every error with its row number — downloadable to fix in Excel), then import; it runs in the background, keeps going past a bad row, and keeps a history.
- **Barcodes and labels:** shop barcodes (EAN-13 starting with 20) for products without one; a *Print labels* page for product labels (A4 sheets of 24 / 40 / 65, thermal rolls 38×25 / 50×25 / 50×30 mm) and shelf labels with a big price, at true size, from a selection, a goods receipt, a purchase order or a category; EAN-13 / EAN-8 / UPC-A / Code 128 drawn in the browser.
- **Stocktakes:** count a whole store, some categories or some products — several people at once, by scanner or by typing, optionally *blind*; items found on the shelf can be added; progress and the difference in quantity and value before posting. Posting corrects stock by the difference at the time each item was counted, so sales during the count stay right. New permission `inventory.stocktake`.
- **Supplier refunds** and **voiding** supplier payments and refunds; statements, balances and the supplier dues report follow.

#### Changed
- **Cash paid to a supplier now comes out of the open cash drawer** (like expenses), so the drawer's expected cash is right; a refund in cash goes into it. Recording supplier money needs an open register session for cash, and an `Idempotency-Key`; the method "Other" is no longer offered.

#### Tests
- Backend 1745 with G1c (PostgreSQL: 1744 pass, 1 opt-in PDF skip; new `ImportFlowTest`, `CellValueTest`, `ProductImportTest`, `BarcodeLabelsTest`, `OpeningStockImportTest`, `CustomerImportTest`, `SupplierImportTest`, `StocktakeTest`, `StocktakeConcurrencyTest`, `SupplierMoneyTest`); Pint clean. vitest 2928; mocked Playwright 543 (new `st1-import`, `st1-labels`, `st1-stocktake`; the B21 tour test timed out once under load and passes 21/21 alone).
- Full-stack (PostgreSQL, desktop) 58 — new **ST1**: two products imported from a CSV file, given shop barcodes and printed as labels, counted by two scans in a stocktake and posted (stock 2), a supplier refund recorded and voided on the statement. Builder acceptance 5 (fresh database).

#### Upgrade
- `php artisan migrate`, `php artisan pos:permissions:sync`. Cash supplier payments need an open cash register session.

### G1c — Deployment files, CI, performance on production-sized data

Third part of G1 (go-live essentials) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §2. No new runtime packages.

#### Added
- **Deployment files** in [`deploy/`](deploy/README.md): Nginx site (back office + catch-all storefront hosts, admin security headers), PHP-FPM pool and OPcache settings, queue workers for Supervisor or systemd, the scheduler as cron or a systemd timer, and `deploy/scripts/release.sh` (release folders, atomic switch, PHP-FPM reload, worker restart, health check, `--rollback`, `--frontend-dist` for the CI build). Checked with `nginx -t` and every route by curl on a local Nginx; the release script was run end to end with stand-in tools (two bugs found and fixed).
- **CI** (`.github/workflows/ci.yml`): Pint + the full backend suite on PostgreSQL 18 (real `pg_dump` for the backup tests), frontend typecheck / lint / Vitest / build (artifact `frontend-dist`), and the mocked Playwright suite, on every push and pull request.
- **Performance tools:** `php artisan pos:perf:seed` (fills a non-production database with ~2 years of data: 600 000 sales / 2 M lines, 150 000 web orders, 200 000 customers, 80 000 variants, 3 M stock movements; ~7 min) and `pos:perf:explain` (times and plans the heavy read paths). Results and remaining work in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **12 indexes** (built `CONCURRENTLY`): covering indexes for sale and order lines, trigram search indexes for web orders, customers and sale numbers, newest-sales order. Web-order search 419 → 18 ms, sales list search 172 → 30 ms, POS day lines 130 → 2 ms, 30-day P&L 450 → ~220 ms.

#### Fixed
- **HTTP 500 on big stores:** reorder suggestions, the low-stock report, AI insights and the daily reorder alerts bound more than PostgreSQL's 65 535 parameters at ~80 000 variants; long `IN` lists are now chunked (`WhereInChunks`, tested with 70 001 values). The sales-by-customer report runs 28 queries instead of ~550.
- **Security:** `config/database.php` no longer has a literal default database password (it is empty; the password comes from `.env`), and a test no longer contains a fragment of it.

#### Known limits (proposals in PERFORMANCE.md §5, not built)
- 12-month sales / P&L / tax reports 1–2 s, the dashboard ~2 s, reorder / low-stock / AI shortage risk several seconds on 80 000 variants, and storefront listings of very large catalogs (filtering in PHP) remain over target; summary tables and SQL-side filtering are proposed.

#### Tests
- Backend PostgreSQL (new `PerformanceToolsTest`, `PerformanceIndexesTest`, `WhereInChunksTest`; counted with ST1 below). The admin CSP hash test also checks the Nginx snippet.

#### Upgrade
- `php artisan migrate --force` builds the new indexes concurrently (not inside an outer transaction; roughly a minute per 20–50 M sale lines on a busy server; ~190 MB per 2 M sale lines; a failed build is dropped and rebuilt on the next migrate). Set `DB_QUEUE_RETRY_AFTER` / `REDIS_QUEUE_RETRY_AFTER` to 4000. **Change the database password** if the old literal default was ever used.

### G1b — Operations: backups, restore check, system status, error log, data retention

Second part of G1 (go-live essentials) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §2. No new packages.

#### Added
- **Nightly database backups** (`POS_BACKUP_ENABLED`): `pg_dump` to a local folder at `POS_BACKUP_TIME` with a SHA-256 file, old copies removed after `POS_BACKUP_KEEP_DAYS` (the newest few always kept), an optional off-site command after each backup (`POS_BACKUP_AFTER_COMMAND`, e.g. rclone or `aws s3 cp`). The database password never appears on a command line.
- **Backup check** 90 minutes later: checksum + `pg_restore --list`, and with `POS_BACKUP_VERIFY_DATABASE` a full restore into a scratch database (refused for the live one) with a look at the core tables.
- **System status for platform admins:** warnings in plain words, health of the database, cache, scheduler and queue worker (heartbeats every minute), mail (with *Send test e-mail*), backup disk space, open errors and the last clean-up; **Backups** with *Back up now* and *Verify*; **Failed jobs** with retry, delete and retry all. Other users keep the simple status page.
- **Built-in error log:** unexpected server errors grouped by kind with counts, first / last seen, the request path and id, and a stack trace; resolve, ignore or reopen; a resolved error that comes back reopens. Recorded on its own connection, so errors inside rolled-back transactions are kept; messages are sanitised (no SQL values, e-mail addresses or secrets).
- **Alert e-mails** (`POS_OPS_ALERT_EMAILS`) for new or returning errors (rate-limited), failed backups, failed checks and failed off-site copies.
- **Data retention** (`pos:prune-records`, daily): old sign-in history, read notifications, failed jobs, AI request logs, resolved errors and backup records; the audit log is kept unless `POS_RETAIN_AUDIT_DAYS` is set.

#### Tests
- Backend 1705 (PostgreSQL: 1704 pass, 1 opt-in PDF skip; real `pg_dump` / `pg_restore --list` on the test database, restore mode with a faked process because the app role may not create databases; error log incl. a rolled-back transaction; status rules; retention); Pint clean. vitest 2876; mocked Playwright 532 (new `g1b-operations`).
- Full-stack (PostgreSQL, desktop) 57 — new **G1b**: the platform admin sees the operations page, backs up the real database, checks the backup and sends a test e-mail; an organization owner is refused. It found that on Windows `pg_dump` 18 fails ("could not generate restrict key") when started from the web server, whose environment has no `SystemRoot`; the backup tools now always pass it (with a test). Builder acceptance 5 (fresh database).

#### Upgrade
- `php artisan migrate`. Turn on backups and set the alert addresses (DEPLOYMENT_GUIDE → *Backups and restore*); make sure cron runs `schedule:run` and a queue worker is supervised — *System status* now tells you when either stops.

### G1a — Sign-in security: two-factor sign-in, account lockout, security headers

First part of G1 (go-live essentials) from [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §2. No new packages: the codes are computed in-house (RFC 6238) and the setup QR code uses the existing in-house encoder.

#### Added
- **Two-factor sign-in** with an authenticator app: set up under *Profile → Two-factor sign-in* (password → scan the QR code or type the key → confirm a code → 10 recovery codes to copy or download, shown once), new recovery codes, turn off. At sign-in a second step asks for the 6-digit code or a recovery code; each app code and each recovery code works once. Device tokens take the code in the same request.
- **Organization policy** (*Organization → Security*): two-factor *Optional*, *Required for admins* (people who can manage users, roles or the organization) or *Required for everyone*, with how many have it on and how many still need it. Covered users who have not set it up can only reach the setup screen.
- **Account lockout:** 10 wrong passwords or codes in a row lock the account for 15 minutes (settings `POS_LOCKOUT_MAX_ATTEMPTS`, `POS_LOCKOUT_MINUTES`), even with the right password; the user gets an e-mail. A successful sign-in resets the count; a password reset by e-mail or **Unlock** on the Users page ends the lock.
- **Users page:** "2FA" and "Locked until …" badges; **Unlock** and **Reset two-factor** (lost phone; not on yourself or a more powerful user). Turning two-factor on, off or resetting it e-mails the user; everything is in the audit log, and sign-ins show "Wrong two-factor code" / "Account locked".
- **Security headers** on every Laravel response (nosniff, referrer and permissions policy, HSTS on HTTPS with `POS_HSTS`, API never framed, storefront framed only by the back office) and a checked Content-Security-Policy for the admin app in the deployment guide.

#### Changed
- The `auth` rate limit counts the two-factor step and signed-in password / two-factor changes per account and IP instead of per IP only (staff behind one shop connection no longer share one bucket).

#### Tests
- Backend 1649 (PostgreSQL: 1648 pass, 1 opt-in PDF skip; RFC 6238 test vectors, `TwoFactorSignInTest`, `TwoFactorManagementTest`, `TwoFactorPolicyTest`, `AccountLockoutTest`, `SecurityHeadersTest`); Pint clean. vitest 2850 (incl. a check that the admin CSP hash in the deployment guide matches `index.html`); mocked Playwright 521 (new `g1a-two-factor`; the storefront hot-deals countdown test timed out once under full-suite load and passes 10/10 alone).
- Full-stack (PostgreSQL, desktop) 56 — new **G1a** (in its own newly provisioned organization): the owner turns on two-factor with a real authenticator code computed from the returned secret, signs in with a code and with a recovery code (used once), a replayed code is refused; the policy sends a cashier to setup; ten wrong passwords lock the cashier and the owner unlocks them. Builder acceptance 5 (fresh database). The long "banner and homepage section" flow now has 120 s (one save per section came close to 60 s with the demo stores running alongside).

#### Upgrade
- `php artisan migrate`. Add the admin header block to Nginx (DEPLOYMENT_GUIDE → Security checklist). Rotating `APP_KEY` now turns off everyone's two-factor sign-in.

### Q1 — Quick fixes from the feature gap audit

From [FEATURE_GAP_AUDIT.md](docs/FEATURE_GAP_AUDIT.md) §1 and §7: places where the manual and the software disagreed, plus small loose ends.

#### Fixed
- **Stock count:** the manual told staff to enter the *counted* number in a stock adjustment, but the system added it as a change (a count of 50 on 45 in stock made 95). New **Stock count** reason: enter the counted quantity, see "In stock now" and the difference, and the server posts `counted − on hand` under a row lock, keeping both numbers on the line (batch-tracked items per batch; unchanged lines skipped; nothing to change → a plain message). New adjustment detail page with counted / system / difference. The manual now explains both ways.
- **Add a customer at the till:** the POS customer picker (F4) has **New customer** (name, phone, optional e-mail and address; credit limit only for those who manage customers); a phone that already exists offers "Use this customer".
- **Receipts:** the shop's BIN prints under its name; the title says "Tax invoice" only when a BIN is set, otherwise "Receipt".
- **Coupons on cancelled orders:** cancelling a web order in any way now gives its coupons and offer uses back (once-per-customer coupons can be used again); promotion counts no longer include cancelled orders.
- **Public sign-up is off by default**; the login page shows "Create an account" only when the server allows it, and `/register` explains that sign-up is closed.
- **Offers:** the manual now says automatic offers apply in the online store (offers at the till come with POS1).
- **Money comparisons:** the shared `compareDecimal` helper treated negative amounts by string length (e.g. a due of "-5.00" counted as more than 0); it now compares values exactly (unchanged for positive amounts; tests for negatives).

#### Added
- **Sign-ins** tab on the Audit log page: everyone's sign-ins (who, when, result, device, IP), filters and paging.
- **Remove a supplier from an RFQ** — also after sending, while that supplier hasn't answered (not the last supplier on a sent RFQ).
- The page builder shows "Open the page builder on a bigger screen" on phones instead of a cramped editor.

#### Removed
- Legacy `PUT /storefront/theme` (themes are saved as a draft and published) and unused frontend hooks; the unused `refunds.*` role pattern; a stale test skip.

#### Tests
- Backend 1592 (PostgreSQL: 1591 pass, 1 opt-in PDF skip; new `StockCountTest`, `CancelReleasesPromotionsTest`, `RfqSupplierRemovalTest`, `ReceiptTaxNumberTest`, registration options, a two-connection count lock test, a role-pattern test); Pint clean. vitest 2817; mocked Playwright 508 (new `q1-quick-fixes`; the B18 layout-shift check now ignores the frames right after a late web-font load, which flaked under full-suite load).
- Full-stack (PostgreSQL, desktop) 55 — new **Q1**: sign-up closed by default, a stock count sets the counted number (and a repeat count changes nothing), a cashier adds a customer at the till, the owner sees everyone's sign-ins. Builder acceptance 5 (fresh database). The B20 full-stack test now saves its effects through the theme draft + publish.

#### Upgrade
- `php artisan migrate`. Set `POS_REGISTRATION_ENABLED=true` only if public sign-up is wanted. Clients of `PUT /api/v1/storefront/theme` must use the theme draft + publish.

### B21 — Store builder: Easy building

#### Added
- **Build my page in a minute** (*Build it for me* on the Pages list and on empty pages): 4 steps — page type, what you sell (categories, products or best sellers), what the page should do, look + language (+ AI texts when AI is on, + optional colours from the logo) — assemble a complete **draft** from the shipped sections with the store's own facts: its products, the running sale or coupon, festival texts, its contact details, and **real 4★+ customer reviews only when the store has them** (never sample testimonials). Every result passes the page check; nothing is published.
- **What next?** — three suggested next sections under the last section (and *Suggested next* in Ctrl+K), one click to insert.
- **Try another layout** — the same content in another arrangement (picture left / right / above / behind, 2 / 3 / 4 per row or a list, grid or slider…), with mini previews and Shuffle; nothing is ever lost (tested on 12 section shapes), one undo step each.
- **Drag pictures from the computer** onto the page: replace a picture, add to a gallery, add a picture between parts, or (Shift) use as background — up to 10 at once, uploaded with progress, description suggested from the file name, one undo step.
- **Easy mode** (on the first visit; More options / ⋯ menu to switch), a 6-step **guided tour** (English / Bangla; never pops up over someone already working) and one-line **tips**.
- **Colours from your logo** (Theme page, and an optional wizard step): 2–3 palettes taken from the logo and adjusted for readable text (WCAG AA), saved to the theme draft.

#### Fixed
- The new "What next?" and "Try another layout" code no longer crashes the editor on pages that contain a global section (found by the existing B9 tests; guarded and covered by regression tests).
- The first-visit tour no longer opens over someone who has already started clicking or typing, or over an open dialog.
- Test setup: every browser test starts as a returning builder user on the app and on each demo store's own address (Playwright `storageState`), so first-visit Easy mode and the tour only appear in the specs written for them.

#### Tests
- Backend 1572 (PostgreSQL: 1571 pass, 1 opt-in skip; new `StoreBuilderB21WizardTest` — all 30 page type × goal combinations, `BuilderWizardRecipesTest`); Pint clean. vitest 2786; mocked Playwright 494 (new `store-builder-b21-wizard`, `-easy`, `-drop`).
- Full-stack (PostgreSQL, desktop) 54 — new **B21**: Green Basket goes through the real wizard (sale page, best sellers, Lively look), lands in the editor on a draft with at least three sections and the Lively theme that passes the page check, shoppers still see "Page not found", and the same address is refused the second time. Builder acceptance 5 (fresh database).

#### Upgrade
- No migration. Existing editor users keep the full editor (Easy mode is only the default for people who have never used the builder in that browser).

### B20 — Store builder: Animated graphics

#### Added
- **Animated icons** (new element): 48 original line icons in 9 groups (delivery, payment, returns & trust, offers, time, contact, shopping, love & praise, natural & handmade) — draw themselves, pop, bounce, spin, pulse, wiggle or float, when seen, on hover or looping; size, line weight, colour (theme role or own hex with a contrast hint), background shape, description or decorative. Searchable picker in English and Bangla with live previews. No brand logos.
- **Illustrations** (new element): 8 original animated scenes in the shop's colours — delivery van, shopping bag, sale tag, gift, phone order, parcel journey, happy shopper, Eid lanterns; play when seen, on hover or looping; theme or one-colour palette.
- **Moving backgrounds** (Style → Background, sections and inner rows): flowing gradient, floating shapes, bubbles, sparkles, snow, petals, lanterns, confetti, stars — density, speed, 1–3 colours; decorative only, drawn between the background and its overlay so text contrast is unchanged.
- **Add to cart animation** (Online store → Theme): *Fly to cart*, *Bump the cart* (default, as before) or *None*, and *Button feedback* ("Added" for a moment, button size unchanged) — on product cards, the product page, quick view, the quick-buy bar, "add selected" and bundles.
- Starter sections *Why shop with us* and *Fast delivery to your door* (en + bn). Page check: more than 2 moving backgrounds, more than 6 looping icons, a looping illustration at the top (*Play once when seen*).
- Everything respects *reduce motion*, the Pause animations button and stops off-screen. Drawings load only on pages that use them (none in the store's first load); the fly animation is a 0.8 kB lazy chunk with a bump fallback. No new dependencies.

#### Fixed
- Editor picker tiles (icons, illustrations, moving backgrounds, add-to-cart) could miss a quick tap or click while their preview drawing was still loading; previews now sit in a layer that ignores the pointer.

#### Tests
- Backend 1555 (PostgreSQL: 1554 pass, 1 opt-in skip; new `BuilderB20SchemaTest`, `StoreBuilderB20Test`, theme effects in old / new / draft / preset / bootstrap); Pint clean. vitest 2683; mocked Playwright 482 (new `storefront-graphics-b20`, `storefront-effects-b20`, `store-builder-b20` incl. slow-press and touch-tap tests).
- Full-stack (PostgreSQL, desktop) 53 — new **B20**: Green Basket builds a page from both starters with one described icon (English + Bangla), a bad custom colour is refused, the page publishes; the theme switches to fly-to-cart; shoppers hear the icon's description in both languages, the page fits without sideways scroll, adding a product shows "Added" and fills the cart; the theme is set back. Builder acceptance 5 (fresh database).

#### Upgrade
- No migration. Themes keep their exact settings until the owner chooses an add-to-cart animation; the store behaves as before (bump + "Added") by default.

### B19 — Store builder: Scroll stories

#### Added
- **Scroll effects** (Style → *Scroll*, any part of a page): fade, rise, sink, grow, shrink, rotate, slide in from either side, sharpen from a blur, or wipe in (up, left, circle) while the shopper scrolls — strength (subtle / medium / strong) and when it plays (coming in, while on screen, leaving, both); ▶ *Preview* scrolls the part through the editor once. They work together with B18 entrances and loops on the same part.
- **Backgrounds that move while scrolling:** a section's background picture zooms in / out or moves up / down (replaces its parallax).
- **Slow zoom (Ken Burns)** on images, image carousels and hero sliders (with the Pause animations button).
- **Scroll story** (new element; starter section *Our story in steps*): 2–6 steps, each with a picture, small line, heading, text and link; on computers the picture stays in place and changes with each step as the shopper scrolls, with progress dots; phones, tablets and *reduce motion* get each step with its own picture. Clicking a step on the canvas opens it in the inspector.
- **Horizontal gallery** (new element; starter *Swipe through the collection*): 2–12 pictures or products; on computers the row moves sideways while scrolling down (pinned); phones get a swipe row with previous / next buttons and a progress bar. Products not on sale are left out of the live page.
- **Reading progress bar** (page settings): a thin bar at the top or bottom that grows with the reading position — position, colour and thickness.
- **Page check:** a story step without a picture or description, a scroll effect on the top picture or heading (*Remove scroll effect*), a pinned gallery with more than 8 entries (*Turn off pinning*). Motion themes Lively, Festive and Premium add gentle scroll effects below the first section.
- **Storefront engine:** CSS scroll-driven animations with a 0.8 kB lazy fallback (one passive listener, one animation frame loop, only parts near the screen measured); transform / filter / clip-path only, no layout shift, nothing on the first paint; off under *reduce motion* and while paused. No new dependencies.

#### Tests
- Backend 1537 (PostgreSQL: 1536 pass, 1 opt-in skip; new `BuilderB19SchemaTest`, `StoreBuilderB19Test`, both starters checked in every context); Pint clean. vitest 2612; mocked Playwright 459 (new `storefront-scroll-b19`, `store-builder-b19-scroll`, `store-builder-b19-story`).
- Full-stack (PostgreSQL, desktop) 52 — new **B19**: a Green Basket page built from both starters with a gentle scroll effect and an accent reading bar saves (an out-of-range bar is refused), passes the page check, publishes; on a computer every story step is on the page, the gallery shows its pictures and the reading bar's fill grows while scrolling; on a phone the story is stacked and nothing scrolls sideways. Builder acceptance 5 (fresh database).

#### Upgrade
- No migration, no new setting. Existing parallax keeps working; choosing a moving background replaces it on that section.

### B18 — Store builder: Motion studio

#### Added
- **Motion themes:** *Motion → Motion themes…* animates the whole page in one style — Calm, Lively, Festive, Premium, Minimal — or *Remove all motion*. One undo step; plays the page afterwards; *Keep my own animations* (on by default) leaves motion you set yourself. Themes never animate the first section's pictures or headings (fast first paint), never loop forever and stay under the page-check limits. The document remembers the theme (`motion_theme`).
- **Motion timeline:** for a section (mini toolbar *Motion timeline*, or *Open timeline* in the Motion group): each part's start and length as bars on a ruler — drag (snaps to 50 ms) or use the keyboard (←/→ start, Shift+←/→ length), easing per row, ▶ *Play section*; screen-reader text per row.
- **Motion group rebuilt:** entrance tiles that preview on hover / focus (new: wipe up, wipe left, drop in, swing, scale down), easing chips with a curve (smooth, snappy, gentle, spring, bounce, linear), duration / delay / repeat / stagger, attention loops (new: wiggle, heartbeat, breathe, shine, slow spin), ▶ *Play*; new hover effects: 3D tilt, picture zoom, glare, pop, lift with shadow, shine.
- **Text effects** on headings, texts and call-to-action titles: typewriter, rotating words ("Fresh mango / lychee / dates", Bangla words translatable), word-by-word and letter-by-letter reveal (Bangla conjuncts never split), gradient shimmer, highlight and underline that draw themselves. No layout shift; the full text stays the accessible text.
- **Card hover** on product grids, carousels, tabs, listings, category cards, spotlight and shop the look: lift, picture zoom, 3D tilt, glare, second picture.
- **Moving dividers:** section dividers can flow, drift or pulse; new shapes *layered waves* and *blob*.
- **Editor:** *Motion* menu in the toolbar (themes, *Preview motion* — loops and effects run in the editor only while ticked —, *Play page*). Page check: `MOTION_LCP` (animated top picture or heading, one-click *Remove animation*), `MOTION_TOO_MUCH`, `TEXT_EFFECT_LONG`.
- **Shoppers:** everything respects *reduce motion*; pages with motion longer than 5 seconds show an accessible **Pause animations** button (WCAG 2.2.2), remembered per browser. Motion uses transform, opacity, clip-path, light blur and background position only; text effects are a 2 kB lazy chunk. No new dependencies.

#### Fixed
- **Editor toolbar overflow:** on screens narrower than about 1700 px the last toolbar buttons (including *More page actions* → Version history) were pushed out of reach. Below 1600 px the secondary buttons (Motion, Insights, Comments, A/B tests, Check page, Preview) now show icons only (names kept for screen readers and tooltips), and the toolbar scrolls instead of clipping. Checked at 1280, 1366 and 1600 px.
- Endless loops (`loop_forever`, from B9) had no way to pause them; the new Pause animations button covers them.

#### Tests
- Backend 1520 (PostgreSQL: 1519 pass, 1 opt-in skip; new `BuilderB18SchemaTest`, `StoreBuilderB18Test`); Pint clean. vitest 2538; mocked Playwright 444 + 1 mobile layout test that timed out under load (passes 3 / 3 alone) (new `storefront-motion-b18`, `store-builder-b18-motion`, `store-builder-b18-themes`).
- Full-stack (PostgreSQL, desktop) 51 — new **B18**: a Green Basket campaign page with rotating words in English and Bangla saves with its motion theme, letter-by-letter on a long heading is refused, the page check flags the animated top heading, the shopper pauses the motion (remembered after a reload), and with *reduce motion* nothing runs and there is no pause button. Builder acceptance 5.

#### Upgrade
- No migration, no new setting. Published pages keep their motion unchanged until edited.

### AI2b — Shop assistant on the online store

Optional and **off by default**: each store switches it on in *Online store → Assistant*. Same AI switch, key and monthly budget as AI1/AI2a. Details: [AI_INTEGRATION.md](docs/AI_INTEGRATION.md#ai2b--shopper-support-assistant-as-built-2026-11-20).

#### Added
- **Store chat:** a chat button on the store (its own lazy chunk; stacks above the WhatsApp button; side panel on computers, full screen on phones; English / Bangla; reduced motion; never in the builder or previews). Greeting, suggested questions, answers with product cards and links to the store's own pages, "Talk to a person" (WhatsApp with the question prefilled, or the contact page), "AI assistant — answers can be wrong", New chat; the conversation comes back when the shopper returns.
- **What it knows** (read-only tools, store's organization only): product search and details (storefront prices with promotions, in stock yes / no, options), delivery areas, fees and times, payment methods, return rules, store contact, FAQ and published pages, live automatic offers (never coupon codes); for **signed-in shoppers only**, their own recent orders and order status (another customer's order and an unknown number both answer "not found"; no address, phone or e-mail).
- **Safety:** shopper text and tool results are data, not instructions; the server keeps only links to products and own-store pages the tools returned (anything else is reduced to its label) and builds the cards itself; no invented prices, discounts or promises; tracking via the shopper's order page. Limits: 500 characters per message, 20 messages per chat, a daily new-chat limit per store (200), 10/min and 60/h per IP, the monthly budget — over a limit, with AI off or on provider errors the shopper gets a polite message and the hand-off.
- **Admin:** *Online store → Assistant* — switch, name, greeting (English / Bangla), new chats per day, hand-off; summary (chats, hand-off share, standard replies, most used lookups); chats list with search and a transcript drawer (lookups used per reply; customer name only with `customers.view`). Chats are kept 30 days (`storefront:prune-assistant`); only a hash of the browser's chat token is stored — no IP or user agent.
- AI plumbing: `ToolLoop` takes a per-call effort and token limit; usage feature `store_assistant`; new read contracts `PageContent::searchHelp` / `templatePage`, `PromotionShowcase::liveAutomatic`, `CustomerOrderStatus`, `StorefrontConfig::shopperFacts`, `StoreAssistantSettings`.

#### Tests
- Backend 1506 (PostgreSQL: 1505 pass, 1 opt-in skip; new `StoreAssistantTest`, `StoreAssistantSettingsTest`, `AssistantConversationsAdminTest`, `ShopperToolsTest`, `ShopperReplyTextTest`); Pint clean. vitest 2445; mocked Playwright 434 (new `storefront-assistant-ai2b`, `storefront-assistant-admin-ai2b`).
- Full-stack (PostgreSQL, desktop, AI off): 50 + builder acceptance 5. Opt-in AI full-stack (`e2e/ai-fullstack.spec.ts`, Fake provider, demo stores) 2 — new **AI2b**: the owner switches the assistant on, a guest asks a suggested question and gets an answer, the chat comes back after a reload, staff read it (no personal data for a guest), usage counts it, and switching it off removes the button.
- Not verified against the live API (no key on the dev box).

#### Upgrade
- `php artisan migrate` (assistant columns on `storefront_settings`, `assistant_conversations`, `assistant_messages`). The scheduler runs `storefront:prune-assistant` daily. Never cache `/api/v1/store/assistant/*`; keep `TRUSTED_PROXIES` right (per-IP limits). Optional env `AI_STORE_ASSISTANT_PER_MINUTE` (10), `AI_STORE_ASSISTANT_PER_HOUR` (60).

### AI2a — Online store AI for staff: write with AI, AI drafts, category suggestions, bundle ideas

Optional, behind the AI1 switch, key and monthly budget. Everything the model writes is a suggestion or a draft staff approve; the normal listing actions save it; nothing is published by the model. Details: [AI_INTEGRATION.md](docs/AI_INTEGRATION.md#ai2a--online-store-texts-for-staff-as-built-2026-11-20).

#### Added
- **Write with AI** on the product online listing (descriptions; search engine texts) and in the category / brand listing dialogs: English, Bangla or both, tone, length and staff notes. Suggestions appear next to the current texts, ticked per field; *Use selected* fills the unsaved form (with Undo). The model gets catalog facts only (no prices, stock, costs, suppliers, SKUs or sales), must not invent facts, and lists what is missing ("Things to add"). The server builds and sanitizes the description HTML and clamps texts to the field limits.
- **Online store → AI help** (`/storefront/ai`): **Drafts** — write drafts for up to 200 products, categories or brands at once (chosen ones, or those missing a description, SEO or Bangla) on the queue, with progress and cancel; review side by side, edit, approve (only the chosen fields; warned when the text changed since), reject, approve several; *Write AI drafts* bulk action on the products list. **Categories** — suggestions for products without a category, only from the store's own categories (the model answers with refs, never ids), with confidence and reason; *Apply* needs `products.manage` and is audited on the product. **Bundle ideas** — top co-purchased partners from the nightly scores, *Describe with AI* (title and pitch, Bangla when on), *Add to frequently bought together*.
- AI plumbing: structured JSON answers (`output_config.format` json_schema) in the Claude adapter, Shared `AiJsonWriter` contract, Fake provider JSON (scripted or synthesized from the schema, so `AI_PROVIDER=fake` works end to end). New usage features `catalog_writer`, `catalog_drafts`, `category_suggestions`, `bundle_ideas` on the AI usage card.

#### Fixed
- `ListExportTest::test_exports_are_audited` failed about once in 250 runs: its search term also matched the random customer code of the other customer. The test now searches a full name.

#### Tests
- Backend 1476 (PostgreSQL: 1475 pass, 1 opt-in skip; new `AiJsonWriterTest`, `CatalogAiWriterTest`, `AiDraftsTest`, `CategorySuggestionsTest`, `BundleIdeasTest`, structured-output request test); Pint clean. vitest 2414; mocked Playwright 426 (new `listing-ai-writer`, `online-ai-ai2a`).
- Full-stack (PostgreSQL, desktop) 50 + builder acceptance 5, with AI off. New opt-in **AI2a** full-stack test (`e2e/ai-fullstack.spec.ts`; backend started with `E2E_AI=true`, Fake provider): Write with AI fills and saves a listing, an AI draft batch is approved from the AI help page, a category suggestion is applied, a bundle idea is described and added.
- Not verified against the live API (no key on the dev box).

#### Upgrade
- `php artisan migrate` (`ai_content_batches`, `ai_content_drafts`). A queue worker runs AI draft batches; the scheduler runs `online-catalog:prune-ai-drafts` daily. No new permission.

### B16 — Store builder: teamwork & safety

#### Added
- **One editor at a time:** the editor shows who else is on the page (initials; editing / viewing) and holds an edit lease while someone edits (heartbeat every 20 s; viewers expire after 60 s, the lease after 90 s; released on leave). Everyone else gets a view-only page with "*Rima is editing this page*" — **Ask to edit** (bell to the editor) or **Take over** (publishers, or anyone once the lease has lapsed; the previous editor is told and their unsaved changes stay copyable). Draft-writing calls by anyone else are refused with 423 `DOCUMENT_LOCKED` — draft saves, publish, discard, restore, delete, checkpoints, approval requests, publish later, A/B test actions, banner edits, B12 copy-to-pages, B17 festival setup, imports and address changes.
- **Comments pinned on the page:** a Comments mode (toolbar, or **C** on the selection) drops numbered pins on sections / elements or comments on the whole page; threads with one level of replies, edit (author, 15 min), resolve / reopen, delete (author or publisher); `@name` mentions with autocomplete. Mentions and replies ring the bell with a link that opens the editor at the comment. Comments on removed parts stay listed. Shoppers never see comments.
- **Activity:** an Activity tab in Version history — created, renamed, published (with version links), publish later, approvals, checkpoints, restores, A/B tests, take-overs, comments resolved — plus edit sessions ("*Edited the draft (12 saves)*": saves are grouped per person with a 15-minute gap, not audited one by one).
- **Export / import:** ⋯ → **Download a copy (.json)** (pictures embedded, ≤ 25 MB; products, categories, brands, banners, menus referenced by SKU / slug; campaign audience rules dropped; no customer data). Pages → **Import a page…** brings a copy in as a new campaign page or over the draft of a page of the same kind, with a plain report of what was brought over, what isn't in this shop and what was left out. Pictures are re-used by checksum; imports never publish.
- **Redirects:** when the address of a campaign page, content page, blog post, product, category or brand changes, the old address forwards to the new one (301; chains collapse, loops are dropped, an address that becomes live again stops forwarding). Campaign pages get **Change address…** in the editor. New *Online store → Redirects* page: list with search and source (automatic / added by you), hits and last used, add / edit / delete (301 or 302, a site path or an outside link), test a path, CSV. The server answers old addresses with a real 301/302 (query kept) — only when nothing live sits at that address — and the storefront's not-found page asks `GET /store/redirects/resolve` for client-side navigations.

#### Changed
- Shared: `AuditHistory` contract (a subject's audit entries), `PublicAddressChanged` event dispatched by the Cms and OnlineCatalog save actions when a public slug changes. `MediaLibrary::originalFile`, `StorefrontCatalog::portableReferences` / `findPortable`.

#### Tests
- Backend 1444 (PostgreSQL: 1443 pass, 1 opt-in skip; new `StoreBuilderB16CollaborationTest`, `BuilderPortabilityB16Test`, `StorefrontRedirectsB16Test`; `ExportableListsTest` covers the redirects list); Pint clean. vitest 2377; mocked Playwright 412 (new `store-builder-b16`, `storefront-redirects-b16`).
- Full-stack (PostgreSQL, desktop) 50 — new **B16**: while the owner edits, a staff editor sees the lock and is refused (423), can't take over without publishing rights but can ask; her comment mentioning the owner rings the owner's bell; the owner leaves and she can edit; the page's activity lists published / edited / comment resolved; an exported copy imports as a new unpublished page with the same text; after *Change address* the old address lands on the new one, and a hand-made redirect does too. Builder acceptance 5.

#### Upgrade
- `php artisan migrate` (`builder_comments`, `builder_edit_sessions`, `storefront_redirects`). Presence and edit leases live in the cache: production needs a shared cache store that supports atomic locks (Redis or database — not `file` across several app servers, not `array`).

### B14 — Store builder: design the whole store

#### Added
- **Store pages** (Pages list → *Store pages*): design the Shop, Category, Brand, Search, Blog post, Order / thank-you and Page-not-found pages with the builder, starting from a ready Bangla design or empty. Published designs replace the standard pages everywhere; *Use the standard page* switches back and keeps the design as a draft. Search titles, descriptions, canonical links, noindex and 404 status stay as they are; any loading problem falls back to the standard page.
- **Main parts:** each store page keeps its own — *Product listing* (the real listing with filters, sort, count and pagination / load more), *Blog post*, *Order details* (still loaded privately in the shopper's browser) or *Page not found message* — exactly once and visible, or publishing stops with a plain message; the page check offers *Add it* / *Select it*.
- **Text from this page:** live text from the page — category / brand name, description and product count, search words and result count, post title, author, date and reading time, order number, status, total, first name, payment and delivery time, the store's name, phone, e-mail and address — with words before / after and a fallback.
- **Product listing on any page:** all products, chosen categories or brands (several at once — `GET /store/products` accepts `categories[]`), on sale or new arrivals; filters on / off, filters in a sidebar, on top or in a drawer, columns per device, page size.
- **Preview with:** the editor previews a store page with a chosen category, brand, search, blog post or order (personal details masked; or a made-up sample order). The section library works on store pages.

#### Fixed
- Page builder: the React Compiler again optimizes the editor (a toolbar prop built as an inline element had made it skip the whole component).

#### Tests
- Backend 1428 (PostgreSQL: 1427 pass, 1 opt-in skip; new `StoreBuilderB14Test`, `StoreBuilderB14OrderSampleTest`, `BuilderB14SchemaTest`); Pint clean. vitest 2332; mocked Playwright 400 + 1 reduced-motion zoom test that timed out under the full run's load (passes 6 / 6 alone) (new `storefront-templates-b14`, `store-builder-b14`).
- Full-stack (PostgreSQL, desktop) 49 — new **B14**: a store's category and not-found pages designed from the starters show to shoppers with the real products and the designed 404, publishing without the main part is refused, sorting lives in the address, and *Use the standard page* brings the standard category page back. Builder acceptance 5.

#### Upgrade
- No migration; `php artisan cache:clear` makes published store page designs take effect at once.

### B13 — Store builder: the right content for each shopper, A/B tests

#### Added
- **Who sees this** (Advanced tab of any section, element or global reference): rules for new / returning visitors, signed in / guest, device, districts, campaigns or link sources, cart value (৳), days and times (store time, can cross midnight) and language; all or any; read back as one plain sentence; an always-visible note that it is not a lock for secret prices or codes. Badges on the canvas and in Layers. Rules run in the shopper's browser (pages stay cacheable) and a section with rules appears only once it is known to apply — no flash.
- **Preview as:** pick a kind of shopper (new / returning, account, device, district, campaign, cart, day and time, language) and the canvas fades what they wouldn't see.
- **A/B tests:** section ⋯ *Test a different version* makes version B next to A; the *A/B tests* panel sets the goal (orders, add-to-cart, clicks) and split, starts / stops (live on publish) and shows honest plain-word results ("Version B gets 23 % more orders — 96 % sure it's better", "Too early to tell" until each version has 100 visitors and 10 goal events), a per-day chart and *Keep A / Keep B* (removes the other version from the draft). Shoppers keep their version on later visits; Do-Not-Track / GPC → version A and not counted.
- API: `audience` and `experiments` in builder documents, results and start / stop / keep endpoints, `audience_campaigns`, `experiments` and `timezone` on render payloads, `store.timezone` on bootstrap (see API docs).

#### Tests
- Backend 1416 (PostgreSQL: 1415 pass, 1 opt-in skip; new `StoreBuilderB13Test`, `BuilderB13SchemaTest`, `ExperimentResultsTest`, `ExperimentMathsTest`); Pint clean. vitest 2286; mocked Playwright 387 (new `storefront-audience-b13`, `store-builder-b13a`, `store-builder-b13b`).
- Full-stack (PostgreSQL, desktop) 48 — new **B13**: a members-only section stays hidden for a guest, a malformed rule is refused, a started and published A/B test shows a shopper put in version B only that version and reports `arms: B`, the results count the visitor under B with "keep running", and Keep B leaves only version B in the draft with the test ended. Builder acceptance 5.

#### Upgrade
- `php artisan migrate` (A/B test tables).

### B15 — Store builder: know what works

#### Added
- **Insights for every builder page** (toolbar *Insights*): a plain headline ("1,240 people saw this page; 38 ordered (3.1 %)"), people / orders and revenue / clicks / scroll tiles, a daily views-or-orders chart with publish markers and a table view, every section's seen / clicked / orders, speed traffic lights (LCP, CLS, INP from real visits), 7 / 30 / 90 days or own dates, by device. Pages list: *Views (30 days)* and *Orders* columns, sortable.
- **Heat map:** clicks drawn over the canvas per section (single-blue scale with legend), "72 % reached here" markers between sections, and *Clicks as a list* for screen readers.
- **Orders per page and section:** the page and section a shopper clicked through to a product travel with add-to-cart, checkout and the order form (`attribution.builder`); insights count orders and revenue per page and section.
- **Speed:** page check *Speed* group with a 0–100 score and Fix it (smaller pictures, video lower down, fewer fonts, fewer slideshows / embeds, scripts in custom HTML, long pages); the storefront now loads the first picture of the first screen first and lazy-loads the rest, with reserved space so the page doesn't jump.
- **Privacy:** anonymous beacons only (`POST /store/insights/events`) — no cookies, no personal data, no IP or user agent stored, daily counts kept 90 days; Do-Not-Track / Global Privacy Control, drafts, staff previews and the builder are never counted.

#### Fixed
- Page builder: Escape that reached the editor from the canvas didn't close the command box or the shortcut sheet; `store-builder-b12a` command-box test waited too little for the command box to close (it took the next Escape while fading out) — now 10 / 10.

#### Tests
- Backend 1403 (PostgreSQL: 1402 pass, 1 opt-in skip; new `PageInsightsTest`, `WebVitalsTest`); Pint clean. vitest 2210; mocked Playwright 369 + the fixed command-box test (new `storefront-insights-b15`, `store-builder-b15`, `store-builder-b15-speed`).
- Full-stack (PostgreSQL, desktop) 47 — new **B15**: a shopper's visit, scroll and click on a published campaign page reach the server as anonymous beacons (no e-mail, phone or cookie in them), and the page's views, section clicks, heat map and scroll reach go up; the Insights panel shows the figures. Builder acceptance 5.

#### Upgrade
- `php artisan migrate` (insight tables, `carts.builder_attribution`); the scheduler runs `marketing:prune-page-insights` daily.

### B17 — Store builder: festival packs & Bangladesh trust blocks

#### Added
- **Festival packs:** 10 occasions — Eid-ul-Fitr, Eid-ul-Adha, Ramadan, Durga Puja, Pohela Boishakh, 21 February (Ekushey), Independence Day, Victory Day, winter sale, 11.11 — each with a campaign page, a home banner and a top bar (30 built-in templates, category *Festivals*). No photos: drawn ornaments, festival colours, countdowns and the store's own products; every text in Bangla; every colour pair passes WCAG AA under all looks. Ekushey is a tribute (no sale wording or elements); Independence and Victory Day are dignified with a modest offer.
- **Online store → Festivals:** the next 12 months' occasions with their dates (Eid / Ramadan / Puja from a sourced 2026–2028 table, marked *expected*), a setup dialog (dates, what to create, a discount) and *Review & publish*. Setup (`POST /storefront/festivals/{key}/setup`) writes drafts only: the campaign page, hero sections on top of the home page that show only between the dates, and a top bar with the same dates; countdowns end with the campaign; a repeat setup rewrites the same drafts. After *Publish all* everything appears and disappears by itself.
- **New elements:** *Ornament* (16 original drawings — crescent & star, lantern, alpona, kash flower, dhak, diya, shapla, flag ribbon, Shaheed Minar …), *Payment badges* (the store's checkout methods plus bKash / Nagad / Rocket / Upay as text badges — never brand logos), *Delivery promise* (zones, days, fee, free-delivery threshold and cash on delivery from the shipping settings), *Bangla date* (today in the Bangladesh revised Bengali calendar, optional Gregorian and Hijri). *Trust badges* take up to 8 items with links and work in popups.

#### Fixed
- A new trust badge started with an invalid icon ("Choose an icon" on every new badge).

#### Tests
- Backend 1394 (PostgreSQL: 1393 pass, 1 opt-in skip): new `BuilderB17SchemaTest`, `StoreBuilderB17Test`, `BuilderFestivalTemplatesTest` (all 30 templates validated, contrast, Bangla, respectful wording, setup with every pack); Pint clean. vitest 2148; mocked Playwright 353 + 3 that timed out under the full run's load and pass on rerun (storefront-social share, forms bell, storefront-builder "mobile 375" — still load-sensitive). Builder acceptance 5.
- Full-stack (PostgreSQL, desktop) 46: new **B17** test — the calendar lists Victory Day and marks Ekushey without sale wording; the Festivals page shows it; setup makes three drafts that stay hidden until *Publish all*; then the campaign page, the scheduled home banner and the top bar show; a second setup reuses the same drafts.

#### Upgrade
- `php artisan migrate` (`storefront_festival_setups`).

### B12 — Store builder: faster building

#### Added
- **Select several items:** Ctrl/Cmd+click toggles, Shift+click adds the siblings in between (canvas and Layers; in the order shown, also on tablet/phone). A blue "N selected" bar offers Move up/down as a block, Duplicate all, Copy all, Hide/Show all, Delete all (one confirmation), copy/paste style, wrap in an inner row or a new section. Each group action is one undo step; actions that need items side by side explain why they are unavailable.
- **Common style:** with several selected, the inspector shows only the style parts they all support, "Mixed" where they differ, and changes all of them for the current device. **Line up:** align text, place blocks left/centre/right, equal spacing (value), same width (columns share the row equally).
- **Ctrl+K command box** (also from the canvas): add an element or template, go to anything on the page, open another page, or run an action — English and Bangla words, recent first, keyboard only if you like.
- **Snapping:** spacing grips snap to the section above/below and common sizes with a dashed guide and a badge; column handles snap to halves, thirds, quarters and the other columns. Alt drags freely.
- **Order on phones and tablets:** sections and the items inside a column can have their own order per device (`device_order`). In Tablet/Mobile view Move up/down, drag in the Layers panel and the canvas change only that device ("Same as computer" resets); shoppers' pages are rendered in that order, so reading and Tab order match what they see. Compare lists "Moved on phones/tablets".
- **Copy to other pages:** a section's ⋯ menu copies it to the top or bottom of up to 20 pages' drafts at once (`POST /storefront/builder/sections/copy`), with a result per page; nothing is published.
- **Keyboard shortcuts sheet** (`?`) and an **undo history that survives a reload** (per page; reset with a note if the page was changed elsewhere).

#### Fixed
- A typecheck error in a media test shipped with B11 (`getByRole` has no `exact` option).

#### Tests
- Backend 1260 (PostgreSQL: 1259 pass, 1 opt-in skip; new `BuilderB12DeviceOrderTest`, `StoreBuilderB12Test`); Pint clean; vitest 2103; mocked Playwright 347 + the B12 command-box test (passes 12/12 alone; it timed out once while three test runs shared the machine); new `store-builder-b12a/b12b`, `storefront-builder-b12` specs.
- Full-stack (PostgreSQL, desktop) 45 + builder acceptance 5 — new **B12** test: a published page shows its sections in a different order on a 375 px phone than on a computer, a malformed order is refused, one section is copied to two pages (an unknown page fails on its own), Ctrl+K adds a heading and Ctrl+click selects two headings.

#### Notes
- No migration and no new dependency. The builder's code chunk is now 565 kB (it grows with the editor; lazy-loading the command box and dialogs is a candidate for later).

### B11 — Store builder: publish later, versions & approval; picture tools; five new demo looks

#### Added
- **Publish later:** the publish dialog offers *Publish now | Publish later* (date and time in store time); the snapshot taken then goes live on time through `storefront:publish-scheduled` (every minute, once only) as a normal version. A toolbar / Pages-list badge shows "Goes live …" with change-the-time and cancel; if records the page uses were deleted meanwhile nothing is published and the scheduler gets a bell notification with the reason. Publishing now while a publish is planned offers to cancel it (ticked) so an older snapshot can't replace a newer fix. The theme (Theme page and builder Site styles) can be scheduled too.
- **Versions & saved copies:** versions can be named; *Save a named copy* keeps an unpublished snapshot of the draft (20 per page) that can be restored like a version. **Compare** shows two read-only previews side by side (desktop / tablet / phone, scrolling together) with a plain list of what was added, removed, moved or changed and *Show* to point at it.
- **Approval:** staff who may edit but not publish see *Submit for review*; publishers get a bell notification and a *Waiting for approval* tab on the Pages list (the link opens the review). The review shows live and proposed side by side with the change list; *Approve and publish now* (or at a time) or *Send back…* with a required comment; the submitter is notified and can withdraw. The permission split decides who must ask.
- **Picture tools** (media library and picker, *Edit picture*): crop (free, 1:1, 4:5, 16:9, 3:2), turn and mirror, brightness / contrast / colour strength, and a **focal point** that every storefront picture cropped by its frame keeps in view (banners, builder images, galleries, cards, popups). Saved as a new copy by default; replacing the original lists where it is used and needs confirmation. Uploads over 2560 px are scaled down, phone photos turned upright and metadata removed; big JPEG/PNG get a full-size WebP copy. `php artisan media:optimize` does the same for older pictures.
- **Five new demo looks:** *Fashion Boutique* (Loom & Lane), *Electronics Store* (Circuit Bazar), *Supermarket* (Bazar Fresh, Bangla fonts), *Beauty & Cosmetics* (Blush & Bloom), *Furniture & Home* (Kath & Home) — theme presets (WCAG AA), site templates with Bangla and 8 section templates each, and demo stores (`<preset>.shop.localhost`, `owner@<preset>.test`) with 12 products, natural variants, coupon, reviews, blog and Bangla. Per the owner's request the demos stay light: exactly 10 Unsplash photos per store (≈ 4.4 MB in all, reused for banners and tiles), only a thumbnail and a tall preview per look, no section thumbnails (the template browser draws a sketch with name and category). The demo gallery shows 9 stores.

#### Fixed
- `MarketingTest` visitor-hash pruning failed late in the UTC evening (the hashes' day is the store's Dhaka date); the live prune was correct, the test now travels far enough.
- `storefront-builder.spec.ts` "mobile 375" measured a gap while an on-demand font was swapping in; it now waits for a steady layout.
- Picture editor: the disabled button read "Save focal point" before anything changed; it now reads "Save".
- Media editing no longer changes PHP's time limit in console runs (it cut long test runs and workers at 120 s).

#### Tests
- Backend 1251 (PostgreSQL: 1250 pass, 1 opt-in skip; new `StoreBuilderB11PublishingTest`, `BuilderDiffTest`, `MediaEditorTest`, demo looks / preset / template / seeder checks); Pint clean.
- vitest 2021; mocked Playwright 338 pass (new `store-builder-b11`, `media-editor`, `storefront-demos-b11`).
- Full-stack (PostgreSQL, desktop) 44 — new **B11**: the five looks open on their own hosts; a staff editor without publish rights is refused publishing, submits from the builder, the owner approves from the review link and shoppers see it with the edited photo's focal point; a page set to publish later stays hidden and goes live when the scheduler runs (`via: scheduled`). Builder acceptance 5.

#### Upgrade
- `php artisan migrate` (builder schedules, reviews, saved copies; media focal point and edit source). **Run the scheduler** (`schedule:run` every minute) — scheduled pages go live only through it. Optional: `php artisan media:optimize --dry-run`, then without it. Demo databases: `php artisan db:seed --class=DemoThemesSeeder` adds the five new stores.

### B10 — Store builder: edit on the page, page check before publish, fonts & Bangla typography

#### Added
- **Edit on the page:** double-click a text (or Enter / *Edit text* in the mini toolbar) and type straight on the canvas. Headings, text, buttons, list items, icon boxes, pricing features… — the editable fields come from the registry's translatable fields. Rich text gets a small format bar (bold, italic, link via a checked URL prompt, bulleted / numbered list, clear formatting), sanitized to the server's allowed tags. Esc cancels; Tab, click outside or leaving the canvas keeps the change; each edit is one undo step. Plain text over its limit is cut with a note; a value the document rules refuse is not applied (plain message). Text inside a global section points to the global.
- **Edit in: English | বাংলা** in the toolbar (stores with Bangla): the canvas switches language and fonts; Bangla edits go to `translations.bn`.
- **Drop a picture** from the computer onto an image or a section / row / column background: checked (JPEG, PNG, WebP, GIF ≤ 5 MB), uploaded to the media library with a progress bar on the node, set for the current device; double-click a picture or *Replace picture* opens the media chooser.
- **Spacing handles:** grips on the top and bottom edge of the selected section, inner row or column change its padding (Alt: margin) for the current device, snapping to 4 px with a live value badge; arrow keys move 4 px; one undo step per drag.
- **Quick bar:** text alignment and text colour (theme colours, store palette or any colour) for text elements, written to the current device.
- **Check page:** toolbar button with a count badge (red with errors) and a panel grouped into errors, warnings and tips, each with *Fix it* (selects the item and focuses the field, applies a fix such as a readable theme colour, or opens Site styles). Client checks run live: missing or empty link, button without text, picture without description, heading order, contrast below WCAG AA where the page sets colours, hidden on every device, empty section / heading / text, phone text under 14 px, oversized pictures, missing SEO title / description. Server check `POST /storefront/builder/documents/{id}/check` (saved draft or unsaved content; nothing saved): links to pages, products, categories, brands, landing pages and blog posts that are gone or not live, deleted / hidden / inactive records, unpublished or missing global sections, order forms whose product is off sale, forms nobody receives.
- **Publish dialog** runs the check on what is about to go live and shows *N errors, M warnings* with the first errors; publishing is never blocked (*Publish anyway*); a failed server check says so with a retry.
- **Bangla typography:** heading and body fonts gain Hind Siliguri, Noto Sans Bengali, Anek Bangla, Tiro Bangla and Baloo Da 2 (`@fontsource` 5.3.0); separate Bangla heading / body fonts (`typography.bangla_heading_font` / `bangla_body_font`, *Automatic* = today's look), Bangla line spacing (1.4–2.0, default 1.7) and size (0.9–1.2). Font pickers show an English and a Bangla sample.
- **Your own fonts:** upload up to 4 WOFF2 fonts per store (≤ 500 KB, name, weight range; file checked by its WOFF2 header, duplicates refused) and use them for any font role; delete is refused while the live theme or the draft uses the font (409 `FONT_IN_USE`). `GET/POST /storefront/fonts`, `DELETE /storefront/fonts/{id}`; new table `storefront_fonts`; audited.

#### Changed
- **Fonts load on demand:** the storefront downloads only the fonts its theme uses (each font is its own CSS chunk; the body font is preloaded; uploaded fonts get `@font-face` with `font-display: swap`). The admin Theme page and builder load font samples only when shown.
- Theme payloads (`bootstrap.theme.fonts`, theme draft responses) list the effective fonts and the uploaded fonts in use.

#### Fixed
- Page builder: a click on the canvas blurred the canvas itself, which would have cancelled in-place editing on a double-click.

#### Tests
- Backend 1169 (PostgreSQL: 1168 pass, 1 opt-in skip; new `StoreBuilderB10Test`, `ThemeFontsTest`); Pint clean.
- vitest 1982 (new: canvas in-place editing, fonts, inline edit, media upload, spacing drag, editor B10, page check, inspector focus, typography); mocked Playwright 315 pass / 171 skipped (new `storefront-builder-b10.spec.ts`, `store-builder-b10.spec.ts`, B10 cases in `store-builder.spec.ts`).
- Full-stack (PostgreSQL, desktop): `integration.spec.ts` + `demo-stores.spec.ts` 42 — new **B10**: a broken product link found by the server check (and not in unsaved content that fixes it), a heading typed on the canvas, *Publish anyway* past the check, a real WOFF2 upload (a non-font refused), Bangla fonts published, `FONT_IN_USE`, shoppers get the store's font face and download no unused font; builder acceptance 5.
- Note: under heavy load `storefront-landing.test.tsx` (COD order form) can time out in the full vitest run and `storefront-builder.spec.ts` "mobile 375" once measured a gap during a font swap; both pass alone and on rerun.

#### Upgrade
- `php artisan migrate` (adds `storefront_fonts`). Existing themes need no change — the new keys read with their defaults and the look is unchanged.
- Uploaded fonts live on the media disk at `fonts/<org>/<id>.woff2`. On a local disk let the web server send long-cache headers for `/storage/fonts/*`; on a CDN / bucket allow CORS for fonts (cross-origin `@font-face` needs it).

### Phase 9 — Polish and hardening (part 1)

#### Fixed
- **Lost form input under load:** a failed background refresh of the signed-in session (slow or overloaded server) replaced the whole app with "Could not load your session", unmounting open forms — the "new product form lost typed values" report. The session guard now keeps the last good session and shows the error only when there is no session at all; the product, purchase order and goods receipt editors likewise keep their form when a refresh fails. Regression test proves the old behaviour failed.
- **Phone layout:** tables inside a scroll box (e.g. the product's online listing variants) no longer widen admin pages on phones — the scroll box is now the positioning container of their screen-reader-only labels (one global rule for every admin table).
- **Storefront:** on phones the share row keeps the floating WhatsApp button's corner free, so no share button hides under it.
- **Page builder:** the selected item's mini toolbar uses its real width (it no longer runs off the canvas) and, for a section at the very top of the page, goes below it or into its top-right corner instead of over its first heading.

#### Security
- `npm audit`: 3 high and 6 total advisories → **0 in production dependencies**. `shadcn` updated to 4.23.0 (provenance-signed, released 19 days earlier; transitive versions resolved with `--before` to avoid releases under two weeks old) and moved to devDependencies — it is a build-time tool whose CSS is bundled, none of its JavaScript ships. Remaining dev-only advisories (deepmerge, minimatch via ts-morph in the shadcn CLI) have no fix within its dependency ranges and never reach the browser.

#### Tests
- vitest 1891; mocked Playwright 302 (all); full-stack builder acceptance 5. Note: two countdown tests in `storefront-promotions.test.tsx` can time out when the machine is heavily loaded; they pass on their own and in a normal full run.

### B9 — Store builder: global sections, AI writer, copy & paste, page SEO, more animation

#### Added
- **Global sections:** make any section global (or start a blank one), insert it from the editor's **Global** tab on pages, content pages, shop areas, the header or the footer; edit it once and publish — every page shows the new version. "Used on N pages", **Detach** (a normal copy), delete only when no page uses it (the start screen lists the pages to clear). Forms and order forms inside a global keep working.
- **AI writer:** *Write with AI* on any element with text, *Write this section*, *Translate to Bangla* — instruction, language and tone; review each text before *Use these texts* (one undo step); Bangla goes into the Bangla fields. Needs AI switched on (the reason is shown otherwise); counted against the AI budget.
- **Copy & paste across pages:** sections, inner rows and elements to any page, header or footer (Ctrl/Cmd+C / V, also from the canvas), new ids, translations and references kept, refused with a plain reason where an element isn't allowed; **Copy style / Paste style**.
- **Page settings → Search & sharing:** title, description (counters), share picture, Bangla, *hide from search engines*, with live Google result and Facebook/WhatsApp card previews; used by the server-rendered HTML and the app.
- **More animation:** five new entrances (flip, flip sideways, bounce, blur, rotate), *play every time*, elements inside appearing one after another, attention loops (pulse, float, shake, glow — three times unless kept repeating), hover effects (lift, grow, shrink, tilt, glow, underline) and a slower-scrolling section background picture; all off for visitors who prefer reduced motion.

#### Upgrade
- `php artisan migrate` (adds `builder_documents.context`). No new permissions.

#### Tests
- Backend 1159 on PostgreSQL (1158 pass, 1 opt-in skip), Pint clean; vitest 1885; mocked Playwright `store-builder.spec.ts`, `store-builder-b9.spec.ts`, `storefront-builder-b9.spec.ts`; full-stack integration 24 + demo stores 17 (+1 B9: a global section on a campaign page updates everywhere when published, deleting it in use is refused, page SEO in the server HTML for a campaign page and a designed content page) + builder acceptance 5 (the acceptance spec now clicks a node's corner, since the wider mini toolbar can cover the middle of a short heading).

### P2b — Social media: share buttons, WhatsApp, product feeds, Facebook & Instagram posting

#### Added
- **Share bar** on product pages, campaign pages and blog posts: the phone's own share sheet on touch screens, otherwise Facebook, Messenger (phones), WhatsApp, X, Pinterest and Copy link; shared links are tagged (`utm_source=<network>`, `copy_link`, `native_share`; `utm_medium=share`) so campaign stats count them. Better link previews (`twitter:card`, campaign page `og:image` / `og:description`, image alt texts).
- **WhatsApp:** store number in *Online store → Settings*; **Order on WhatsApp** on the product page (prefilled product, option, quantity, price and link in the shopper's language) and an optional floating chat button that never covers the quick-buy bar, popups or the footer.
- **Product feeds** for the Facebook/Instagram Shop (Meta), TikTok and Pinterest (*Marketing → Product feeds*): one item per live variant, XML and CSV, Bangla variant, private rotatable addresses, step-by-step "where to paste this".
- **Facebook & Instagram posting** (*Marketing → Social posts*, new `Social` module): practice (sandbox) mode out of the box, live mode with a Meta app (Facebook Login, encrypted tokens, `appsecret_proof`, the secret never in a URL); posts from a product with photos, caption suggestions (AI when on, ready-made otherwise; English or Bangla), a tracked short link per network, post now / schedule / draft, per-network results with retry of failed networks only.
- Permissions `social.view`, `social.manage`. Demo: Little Sprouts is connected in practice mode with feeds on, two posts and one scheduled.

#### Upgrade
- `php artisan migrate`; `php artisan pos:permissions:sync`; demo stores created earlier: `php artisan db:seed --class=DemoSocialSeeder`; keep the scheduler (`social:publish-due` every minute) and a queue worker running. For live posting add `<APP_URL>/api/v1/social/meta/callback` to the Meta app's redirect URIs and enter the app id and secret in *Marketing → Social posts*. Instagram needs product photos at a public https address.

#### Tests
- Backend 1148 on PostgreSQL (1147 pass, 1 opt-in skip), Pint clean; vitest 1804; mocked Playwright `storefront-social.spec.ts`, `social-admin.spec.ts`; full-stack integration 24 + demo stores 16 (+1 P2b: practice post to Facebook + Instagram with short links, a rejected post, the Meta feed with BDT prices and a rotated address that stops at once, Order on WhatsApp and the share bar) + builder acceptance 5.

### P2a — Landing pages: one-product order page, campaign tracking, short links, campaign domains

#### Added
- **One-product order page:** builder element *Order form* — variant, quantity, optional add-on, name, mobile number (Bangla digits accepted), division/district/area, full address, delivery method, live total (shipping + COD fee) and *Confirm order*; placed through the new **direct checkout** (same place-order transaction as the cart checkout, idempotent, server-recomputed totals with a "new total" confirmation, the shopper's cart untouched, no coupons). Thank-you view with the order link; a sticky *Order now* button on phones.
- **Landing templates** (single-product order page, Eid sale, new arrival, lead form) and *New campaign page* in the Page builder (template, page name, address, product).
- **Campaign tracking:** UTM tags and short-link codes remembered for 30 days and saved on orders from both checkouts (`source`, `attribution`); privacy-safe visit counts (daily salted hashes, deleted after two days, bots ignored).
- **Marketing → Campaigns** (visits, unique visitors, orders, revenue, conversion, average order, by campaign incl. "Direct / other", by source/medium, by day chart + table, top landing pages) and **Short links** (`/go/<code>`, QR code, clicks); web orders show a *Campaign page* badge, a source filter and *Where it came from*.
- **Campaign domains:** a store domain can open on a campaign page (*Settings & domains → Opens on*).
- New `Marketing` module; permissions `marketing.view`, `marketing.manage`. Demo stores get `/p/order-now`, the campaign "Facebook order page", the short link `/go/fb-order`, visits and three order-form orders.

#### Upgrade
- `php artisan migrate`; `php artisan pos:permissions:sync`; for demo stores created earlier `php artisan db:seed --class=DemoLandingSeeder`; keep the scheduler running (daily `marketing:prune-visitor-hashes`). Nginx needs nothing new: `/go/*` already reaches Laravel.

#### Tests
- Backend 1118 on PostgreSQL (1117 pass, 1 opt-in skip), Pint clean; vitest 1752; mocked Playwright `storefront-landing.spec.ts`, `marketing-admin.spec.ts`, store builder; full-stack integration 24 + demo stores 15 (+1 P2a: short link → order page → COD order without a cart → counted for the campaign) + builder acceptance 5.

### P1b — Product page: buy now, quick-buy bar, delivery note, richer gallery, designable layout, more to sell

#### Added
- **Buy now** (to checkout) and a **quick-buy bar** that docks at the bottom once the buy buttons scroll away (above popup/cookie bars, safe-area aware); a **delivery & cash-on-delivery note** under the price built from the shipping zones and methods.
- **Gallery:** product **video** slide (YouTube/Vimeo, nothing loads before play), swipe, pinch/double-tap/wheel zoom with pan, thumbnails at the side or bottom, and up to two **custom badges** per product (Bangla, contrast-safe colours) on the gallery and every card style.
- **Designable product page:** theme `layout.product` (gallery side, thumbnails, sticky summary, details as tabs / accordion / one after another) on the Theme page and in the builder's Site styles; builder zones **under the price**, **under product details** (unchanged place) and **at the bottom**, each with versions for a **category** or a **product** (most specific wins; ≤100), previewed on a matching product in the editor.
- **More to sell:** automatic **frequently bought together** from nightly co-purchase scores (online orders + POS sales, 180 days) with *Add selected to cart*; related-products fallback (in stock, same category, same brand); **questions & answers** (shoppers ask, staff answer and publish in *Reviews → Questions*, bell + one e-mail to the asker).
- Demo data: answered questions (one in Bangla) on two products per demo store; affinities computed by the demo seeder.

#### Fixed
- Saving the Theme page no longer resets *Products per row* (`layout.listing_columns`) or other layout keys the form doesn't edit.

#### Upgrade
- `php artisan migrate`; `php artisan pos:affinities:compute` once; existing demo databases `php artisan db:seed --class=DemoProductPageSeeder`; keep the scheduler (hourly `pos:affinities:compute --nightly`) and a queue worker running. Optional `POS_QUESTION_RATE_LIMIT`.

#### Tests
- Backend 1096 on PostgreSQL (1095 pass, 1 opt-in skip), Pint clean; vitest 1686; mocked Playwright `storefront-product-page.spec.ts`, `product-admin-p1b.spec.ts`, store builder; full-stack integration 24 + demo stores 14 (+1 P1b: delivery note, product-only zone, questions asked → answered → shown, quick-buy bar, buy now → checkout) + builder acceptance 5.

### P1a — Product variants: photos per colour, variant grid, back in stock, size guides

#### Added
- **Variant grid** in the product editor: options → *Generate* all combinations (≤200, existing variants kept by option values), a spreadsheet-like table (arrow keys, paste from Excel) for SKU, barcodes, cost/selling/wholesale/compare-at prices, reorder level and active; bulk edit by selection or "all Red" (exact decimal %); opening stock for new variants and *Adjust stock* through the Inventory module; *Save details* and *Save variants* are separate.
- **Photos per colour:** one option owns photos (≤8 per value); swatch style colour / photo / button; the storefront gallery switches to the chosen colour's photos ("All photos" keeps everything reachable); cards show up to 5 colour chips that preview the colour's photo.
- **Stock per option:** sold-out choices crossed out (still selectable), "Only N left" when 5 or fewer, **Notify me when it's back** — one e-mail per request when the fulfilment store gets stock again (`StockBecameAvailable`), with the waiting count in the grid and a requests card.
- **Size guides:** *Online store → Size guides* (ready tables, paste from Excel, Bangla, category assignment, product override); a *Size guide* dialog with a real table on the product page.
- Demo data: Classic Shop leather tote Tan/Black photos and clothing/shoe guides; Little Sprouts night light Peach/Mint photos and baby clothing/shoe guides (`DemoVariantsSeeder` for existing demo stores).

#### Upgrade
- `php artisan migrate`; for demo stores created earlier `php artisan db:seed --class=DemoVariantsSeeder`; keep the queue worker running (back-in-stock e-mails). No new permissions.

#### Tests
- Backend 1071 on PostgreSQL (1070 pass, 1 opt-in skip), Pint clean; vitest 1605; mocked Playwright `storefront-variants.spec.ts`, `products-variants.spec.ts`; full-stack integration 24 + demo stores 13 (+1 P1a: colour photo switch, size guide, notify me → restock → notified) + builder acceptance 5.

### B8b — Store builder: popups & bars, form builder

#### Added
- **Popups & bars:** builder document kind `popup` (modal, full screen, corner slide-in, top/bottom bar) with triggers (after a delay, on scroll, on exit intent with a touch fallback), frequency (every page view, once per visit, every N days, once), stop after the shopper acts, page / device / audience rules, priority and schedule. Published + switched on (`PATCH {active}`, `storefront.publish`) = live. Never shown on cart, checkout, account or order pages (server-enforced). Accessible dialogs (focus in, trapped, restored; Esc; overlay click optional), bars push the page instead of covering it; reduced motion respected. Buttons in popups can close them. Public `GET /store/builder/popups`; staff draft preview `?preview=draft&popup=`.
- **Start screen:** *Popups & bars* group (English / বাংলা) with status, *Show on shop* switch, preview and delete; popup editor with a *Popup settings* panel and the popup drawn in its layout on the canvas.
- **6 popup templates** — newsletter, exit offer with the store's running coupon, free-delivery bar, Eid sale slide-in, cookie notice (informational: there are no tracking cookies), contact form — and a contact-form section template (83 built-ins).
- **Form builder:** `form` element with 10 field kinds, required fields, choices, number range, length, reply-to e-mail, consent box, success message, extra notification e-mail; Bangla for every text; no file uploads. Public `POST /store/forms/{document}/{element}` checks every answer against the **published** form (honeypot, `POS_FORM_RATE_LIMIT`, 32 KB) and stores it in `builder_form_submissions`.
- **Content → Form submissions** (`forms.view` / `forms.manage`): forms with new counts, filters, detail drawer with *Reply by e-mail*, read / archive / delete, CSV / Excel / PDF export; bell notification per submission; optional e-mail to the form's address. The sidebar *Content* entry opens form submissions for staff who may only read those.

#### Upgrade
- `php artisan migrate` (`builder_documents.active`, `builder_form_submissions`), then `php artisan pos:permissions:sync`.

#### Tests
- Backend 1059 on PostgreSQL (1058 pass, 1 opt-in skip), Pint clean; vitest 1574; mocked Playwright (store builder, `storefront-popups-forms.spec.ts`, `forms-admin.spec.ts`); full-stack integration 24 + demo stores 12 (+1 B8b: popup from template → publish → switched on → shown once, never on the cart; contact form error → sent → read by the owner) + builder acceptance 5.

### B8a — Store builder: selling blocks, trust & people, more visualization

Ten new page-builder elements and store-data charts. Popups/bars and forms follow in B8b.

#### Added
- **Selling:** `pricing_table` (1–4 plans, NUMERIC-string prices or a word, ✓/✗ features), `before_after` (keyboard slider), `comparison_table` (✓/✗/text cells, optional product columns with price and add to cart), `flash_sale_bar` (the live countdown promotion, its products, "N of M claimed" only with a real usage limit), `bundle` (2–4 products, variant choice, "Total today", add all to cart with per-item failures).
- **Trust & people:** `team`, `review_wall` (approved reviews of products on sale; first name + last initial only), `photo_grid` (Instagram-style, own photos), `store_hours` (Saturday-first week, "Open now · closes …" in the store's time zone, after-midnight and 24-hour rules).
- **Visualization:** chart kinds `stacked-column` / `stacked-bar`; chart `data_source` from the store — products per category, customer ratings (public counts only); `progress_bars` (bar / ring); integer data gets whole-number axis ticks.
- Two-level Bangla keys for nested lists; contracts `ReviewShowcase`, `StorefrontCatalog::liveProductIds()`, `PromotionShowcase::claimed()`.
- 10 neutral section templates with thumbnails (76 built-ins).

#### Tests
- Backend 1035 on PostgreSQL (1034 pass, 1 opt-in skip), Pint clean; vitest 1496; mocked Playwright store-builder + `storefront-builder-b8a.spec.ts`; full-stack integration 24 + demo stores 11 (+1 B8a on Little Sprouts with real reviews, flash sale and add-all-to-cart) + builder acceptance 5.

### B7 — Page builder start screen: easier, BerryKid first, original look

The *Online store → Page builder* screen is now a guided start for non-technical shop owners, in English or Bangla.

#### Added
- **5 demo looks, BerryKid first:** the kids look is renamed **BerryKid Kids Store** (preset and site template) and leads the list as a featured card. New portable site template **`site-default` "Original look"** (the store's own amber/violet design for any kind of shop: 10-section home, header, footer, shop top; 5 photos, 4 banners, Bangla). `POST /storefront/builder/start-from-demo/default`. 66 built-in templates.
- **Preview before using:** `preview_url` on `GET /storefront/builder/templates` (tall full-page images for the five sites, `/builder-templates/<id>-full.jpg`); a Preview dialog with the whole home page and what changes; **See live demo** opens the matching demo store when the demo gallery lists it.
- **One click — Use and publish now** (needs `storefront.publish`, with a confirm): applies the look and publishes it; *Save as draft* keeps the review-then-publish flow.
- **3-step guide** (Choose a look → Edit your pages → Publish) that knows what is done, shows unpublished changes and publishes them all; can be hidden.
- **English / বাংলা** toggle for this screen (remembered per browser); plain wording and groups *Your pages*, *Header & footer*, *Shop pages*.

#### Tests
- Backend 979 on PostgreSQL (978 pass, 1 opt-in skip), Pint clean; vitest 1414; mocked Playwright 218 (+2 B7); full-stack integration 24 + demo stores 10 + builder acceptance 5 (+1 B7: order, real preview image, live demo link, Original look live in one click).

### B6.1 — Edit banners from the page builder

#### Added
- **Edit button on banner rows:** banner-based sections (hero slider, banner grid and the rest) get an **Edit** button on every banner row in the builder inspector, as does the homepage section editor. Clicking the picture or name does the same. It opens the banner form prefilled: desktop and mobile image, kicker, title, text, buttons with the link picker, colours, position and Bangla.
- **Draft-safe saving:** `POST /storefront/builder/documents/{document}/banners/{banner}` decides between editing in place and copying.
  - The banner is **copied for this draft** when it is used anywhere else: a homepage section, another document's draft, any published version (including this page's own), or a saved template.
  - Otherwise it is edited in place.
  - The editor swaps the copy's id into the draft as one undo step, and the canvas re-fetches the banner at once.
  - The live store changes only on publish.
  - Popup banners can't be edited here (`422 BANNER_NOT_EDITABLE_HERE`).
  - Edits are audited as `storefront.builder_banner_edited`.

#### Fixed
- The banner form trimmed text on every keystroke, so a space couldn't be typed between words in the headline, text or button labels. It now trims only on save.

#### Tests
- Backend PostgreSQL 975 passed + 1 skip (7 new tests for copy-on-write, validation and isolation).
- Vitest 1397. Mocked Playwright 216 passed: a test edits a banner in the builder and the canvas shows the new headline.
- Full-stack: integration 24/24, demo stores 10/10.

### B6 — Store builder: more elements, motion and D3 charts

#### Added
- **19 new elements**, all with Content, Style and Advanced tabs, per-device styles, Bangla (per item for lists), draft / publish and server validation:
  - **Content:** accordion, tabs, icon box, icon list, quote, notice (tone shown as icon + word), number counter (count-up; off for reduced motion), steps / how it works, **chart**.
  - **Media:** gallery with an accessible lightbox, image carousel (pausable autoplay), logo carousel, Google Map (click-to-load: nothing reaches Google until the visitor asks).
  - **Shop:** category card, product spotlight (variants and add to cart), shop the look (photo hotspots with product cards), trust badges, recently viewed.
  - **Motion:** marquee (pausable; static for reduced motion).
- **Charts (D3):** bar, column, line, area, pie and donut, following the dataviz rules:
  - **Data:** one y-axis; a fixed, colour-blind-validated categorical palette (light and dark sets); legend for 2+ series; selective direct labels.
  - **Interaction:** hover / tap / keyboard tooltips.
  - **Accessibility:** a `<figure>` with an always-present data table and a texture fill for print and forced-colors.
  - **Loading:** lazily loaded (57 kB chunk).
  - **Dependencies:** `d3-scale` 4.0.2, `d3-shape` 3.2.0, `d3-array` 3.2.4, pinned with npm `overrides` across the d3 chain. The 2026-11-03 releases were avoided as too new.
- **Effects:**
  - Entrance animations (fade / slide / zoom) on any node. They are progressive (content is visible without JS), off for reduced motion, and the editor has a *Preview animation* button.
  - Sticky section (one per page).
  - Wave / curve / tilt / triangle / zigzag shape dividers.
  - Section background video (YouTube / Vimeo, muted, privacy-enhanced). Only the poster shows on phones, with reduced motion and with Save-Data.
- **Editor:**
  - A reusable item list: collapsible cards, drag or keyboard reorder, duplicate, limits and per-item Bangla.
  - A hotspot editor: click to place, drag or arrow keys to nudge, a product per dot.
  - A spreadsheet-like chart grid: paste from Excel / CSV, Bangla digits, live checks and a chart-kind hint.
  - A new "Media" group in the Add panel.
- **8 new templates** with thumbnails (65 in total): how it works, stats band, FAQ accordion, photo gallery, shop the look, store location map, trust strip, growth chart.
- **Server:**
  - `StorefrontCatalog::productDetails()` for product spotlights.
  - Template hotspots refer to products by source (`product_ref`), so templates never carry ids.

#### Security / config
- `config/cache.php` `serializable_classes` is now `[stdClass::class]`, instead of `false`. Before this, a cached builder payload with an empty JSON object (`{}`) came back from serializing cache stores (e.g. `database`) as an incomplete class. `stdClass` has no magic methods, so it is no gadget, and every other class stays forbidden. A regression test is included.

#### Tests
- Backend 969 (PostgreSQL 968 + 1 skip; SQLite 963 + 6 skip), including 47 schema and 7 feature tests for B6 (limits, translations, sanitizing, data, resolve, isolation, cache round-trip).
- Vitest 1394. Mocked Playwright 215 passed, 113 skipped; this includes the chart spec (every kind at 1366 / 375, tooltips, keyboard, table, forced-colors) and the new element and editor specs.
- Full-stack: integration 24/24; demo stores 10/10, including a B6 showcase page built from the templates, published, and used by a shopper (accordion, gallery lightbox, chart, click-to-load map); acceptance 4/4.

### K1 — Kids demo look (BerryKid-inspired) for the store builder

The BerryKid baby-store design (the storefront's original reference, [UI_REFERENCE_ANALYSIS.md](docs/ecommerce/UI_REFERENCE_ANALYSIS.md)) is now a fourth demo look. It reuses layout and interaction patterns only, with original names, copy and photos.

#### Added
- **Theme preset `kids` ("Kids Store")** with a contrast-checked palette: amber `#ffb020` with dark text, lavender `#7a5cc8`, mint-teal `#1f7a63`, coral sale `#c24626`.
  - Fonts Baloo and Poppins, pill buttons, radius 16.
  - Commerce header with a lavender menu bar; columns footer.
- **Product card style `arched`:**
  - A coral diagonal sale ribbon and an amber caption block with an arched top.
  - On hover or focus the block turns lavender, a round add-to-cart button sits on the arch, and wishlist / quick view buttons slide in.
  - Touch screens get a visible action row.
  - Text stays AA in both states.
  - Admin *Layout → Arched*.
- **Demo store *Little Sprouts*** (`kids.shop.localhost`, `owner@littlesprouts.test`, coupon `SPROUT10`):
  - 20 baby and kids products across girls, boys, toys, nursery, feeding & bath and shoes.
  - 37 Unsplash photos (no identifiable children's faces), credited in [DEMO_IMAGE_CREDITS.md](docs/ecommerce/DEMO_IMAGE_CREDITS.md).
  - Homepage in the reference's order: slider, promo split, tabbed collection, deal of the week, hot products, newsletter band, categories, best sellers, reviews, girls / kids / boys trio, service strip.
  - Plus pages, blog, reviews, a flash sale and stock.
- **Builder:**
  - `site-kids` plus 10 kids section templates (57 templates in total, 55 with thumbnails).
  - "Start from a demo look" offers 4 looks (`start-from-demo/kids`).
  - The demo gallery lists 4 stores (up to 4 across).

#### Tests
- Backend 907 (PostgreSQL 906 + 1 skip; SQLite 901 + 6 skip), including the kids contrast pairs, the seeder (Little Sprouts and an unchanged Demo Mart), the templates and start-from-demo kids.
- Vitest 1270. Mocked Playwright 205 passed, 103 skipped: the kids preset at desktop and mobile, the arched card, ribbon, hover cart, touch row.
- Full-stack: integration 24/24; demo stores 9/9, including a Little Sprouts browse → filter → variant → coupon → checkout → stock down; acceptance 4/4.

### B5 — Visual store builder: templates, start from a demo look, acceptance

Plan: [STORE_BUILDER_PLAN.md](docs/ecommerce/STORE_BUILDER_PLAN.md) (§11). Delivery report: [STORE_BUILDER_REPORT.md](docs/ecommerce/STORE_BUILDER_REPORT.md).

#### Added
- **46 built-in templates:** 38 sections (vegan, handmade, classic and neutral), 5 pages and 3 full-site looks, all with original copy and Bangla headings and buttons.
  - They are shipped as files and kept portable: photos come from the demo photo set and are imported into the store's own media library when used (deduplicated); banners are created in the store; products always come from the store's own catalogue.
  - Each has a thumbnail (44 screenshots plus the generated placeholder).
- **Editor Templates tab:** filters (All / this look / Mine), categories and search; insert by click or drag, as one undo step. **Save as template** for sections, and deleting your own.
- **Start from a demo look** (Page builder list): pick Vegan Store, Handmade or Classic Shop and choose the parts.
  - The theme, home page, header, footer and shop top area become **drafts**.
  - A review panel offers previews and **Publish all**, which publishes everything in one transaction.
- API: `GET/POST /storefront/builder/templates`, `POST …/templates/{id}/instantiate`, `DELETE …/templates/{id}`, `POST …/start-from-demo/{preset}`, `POST …/publish-all`; `MediaLibrary::import()`.

#### Acceptance
- New `e2e/builder-acceptance.spec.ts` (full-stack) walks through the brief's §L criteria on Demo Mart as the client:
  1. Start from the Classic look; drafts stay private until Publish all.
  2. Drag a heading in, type it with live preview, duplicate, delete, reorder.
  3. Gradient background; heading 48 px on computers and 22 px on phones only.
  4. Publish; shoppers see it.
  5. Another store gets 404 and sees nothing.
  6. Restore version 1 and publish; the heading is gone.

  4/4 tests pass. The full criterion-by-criterion evidence is in the delivery report.

#### Tests
- Backend 891 (PostgreSQL 890 + 1 skip; SQLite 885 + 6 skip; 59 new template / demo / publish-all tests, including every built-in template validated in its contexts and tenant isolation).
- Vitest 1261. Mocked Playwright 202 passed, 100 skipped.
- Full-stack: integration 24/24, demo stores 8/8, acceptance 4/4.

#### Docs
- Bangla manual §17.7 (templates, start from a demo look; screenshots 49–50); API documentation; plan §3 and §11; delivery report.

### B4 — Visual store builder: content pages, header, footer, shop zones, remaining elements

Plan: [STORE_BUILDER_PLAN.md](docs/ecommerce/STORE_BUILDER_PLAN.md) (§11 as built). With nothing published in the builder, every page renders exactly as before.

#### Added
- **Content pages:** any CMS page (About, Contact, FAQ, Privacy, Terms …) can be designed with the builder (document `cms:<id>`; "Design with the builder" imports the page's text). The FAQ list and contact form keep working as elements. Title, slug and SEO stay in the Cms module, and deleting the design restores the classic page.
- **Header and footer builders** (`header`, `footer` documents; "Design" starts from today's layout):
  - The header is used from 768 px; phones keep the compact header and drawer.
  - The footer is used at every width.
  - The classic announcement bar stays unless the builder header contains it.
- **Shop and product zones:** `listing.top` / `listing.bottom` around the grid on shop, category, brand and search pages, and `product.after` below product details. **Products per row** per device (`layout.listing_columns`, default 3 / 3 / 2 = today's grid). Listings, filters, cart and checkout are unchanged.
- **Elements:**
  - Video: YouTube / Vimeo, click-to-load, privacy-enhanced embeds.
  - Icon (20-icon set), countdown (date or promotion), discount (live promotion with optional coupon code and a copy button), call-to-action, search box, promoted product.
  - Site parts: logo, menu, account, wishlist, cart with count and total, language switch, announcement, social icons, payment icons, contact details, copyright, newsletter form.
  - FAQ list and contact form (content pages).
  - Custom HTML, sanitized server- and client-side.
  - Each element type declares where it is allowed (`allowed_in`); the editor only offers those, and the server enforces it (`ELEMENT_NOT_ALLOWED`).
- **Permission `storefront.custom_html`:** adding or changing custom HTML needs it (403 `CUSTOM_HTML_FORBIDDEN`), while moving, hiding or deleting does not. Organization Admin has it; Online Store Manager does not.
- **Editor:**
  - The Page builder list has three groups: Pages, Site parts, and Shop & product pages, the last with a products-per-row card.
  - The canvas shows per-kind surroundings: a sample page under a header, sample products around a listing zone.
  - Forms and setup dialogs exist for every new element, with Bangla fields.
  - Live preview data for countdown, discount, promoted product, menu and FAQ comes through `POST /builder/resolve`.
- **API:**
  - Document kinds `header`, `footer` and `zone`, plus `cms:` keys.
  - `from: cms | current` importers.
  - Summaries carry `cms_page` and `preview_url` for every kind.
  - Bootstrap `builder: {home, header, footer, zones}`.
  - `GET /store/pages/{slug}` carries `builder`.
  - New module contracts: `PromotionShowcase`, Cms `PageContent` / `PageDesigns`, and `StorefrontCatalog::latestProductSlug()`.
- **Styles are now scoped per document** (`compileStyles(…, {scope})`), so a header and a footer that use the same node ids no longer share styles.

#### Upgrade
- Run `php artisan pos:permissions:sync` after deploying. It adds `storefront.publish` (B1) and `storefront.custom_html` (B4) to the catalog and to the built-in roles. Without it, nobody can publish builder pages or the theme on existing databases.

#### Tests
- Backend 832 (PostgreSQL 831 + 1 skip; SQLite 826 + 6 skip).
- Vitest 1243. Mocked Playwright 200 passed, 90 skipped (the editor spec now allows 30 s for the canvas's first compile when all specs run in parallel).
- Full-stack: integration 24/24; demo stores 8/8. The new test has Green Basket's footer and About page designed with the builder, hidden while in draft and live after publishing.
- The full-stack specs now use a 15 s assertion timeout. During one run the machine was heavily loaded by other applications (Visual Studio), every request took 2–4 s on the single-threaded dev server, and several tests timed out at different steps. A clean run at normal load passed 24/24.

#### Known issue (not from B4)
- Under heavy load the admin *New product* form once lost typed prices and barcode after the unit was chosen. It could not be reproduced at normal load, and the cause is not found yet.

#### Docs
- Bangla manual §17.6 (content pages, header / footer, shop zones, new elements; screenshot 48); API documentation; deployment guide upgrade note; plan §11.

### B3 — Visual store builder: design controls and theme drafts

Plan: [STORE_BUILDER_PLAN.md](docs/ecommerce/STORE_BUILDER_PLAN.md) (§11 as built).

#### Added
- **Style tab** in the page builder, showing only the groups relevant to the selected node:
  - Background: colour, gradient (linear / radial, 2–5 stops) or image with focus point, fit and repeat, plus an overlay.
  - Typography; spacing box (linked / unlinked sides); size; layout; border and per-corner radius; shadow and text-shadow layers with presets; opacity; hover (colours, shadow, lift / grow).
  - Colour control: theme colours, store palette, curated swatches, HEX, RGB(A), native picker, alpha slider and contrast hint.
  - Invalid input is flagged and never written.
- **Per-device styling:** the toolbar device (Desktop / Tablet / Mobile) chooses the breakpoint being edited. Each control shows whether its value is set for this device or inherited, with a reset; writes stay sparse.
- **Column resize:** drag handles between columns (per device, 5 % snap, live percentages, one undo step); keyboard arrows; width fields in the inspector.
- **Global styles / theme:**
  - New colour roles: button, button text, button hover (automatic by default), link.
  - Type scale: body size, heading scale, line height, heading weight, mobile scale, heading letter spacing.
  - Store palette (≤ 8 colours) and 8 predefined palettes, each passing 4.5:1 on every text pair.
  - `GlobalStylesPanel` on the Theme page and in the builder's **Site styles** drawer. Drawer edits preview instantly on the canvas through a `theme` protocol message.
- **Theme draft → publish:** `GET/PUT /storefront/theme/draft` (409 on revision conflict), `POST /theme/publish` (`storefront.publish`; the first publish also stores the previous live theme as version 1), `discard`, `versions`, `restore`. Rules:
  - Preset apply now changes the draft.
  - Staff see the draft theme with `?preview=draft`, and the builder canvas always shows the draft.
  - Legacy `PUT /storefront/theme` = save + publish (now needs `storefront.publish`).
  - Custom CSS stays immediate.
- Layers, hover labels and the mini toolbar name sections after their content ("Section · Product grid: Best sellers").

#### Unchanged look
- At the defaults, the storefront renders identically: 7,596 computed-style snapshots across Demo Mart and the three demo presets, on desktop and mobile, showed 0 differences. Permanent parity tests were added (vitest and mocked Playwright).

#### Tests
- Backend 810 (PostgreSQL 809 + 1 skip; SQLite 804 + 6 skip), including theme draft / publish / versions / restore / 409, preset → draft, legacy PUT, staff-only draft preview and tenant isolation.
- Vitest 1154. Mocked Playwright 189 passed, 83 skipped. Full-stack integration 24/24 (theme test rewritten for draft → publish: a saved draft is not live, a publish is); demo stores 7/7.
- The integration spec gets a 60 s per-test budget for its long multi-step flows on the single-threaded dev server.

#### Docs
- Bangla manual §17.4 (Style tab, per-device, column widths) and §17.5 (site styles, theme draft → publish), screenshots 46–47; API documentation; plan §11.

### B2 — Visual store builder: the editor

A full-screen drag-and-drop editor for the home page and landing pages, on top of the B1 engine. Plan: [STORE_BUILDER_PLAN.md](docs/ecommerce/STORE_BUILDER_PLAN.md) (§11 as built). Style controls are B3.

#### Added
- Admin *Online store → Page builder*: home page (copy the current homepage or start blank), landing pages (`/p/<slug>`) with status, edit, view and delete.
- Editor `/admin/storefront/builder/:id`, full screen:
  - **Add panel:** grouped, searchable; drag onto the page or click to insert.
  - **Layers tree:** drag, keyboard drag, hide, duplicate, delete.
  - **Canvas:** the real storefront in an iframe at 1366 / 768 / 375 px, with a selection outline and mini toolbar. Drop indicators work across the iframe.
  - **Inspector:**
    - Content forms for every element. The 13 section types reuse the homepage section forms, including inline banner creation.
    - Bangla fields; device visibility, hidden and schedule.
    - Setup dialogs for elements that need content first.
  - **Toolbar:** undo / redo (100 steps, typing coalesced), autosave with revision conflicts (409 dialog), problems shown per node (422), offline retry and an unsaved-changes guard; preview, publish with a note, discard, version history with restore.
- Canvas page `builder-canvas.html` at `/admin/builder-canvas`: a third Vite entry with storefront CSS only, a versioned postMessage protocol checked for origin and source, and no store API calls. Production Nginx rule in DEPLOYMENT_GUIDE.
- API:
  - `POST /storefront/builder/resolve`: section data and media for unsaved elements, with per-element errors.
  - `GET /storefront/builder/canvas-context`: bootstrap, store URL and locales.
  - `PATCH /storefront/builder/documents/{id}` (rename).
  - Document summaries now carry `path` and `preview_url`.
- Dependencies: `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2 (admin only).

#### Fixed
- Signing out of the admin no longer triggers "an error during concurrent rendering" (seen in every full-stack run since T2). The account menu read the user after the session was cleared and before the redirect. `useAuth()` now keeps the last user for that render, while `useCan()` follows the live session.

#### Tests
- Backend 797 (PostgreSQL 796 + 1 skip; SQLite 791 + 6 skip).
- Vitest 1069, including tree operations (every result valid), history, autosave and conflicts, the canvas protocol, drop targets, inspector forms and validation, and `useAuth` during sign-out.
- Mocked Playwright 182 passed, 80 skipped. `store-builder.spec.ts` covers drag-and-drop into the canvas, inspector edits, layers, duplicate, hide, device widths, undo / redo, autosave, the 409 dialog, publish, history restore and the leave guard.
- Full-stack:
  - New test: the Mati & Co. owner copies the homepage, drags in a heading, edits it, autosaves (not live), publishes, and shoppers see it above *Editor's pick*.
  - Demo stores 7/7, integration 24/24.

#### Docs
- Bangla manual §17.3 Page builder (screenshots 43–45), API documentation, deployment guide (canvas route), plan §11.

### B1 — Visual store builder: engine

The engine of the no-code store builder: validated JSON page documents, draft / publish / version history, and builder-rendered storefront pages. Plan: [STORE_BUILDER_PLAN.md](docs/ecommerce/STORE_BUILDER_PLAN.md) (§11 as built). There is no admin UI yet; the drag-and-drop editor is B2.

#### Added
- Migration `create_builder_tables` (additive): `builder_documents`, `builder_versions`, `builder_templates`.
- Schema v1: section → columns (1–6, widths per device) → elements (heading, text, image, button, spacer, divider, inner row and the 13 existing section types). Styles are sparse per device and covered by a whitelist: colours, theme tokens, gradients, background images with overlay, typography, spacing, size, layout, border, shadows and hover. Limits apply; references must belong to the organization.
- Admin API `/storefront/builder/*`: documents, draft with revision conflict (409), publish (new permission `storefront.publish`), discard, versions, restore, delete, element registry, render. A homepage importer converts today's homepage into a builder page.
- Public pages `/store/builder/pages/{home|slug}` with staff draft preview; bootstrap `builder.home`; landing pages at `/p/{slug}` (storefront route and HTML shell).
- Storefront: `compileStyles` (re-validates every value; breakpoints at 1023 / 639 px; respects reduced motion) and `PageRenderer`. The existing section components draw wrapped elements. The home page switches to the builder page only when one is published.

#### Changed
- Homepage section data is built by a shared `SectionContentResolver`, with the section config rules shared through `SectionConfigRules`. Homepage output is unchanged; all existing tests pass unchanged.

#### Tests
- Backend 792 tests (PostgreSQL: 791 pass, 1 opt-in skip; SQLite: 786 pass, 6 skip). They cover the fixture round-trip, invalid values, CRUD, conflicts, publish / restore, importer equals homepage, Bangla, schedules, preview, permissions, tenant isolation on every endpoint, and the landing shell.
- Vitest 962. Mocked Playwright: 176 passed, 72 skipped; the builder page is checked at 1366 and 375 px.
- Full-stack:
  - New test: Classic Shop's homepage, imported and published, renders with the same headings, products and links.
  - Integration suite 24/24; demo stores 6/6.

### T3 — Theme demos: polish and verification

Visual pass of the three demo stores and Demo Mart at 1366 / 768 / 375 px, full-stack tests per demo, manual and report: [STOREFRONT_THEMES_REPORT.md](docs/ecommerce/STOREFRONT_THEMES_REPORT.md).

#### Fixed / improved (shared storefront code)
- Star ratings follow the theme and are clearly visible on dark surfaces (`--sf-star`, `.sf-on-dark`; classic widgets footer).
- Banner buttons that would vanish on the scrim are inverted; slides or tiles without an image get a background that contrasts with their text.
- Category / brand strips centred when they fit; first rail item aligned; lone last banner tile spans the row; 3 testimonials / posts in one row; 3-block footer without an empty column.
- Phones: card buttons no longer wrap; store name follows the preset; hero dots get 24 px tap targets.
- Discount amounts never split across lines (cart, mini cart, checkout); search field follows the button shape; consistent 44 px buttons in empty / error states; no extra gap above rich text that starts with a heading.

#### Tests
- New full-stack `e2e/demo-stores.spec.ts` (opt-in `E2E_BACKEND=1 E2E_DEMOS=1`): gallery + per demo browse → category → on-sale filter → variant → coupon → guest COD checkout → owner sees the order, variant stock down; Demo Mart sees none of the demo orders — 5/5. Integration suite 24/24 on fresh PostgreSQL with the demo stores (repricing test budget 90 s and checkout confirmations 15 s: `php artisan serve` is single-threaded on Windows; a direct checkout measures 1.7 s). Vitest 933; mocked Playwright 174 passed / 68 skipped; typecheck, lint, build clean.

#### Docs
- Bangla manual §17.1 (theme presets) and §17.2 (demo stores) with screenshots 38–42 and the demo logins; delivery and testing report with the full file list.

### T2 — Three theme demo stores

Three separate demo organizations, each a complete online store in one T1 preset, built from ordinary POS data. Plan: [STOREFRONT_THEMES_PLAN.md](docs/ecommerce/STOREFRONT_THEMES_PLAN.md); visual store builder (next): [STORE_BUILDER_PLAN.md](docs/ecommerce/STORE_BUILDER_PLAN.md).

#### Added
- `DemoThemesSeeder` (`php artisan db:seed --class=DemoThemesSeeder`; refuses in production; one transaction per store; skips a store whose host or owner exists): *Green Basket* (vegan, `vegan.shop.localhost`), *Mati & Co.* (handmade, `handmade.shop.localhost`), *Classic Shop* (classic, `classic.shop.localhost`). Each: owner login, branch, categories, 18–19 products with variants and photos (Media / product image actions), sale prices as compare-at prices, opening stock through a stock adjustment (one product out of stock), online listings, a countdown flash sale on other products, a coupon (`GREEN10` / `MATI15` / `CLASSIC20`), menus, banners, homepage sections per the reference layouts, About / Contact / FAQ / Privacy / Terms pages, 3 blog posts, 8 verified reviews (from delivered demo orders) and one POS sale so *best sellers* has data; theme preset applied. Data in `database/seeders/demo-themes/{vegan,handmade,classic}.php`; 93 royalty-free photos with credits in [DEMO_IMAGE_CREDITS.md](docs/ecommerce/DEMO_IMAGE_CREDITS.md).
- Demo gallery: `GET /api/v1/demo-stores` + storefront page `/demos` (cards with photo, preset colours and font, categories, product count, *Open store* / *Open admin*; English / Bangla; no logins shown), behind `STOREFRONT_DEMO_GALLERY` (off by default, always off in production).
- Banner text scrim: hero slides and banner tiles get a gradient behind their text (dark under light text, light under dark text; even wash on mobile) so text stays readable on any photo.
- Development: the Vite proxy forwards the browser host (`xfwd`); with `TRUSTED_PROXIES=127.0.0.1` the demo hosts resolve locally (`backend/.env.example`).

#### Tests
- Backend 775 (PostgreSQL: 774 pass, 1 opt-in skip; SQLite 769 + 6 skip): seeder (counts, stock, prices, promotions, content, preset, isolation of Demo Mart, idempotent re-run, production refusal, a guest COD checkout with coupon on a demo host), gallery API + page. Vitest 924; mocked Playwright gallery 10/10, storefront + themes 36 passed / 2 skipped.
- Full-stack run on PostgreSQL with the demo stores: every demo host serves its own store and preset, `localhost` still serves Demo Mart, gallery lists the three demos. The full-stack integration suite timed out at varying steps on this run because the machine was under heavy load; the same happened on a baseline without demo stores and without the proxy change, so it is not a T2 regression — re-run in T3.

### Docs — user manual in Bangla

- `docs/USER_MANUAL.bn.md`: a step-by-step user manual in simple Bangla for owners, managers and cashiers (sign-in, dashboard, POS sale and payment, cash sessions, returns, products, inventory, purchasing, customers, expenses, web orders and COD, promotions, reports and exports, AI insights, online store settings, users and roles, the shopper's view, a daily checklist and troubleshooting), with 37 screenshots from the seeded demo in `docs/manual/images/`.
- `frontend/e2e/manual-shots.spec.ts` (opt-in, `MANUAL_SHOTS=1`): regenerates those screenshots against a seeded backend.

### PostgreSQL verification

The first run of the whole system on PostgreSQL 18 (local, role `pos_app`, databases `pos` / `pos_test` / `pos_e2e`, 2026-11-11). Until then every backend test had run on SQLite only. The run found the bugs below; all are fixed.

#### Fixed
- **Self-referencing foreign keys** (`users.created_by` / `updated_by`, `units.base_unit_id`, `categories.parent_id`, `menu_items.parent_id`) were declared inside `Schema::create`, so on PostgreSQL Laravel emitted the FK before the primary key and the migration failed (SQLSTATE 42830). They are now added in a `Schema::table` after the create, with the same names and `ON DELETE` rules. The existing migrations were edited (no production database existed yet).
- **Trigger functions** used `CREATE FUNCTION`; `migrate:fresh` drops tables but not functions, so a second fresh migrate failed (42723). All 9 migrations now use `CREATE OR REPLACE FUNCTION`.
- **Session timezone:** the `pgsql` connection pins the session `timezone` to `UTC` (`config/database.php`). The server default was Asia/Dhaka and Laravel writes naive UTC timestamp strings, so every `timestamptz` was stored 6 hours off.
- **`SaveAttribute`** compared the primary key with `''` when creating (`whereKeyNot($id ?? '')`); PostgreSQL rejects `''` as a uuid (22P02), so creating an attribute answered 500. The exclusion now applies only when the id exists.
- **`ReferentialIntegrity`** (turns a foreign-key violation on delete into the business "in use" error) recognised SQLSTATE 23503 only. PostgreSQL raises 23001 `restrict_violation` for `ON DELETE RESTRICT`, so deleting an in-use unit, category, customer group, expense category, media item or courier answered 500. 23001 is recognised too.
- **`OrganizationDirectory::activeIds()`** breaks `created_at` ties by id (stable order for the daily insights job).

#### Changed
- Tests: new `App\Modules\Shared\Tests\Concerns\TruncatesCommittedData`, used by the three PostgreSQL concurrency tests (`StockLockingTest`, `CheckoutConcurrencyTest`, `PromotionConcurrencyTest`) instead of plain `DatabaseTruncation`: it keeps the migration-seeded geography tables (`geo_divisions`, `geo_districts`) and truncates again after the test, so committed rows no longer leak into later `RefreshDatabase` tests.
- Tests: the shopper test cookie jar judges cookie expiry against the test clock (`travelTo`), not the wall clock; two assertions on jsonb-stored objects compare order-insensitively (jsonb sorts keys); the daily-insights test pins the clock before provisioning.

#### Verified
- All 71 migrations run on PostgreSQL 18; `migrate:fresh --seed` and the dev seeder work, and a second `migrate:fresh` works.
- Backend on PostgreSQL: 747 tests, 746 pass, 1 skipped (the opt-in real PDF render, `PDF_E2E=1`). This includes the 5 PostgreSQL-only tests that skip on SQLite: `StockLockingTest` (2), `CheckoutConcurrencyTest`, `PromotionConcurrencyTest` and `StorefrontIndexesTest`. SQLite: 741 pass, 6 skipped. Pint clean.
- So the PostgreSQL CHECK constraints, append-only triggers, partial unique indexes, the jsonb Bangla-name search expression, the report SQL (`AT TIME ZONE` grouping, NUMERIC aggregates) and the AI tables have now run on PostgreSQL.
- Full-stack Playwright (`frontend/e2e/integration.spec.ts`, 24 tests) passes against a PostgreSQL-backed backend (`pos_e2e`).
- **Still pending:** `EXPLAIN` / performance on production-sized data (no large dataset yet) and a live Anthropic API call (no key).

### Phase 8 / AI1 — AI assistant, insights and customer segments

An optional AI module for the admin and POS side: questions answered from the report registry, business insights, customer segments and a reorder explanation. It is off by default. Every number comes from deterministic code; the model reads aggregates through read-only tools and writes text. Design as built: [AI_INTEGRATION.md](docs/AI_INTEGRATION.md).

#### Added
- **AI module** (`app/Modules/AI`):
  - contract `Domain\Contracts\LanguageModel::complete(Conversation, tools, CompletionOptions): Completion` with provider-neutral value objects (`Domain\Llm`);
  - providers `AnthropicLanguageModel` (Claude Messages API over Laravel's HTTP client — no SDK; `anthropic-version` `2026-10-21`, top-level `cache_control`, `output_config.effort`, `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`, opaque blocks echoed, retries on 429 / 5xx / connection errors with backoff and `retry-after`, errors → `AiUnavailable`, key never logged), `NullLanguageModel` (AI off / no key) and `FakeLanguageModel` (tests; `AI_PROVIDER=fake` outside production);
  - `AiGate` (application switch × provider configured × organization switch), `AiRunner` (gate, budget, usage row), `UsageMeter`, `AiRequestLog`, `AiSettingsService`, `NarrativeWriter`, `Prompts`.
- **Tools** (the only data the model can reach): one per registry report the user may run (`ReportRunner::run()` with `ParameterResolver`, branch scope and cost stripping; `branch` / `store` entity parameters only; `sort` enum; `additionalProperties: false`; ≤ 50 rows + totals), `dashboard_kpis`, `reorder_suggestions` (SC1, `StoreAccess`), `sales_anomalies`, `slow_movers`, `shortage_risk`. Server-side tool loop, at most `AI_MAX_TOOL_ROUNDS` (4) rounds, then a final answer with `tool_choice: none`. Rejected calls go back to the model as tool errors.
- **Endpoints:**
  - `POST /ai/ask` (`ai.ask`, 20/min/user): `{question, branch_id?, history?}` → `answer` (Markdown), `report` (key, title, params, columns, rows ≤ 50, totals, total_rows, omitted_columns, `link` to `/reports/<key>?…`) or `null`, `tools_used`, `usage`, `model`, `refused`, `truncated`;
  - `POST /ai/explain-reorder` (`ai.ask` + `purchases.view`): a prioritised narrative over one store's SC1 suggestions (`nothing_to_explain` without a model call);
  - `GET /ai/insights?period=daily|monthly&date=&branch_id=` and `GET /ai/customer-insights?branch_id=` (`ai.insights`): facts always, `narrative` + `narrative_status`;
  - `GET/PATCH /ai/settings`, `GET /ai/usage?month=` (`ai.manage`).

  Shapes and errors: [API_DOCUMENTATION.md § AI](docs/API_DOCUMENTATION.md#ai-assistant-and-insights-phase-8--ai1).
- **Business insights** (`InsightsCalculator`): KPIs vs the previous period (daily: the day before; monthly: the same number of days of the previous month), top 5 movers up / down, anomalies (|z| ≥ 2.5 against the trailing 28 days, sample σ, ≥ 14 trading days), margin drop (≥ 5 points), return spike (≥ 5 % and double the previous rate), slow movers (stock, no sales in 30 days), shortage risk (SC1 days of cover < lead time).
- **Customer insights:** RFM over 365 days of `sales_by_customer` (quintile scores, ties shared) → Champions, Loyal, Potential, New, At risk, Hibernating; top 5 per segment masked (name only with `customers.view`, last 3 phone digits); loyalty suggestions by rule (`remind_points`, `win_back_points`, `reward_champions`, `second_purchase`, `enroll_potential`, `reactivate`).
- **Tables** (`AI/Infrastructure/Database/Migrations/2026_11_10_100000_create_ai_tables`): `ai_settings` (organization switch, budget override, `data_sharing_level` `aggregates`), `ai_requests` (usage and audit: feature, tools, validated parameters, tokens, model, status, duration, error code, redacted summary — no questions, answers, prompts or rows), `ai_insights` (cached closed-period insights per organization / branch × period × day × cost visibility).
- **Scheduler:** `ai:daily-insights` every 30 min (`withoutOverlapping`), from 07:30 organization time, yesterday's insight per organization and active branch, idempotent; `--any-hour`, `--date=`.
- **Budget:** per organization per month (organization timezone), default `AI_MONTHLY_TOKEN_BUDGET` 2 000 000, `0` = unlimited; checked before each call → `429 AI_BUDGET_EXCEEDED` (`details.budget`, `used`, `month`).
- **Config** `config/ai.php` and `.env.example`: `AI_ENABLED` (false), `AI_PROVIDER` (anthropic), `AI_MODEL` (`claude-sonnet-5-5`), `AI_API_KEY`, `AI_TIMEOUT` (30), `AI_MAX_TOOL_ROUNDS` (4), `AI_MONTHLY_TOKEN_BUDGET`, `AI_TOOL_ROW_LIMIT` (50), `AI_ASK_RATE_LIMIT` (20), `AI_MAX_TOKENS` (8000), `AI_EFFORT` (low), `AI_REFUSAL_FALLBACK` (true), `AI_MAX_RETRIES` (2), `AI_ANTHROPIC_BASE_URL`, `AI_ANTHROPIC_VERSION`; `AI_RETRY_BASE_MS` / `AI_RETRY_MAX_MS` in config only.
- **Permissions:** `ai.ask`, `ai.insights`, `ai.manage`.
- **Shared** `AiFeatures` contract (default `NoAiFeatures`); **Loyalty** `LoyaltyBalances` contract (`EloquentLoyaltyBalances`); **Reports** `SalesFacts` `customer` dimension and the report `sales_by_customer`.
- **Admin:**
  - *AI Insights* (`/ai`, sidebar after *Reports*, `ai.insights` or `ai.ask`), tabs *Ask* (example questions, safe Markdown answer, report table with *Open full report*, tools used, token usage, error states), *Business* (daily / monthly facts, anomalies, slow movers, shortage risk, narrative card), *Customers* (segment cards, masked top customers, suggestions);
  - *Organization → AI* card (`ai.manage`): switch, monthly budget, data sharing level, usage this month by feature;
  - *Purchasing → Reorder*: *Explain with AI* side panel;
  - safe Markdown renderer (`features/ai/markdown.ts`, no new dependency): paragraphs, headings as bold, lists, fenced code, tables, bold / italic / code; raw HTML and links shown as text.
- Tests: backend 37 new (`AI/Tests`: `SalesAnomaliesTest` 5, `RfmScorerTest` 3, `InsightRulesTest` 4, `AnthropicLanguageModelTest` 7, `AskAiTest` 8, `ToolsAreReadOnlyTest` 1, `BusinessInsightsTest` 4, `CustomerInsightsTest` 1, `AiSettingsAndReorderTest` 3; `Reports/Tests/Feature/SalesByCustomerReportTest` 1). Frontend 35 new Vitest tests (31 in `features/ai`). New mocked Playwright `ai-admin.spec.ts` (6 tests × 2 projects). New full-stack test for AI switched off.

#### Changed
- **Role map:** Branch Manager `ai.ask` + `ai.insights`, replacing the undefined `ai.*` (which would have granted `ai.manage` once the permission existed); Accountant `ai.ask` + `ai.insights`; Inventory Manager `ai.ask`; Cashier and Online Store Manager none; Organization Admin through `*`. Run `php artisan pos:permissions:sync`.
- **Reports:** 18th report `sales_by_customer` (customers group, `reports.view`; walk-ins excluded; `gross_profit` cost-sensitive). `GET /reports` lists 18 for Organization Admin, Branch Manager and Accountant, 16 for the Inventory Manager.
- **`/auth/me`** (and login / registration) returns `ai_enabled`.
- *Organization* page and sidebar entry open for `organization.view` **or** `ai.manage`.
- `phpunit.xml` forces `AI_ENABLED=false`, empty `AI_API_KEY` and `AI_PROVIDER=anthropic`.

#### Notes
- **AI is off by default** (`AI_ENABLED=false`). With AI off, or the organization switched off, or no key: `/ai/ask` and `/ai/explain-reorder` answer `503 AI_UNAVAILABLE` (not logged), the insight pages return their facts with `narrative: null`, and nothing else changes (tested).
- **The live Anthropic call is not verified yet:** no key on the dev box. The request and response handling follow the Messages API reference and are tested against faked HTTP responses only. Make a test call in staging before enabling AI in production.
- **Least data:** ≤ 50 rows + totals per tool; `phone`, `email`, `customer_id`, `code` removed; customer names → `Customer #n`; customer insights send segment aggregates only; the dashboard tool leaves out recent transactions.
- **Deviations from the AI1 brief:**
  1. A new report `sales_by_customer` was added to the registry as the RFM input, rather than a query of the AI module's own.
  2. One `AskAssistant` covers the sales and inventory assistant (by its tools) instead of separate assistant classes.
  3. Insights live in `Application/Insights`; the daily run is an artisan command scheduled every 30 min (effective from 07:30 local) rather than a job class.
  4. Default model `claude-sonnet-5-5`, effort `low`, server-side refusal fallback on.
  5. Extra response fields: `narrative_status`, `cached`, `ai_enabled` (insights), `refused`, `truncated`, `total_rows`, `omitted_columns` (ask).
  6. Narratives are English only (no language parameter); Ask answers in the language of the question.
  7. The budget is checked before each request, so a request may finish slightly above it.
  8. Only `branch` / `store` entity parameters are offered to the model (it cannot know product or customer ids).
  9. The admin does not expose the insights `date` parameter or multi-turn history yet.
- A cached insight is shared by all users of its scope. Its narrative is written from facts that include shortage risk, which the response hides from users without `purchases.view` (every built-in role with `ai.insights` has it).
- **Run `php artisan migrate` and `php artisan pos:permissions:sync`** after deploying. Production also needs the scheduler for `ai:daily-insights`, outbound HTTPS to `api.anthropic.com` and `AI_API_KEY` from the secret store ([DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)).
- Results:
  - backend 747 tests (741 pass, 6 skipped), Pint clean;
  - frontend typecheck, lint, build and 875 Vitest tests (116 files);
  - mocked Playwright 154 pass, 50 skipped (+2 skipped: the new full-stack test on both projects without `E2E_BACKEND`);
  - full stack 24/24 on desktop against a fresh seed, including the new "with AI switched off the insights still show their figures and the assistant says it is off".
- Open issues: the **PostgreSQL run is still pending** (AI tables and CHECKs, plus the Phase 7 report SQL). **AI2** (online store: descriptions and SEO with approval, category suggestions, co-purchase recommendations, support assistant) is next.

### Phase 7 — Reports and dashboard analytics

A registry of 17 whitelisted reports (sales, inventory, purchasing, finance, customers) with typed parameters, a dashboard, and CSV next to Excel and PDF on every export. One shared definition of sales covers POS and web orders. The registry is the list that natural-language reporting (Phase 8 / E13) will choose from.

#### Added
- **Reports module** (`app/Modules/Reports`, read models only, no tables): `ReportRegistry` (whitelist), `ReportDefinition` / `ReportParam` / `ReportColumn` / `ReportGroup`, `ParameterResolver`, `ReportRunner`, one query class per report (`Application/Reports/*`), `Support\SalesFacts`, `Dashboard`. Reports read other modules' tables read-only under the read-model exception and aggregate in SQL (`GROUP BY`).
- **Catalog:** `GET /reports` (`reports.view` or `reports.financial`) returns the definitions the user may run: `key, title, description, group, group_label, permission, financial, time_based, granularity, max_range_days, params[], columns[], default_sort, totals, paginated, omitted_columns`; `meta.groups`. `cashier_id` carries `options`: users of the viewer's branches plus anyone who sold there. These options let users without `users.view` filter by cashier.
- **Run:** `GET /reports/{key}?<params>&sort=&page=&per_page=` returns `data` (one page of rows) and `meta {report, pagination, totals, params (resolved + timezone, currency), sort, generated_at, columns, omitted_columns}` plus report-specific meta (P&L `previous_period`, `summary`; dues `as_of`, `includes_opening_balances`; valuation `as_of`; stock movements opening/closing quantity in `totals`). Errors: unknown key 404, missing permission 403, invalid parameter or sort 422 `VALIDATION_FAILED`, range too long 422 `RANGE_TOO_LARGE`.
- **17 reports:** `sales_daily`, `sales_monthly`, `sales_by_product`, `sales_by_category`, `sales_by_branch`, `sales_by_cashier`, `profit_and_loss` (financial), `inventory_valuation`, `stock_movements`, `low_stock`, `expiry`, `purchases`, `customer_dues`, `supplier_dues`, `payment_collections`, `tax` (financial), `expenses`. Parameters, columns and formulas: [API_DOCUMENTATION.md § Reports](docs/API_DOCUMENTATION.md#reports-and-dashboard-phase-7).
- **Dashboard:** `GET /dashboard?branch_id=&date_from=&date_to=` (`dashboard.view`; default the last 30 days up to today, at most 366 days). Returns `kpis` (`total_sales`, `today_revenue` vs yesterday, `orders_count`, `gross_profit` (null without `products.view_cost`), `average_ticket`, `returns_amount`), each as `{value, previous, change, change_pct}` against the previous period of equal length. Also returns `sales_trend` (every day; POS / online split; gross profit only with cost access), `top_products` (10), `low_stock` `{count, items (10)}`, `recent_transactions` (10; web orders only with `web_orders.view`), `sales_by_channel`, and `sales_by_branch` (null for one branch). It is cached for 60 s.
- **CSV export** (Shared): `ExportFormat::Csv`, `Infrastructure\Export\CsvExportWriter`. The file is UTF-8 with BOM and follows RFC 4180: CRLF line ends and quoted fields when needed. It has one header row. Numbers are plain decimal strings, dates are `Y-m-d`, and date-times are `Y-m-d H:i` in the organization's timezone. Formula-injection guard: text starting with `= + - @`, a tab or CR gets a leading `'`. It is streamed to a temporary file like xlsx. Row limit 100 000 (`EXPORT_MAX_ROWS_CSV`). Reports export with `?export=xlsx|csv|pdf`: every row in the requested sort, plus a *Total* row when the report has totals. The stem is `report-<key with hyphens>`, e.g. `report-sales-by-product-demo-mart-20261107-1430.csv`. The filter summary looks like "Period: … · Branch: …". Throttle, row limits and audit are the same as X1.
- **Permissions:** `reports.view` (operational reports; cost and profit columns also need `products.view_cost`), `reports.financial` (profit and loss, tax), `dashboard.view`.
- **Indexes** (`Reports/Infrastructure/Database/Migrations/2026_11_09_100000_add_reporting_indexes`, `CREATE INDEX IF NOT EXISTS` on both drivers): `sales (organization_id, status, sold_at)`, `sale_returns (organization_id, status, decided_at)`, `orders (organization_id, status, delivered_at)`, `order_returns (organization_id, status, refunded_at)`, `payments (organization_id, created_at)`, `goods_receipts (organization_id, invoice_date)`, `purchase_returns (organization_id, created_at)`.
- **Admin:**
  - *Dashboard* (`src/features/dashboard`): KPI cards with the change against the previous period, sales trend, POS vs online bars, top products, low stock with a *Reorder* link (`purchases.view`), recent transactions linking to sales and web orders, and branch and date-range filters.
  - *Reports* (`src/features/reports`): a catalog grouped by section. Each report page is built from its definition:
    - a filter bar from the parameter schema: date presets Today / Yesterday / This week / This month / Last month / This year, and entity pickers gated by their list permissions, with values from a shared link shown as removable chips;
    - a sortable table with `aria-sort`, a sticky first column, a totals row, pagination (25 / 50 / 100 / 200, default 50) and an *Export* menu;
    - cost columns hidden with a note;
    - parameters kept in the URL;
    - an inline chart for daily and monthly sales;
    - P&L shown as a statement with sections, subtotal rules, a double rule under net profit, negatives in brackets and a previous-period column.
  - Charts (`src/components/common/charts`: `trend-chart`, `bar-chart`, `chart-data-table`, `chart-utils`) are hand-rolled SVG with no chart library. They have one tab stop, arrow keys / Home / End with a tooltip on focus and hover, a visually hidden data table, and colours `--viz-1..3` that work in light and dark themes.
- **Demo data** (`DemoReportsSeeder`, runs last, through the real actions, on products of its own): 60 days of POS history, returns and delivered web orders, and the user `manager@demo.test` (Branch Manager). Details under Notes.
- Tests: backend 29 new (`Reports/Tests`: `SalesReportsTest` 7, `ReportAccessTest` 8, `OperationalReportsTest` 3, `DashboardTest` 3, `ReportExportTest` 3, `Unit/AgingTest` 3; `Shared/Tests/Unit/CsvExportWriterTest` 1; `ExportableListsTest` +1 list). Frontend 43 new Vitest tests (charts 9, reports 24, dashboard 7, routes and export menu). New mocked Playwright `reports-admin.spec.ts` (3 tests × 2 projects). New full-stack test for the dashboard, reports and CSV.

#### Changed
- **Landing page:** `/` goes to the first sidebar entry, which is now *Dashboard* for every role with `dashboard.view`: Organization Admin, Branch Manager, Accountant, Inventory Manager. Users who can `pos.sell` but hold neither `reports.view` nor `reports.financial` stay on the POS terminal (cashiers). Sidebar: *Dashboard* first, *Reports* after *Expenses*.
- **CSV on every export:** every X1 list accepts `?export=csv`, and the *Export* menu offers *Excel (.xlsx)*, *CSV (.csv)* and *PDF* everywhere. Before, `csv` answered 422. Other values still do: the validation test now uses `ods`. The `EXPORT_TOO_LARGE` message names the format ("CSV exports are limited to …").
- **Role map:**
  - Branch Manager and Accountant: `reports.*` (= `reports.view` + `reports.financial`) + `dashboard.view`.
  - Inventory Manager: `reports.view` + `dashboard.view`, replacing the undefined `reports.inventory`.
  - Cashier: `dashboard.view` (own branches, no profit figures without `products.view_cost`).
  - Organization Admin through `*`.

  Run `php artisan pos:permissions:sync`.
- **Demo history:** the seed now holds 60 days of trading. After a fresh seed, the next numbers are `INV-MAIN-000279`, `RET-MAIN-000009` and `WEB-000010` (they were `INV-MAIN-000003`, `RET-MAIN-000001` and `WEB-000004`).
- Full-stack `integration.spec.ts`: 15 owner sign-in assertions expect the *Dashboard* heading instead of *POS terminal*. The shared sign-in helper accepts either.

#### Fixed
- `stock_movements` report: the quantity and cost columns were offered as sort keys but had no SQL order, so `sort=quantity_in` (etc.) would have failed with a server error; they are now `sortable: false` (only `date` sorts → others `422` on `sort`), and `ReportRunner` ignores a sort key without an expression instead of failing. `.env.example` gains `EXPORT_MAX_ROWS_CSV`.

#### Notes
- **Sales definitions** (`SalesFacts`, shared by every sales report, P&L, tax and the dashboard):
  - **POS:** completed sales by `sold_at`, minus completed returns by `decided_at`. Cancelled sales are excluded entirely.
  - **Online:** web orders are recognised **on delivery** (status `delivered`, by `delivered_at`), minus web returns with status `refunded` (by `refunded_at`). Pending, confirmed, shipped, cancelled and failed orders never count.
  - **Amounts:** net = Σ line net after item and invoice discounts, excluding tax. Gross = net + discounts. Returns = returned net excluding tax. Net sales = gross − discounts − returns. Tax-inclusive organizations report net of tax.
  - **Tax:** output tax = line tax − returned tax.
  - **Delivery income:** shipping + COD fees of delivered orders − shipping refunds, kept out of net sales. It is 0 when a product, category or brand filter is set, or for product, category, brand, cashier or tax-rate groupings.
  - **Orders:** POS sales + delivered web orders.
- **COGS** = Σ line `cost_total` snapshots (the stock ledger's weighted-average cost of the goods out at the time, which includes landed costs) − cost of returned lines that were restocked. Written-off returns keep their cost. Value-only landed cost expenses on stock already sold (SC3, on account) are operating expenses in the P&L, not COGS.
- **Registry = whitelist.** Nothing outside `ReportRegistry::REPORTS` can run, and parameters are typed and resolved on the server. The branch scope is the user's branches ∩ `branch_id` and never comes from the client alone. Phase 8 natural-language reporting will map a question to one key and its parameters ([AI_INTEGRATION.md](docs/AI_INTEGRATION.md)).
- **Deviations from the Phase 7 brief:**
  1. COGS comes from sale / order line cost snapshots rather than from re-reading stock movements; it is the same figure, recognised with revenue.
  2. Column type `datetime` was added (stock movements).
  3. Daily and monthly sales are two keys (`sales_daily`, `sales_monthly`).
  4. `per_page` allows at most 500.
  5. Every money column of `purchases` is cost-sensitive.
  6. Opening balances count in customer and supplier dues only when the report covers every branch (`includes_opening_balances`).
  7. A branch or store the user cannot access is a 422, not an empty report.
  8. P&L amounts are signed, with expense and income categories by name.
  9. CSV was added to every list, not only reports.
  10. On SQLite, local days use the zone's fixed UTC offset at the start of the range (exact for Asia/Dhaka); on PostgreSQL they use `AT TIME ZONE` (DST-aware).
  11. `low_stock` uses Purchasing's `ReorderSuggestions`, which is not a published contract.
  12. Indexes on other modules' tables live in the Reports migration (the E12a precedent).
  13. P&L and tax figures, COGS included, are not cost-gated: `reports.financial` is enough. Every built-in role that has it also has `products.view_cost`.
- **No views or materialized views** in Phase 7: each report is one aggregate query family over the source tables. Daily summary tables or materialized views can follow if PostgreSQL `EXPLAIN` on production-sized data asks for them.
- **Demo history** (`DemoReportsSeeder`): it changes no figure the full-stack tests assert. Juice stays 54 and rice 321. `WEB-000001`–`003`, `PO-000001`–`004` and `GRN-000001`–`003` are unchanged, and so are the owner's and cashier's open shifts. It adds:
  - categories *Snacks* (under *Grocery*) and *Household*;
  - four products: *Butter Cookies 200g* (VAT 15 %), *Atta Flour 2kg* (no VAT), *Bath Soap 100g* (VAT 15 %, batch `SOAP-A` expiring 12 days after seeding), *Dishwashing Liquid 500ml* (VAT 7.5 %, reorder level above stock, so it shows as low stock);
  - an opening adjustment 61 days back;
  - user *Demo Floor Manager* `manager@demo.test` / `password` (Branch Manager, Dhaka Main) on the new register *T3 — Counter 2*;
  - 61 closed shifts `SES-MAIN-000003`…`063`;
  - 276 POS sales `INV-MAIN-000003`…`278`;
  - 8 returns `RET-MAIN-000001`…`008`;
  - 6 delivered COD web orders `WEB-000004`…`009` (RedX). Listings are published only while ordering, so the storefront catalogue is unchanged.
- **Run `php artisan pos:permissions:sync`** after deploying. Until then nobody, the Organization Admin included, sees *Dashboard* or *Reports*.
- Results:
  - backend 710 tests (704 pass, 6 skipped), Pint clean;
  - frontend typecheck, lint, build and 840 Vitest tests (112 files);
  - mocked Playwright 142 pass, 48 skipped (+2: the new full-stack test on both projects without `E2E_BACKEND`);
  - full stack 23/23 on desktop: 22 on a fresh seed, plus the Phase 7 test on the same database.
- Open issues: the **PostgreSQL run is still pending**, including `EXPLAIN` of the report and dashboard SQL against the new indexes.

### SC3 — Landed cost and supplier performance (supply chain)

Freight, duty and similar charges become part of the stock cost — on the goods receipt, or later through landed cost vouchers — and are owed to whoever bills them; a supplier scorecard measures on-time delivery, fill rate, returns, price changes and quote responsiveness. Third and last slice of the supply chain track.

#### Added
- **Charges on goods receipts** (Purchasing, `goods_receipt_charges`, append-only): `POST /purchasing/receipts` takes `charges: [{type, description?, amount, tax_amount?, allocation, charge_supplier_id?}]` (≤ 20; type `freight|duty|insurance|handling|other`, description ≤ 120, amount > 0 and tax ≥ 0 with 2 decimals, allocation `value|quantity`). Each charge is spread over the receipt lines by line subtotal (before tax) or base quantity with the largest-remainder method (`Money::allocate`, ties to the earlier line; a value charge over lines all worth 0 falls back to quantity), so its parts add up to the cent. `goods_receipt_lines.landed_cost` = the line's share, `landed_unit_cost` = round(unit_cost + landed_cost ÷ quantity, 4 dp), and **stock enters at the landed unit cost**, so the weighted average (and each batch level) includes the charges. The charge's tax is recoverable and not capitalised. Receipts gain `charges_total`, `charges_tax_total`, `landed_total` (subtotal + charges), `payable_total` (total + charges with tax that no other supplier bills); lines `landed_cost`, `landed_unit_cost`, `voucher_landed_cost` (added later by vouchers); the detail `charges[]` (with `charge_supplier`) and `landed_cost_vouchers[]`. Pure `Purchasing\Domain\LandedCost\LandedCostAllocator`.
- **Payables for charges:** a charge without `charge_supplier_id` is part of the main supplier's invoice (`payable_total`); a charge with one is owed to that supplier (amount + tax) and appears on its statement as `receipt_charge` "Charge on GRN-…: Freight — …" (id and number = the receipt's). Supplier balance = opening balance + receipts' `payable_total` + receipt charges the supplier billed + posted vouchers it billed − purchase returns − payments. Payments stay on account (not matched to documents), so a charge is settled like any invoice. Purchase returns still credit the supplier's unit cost.
- **Landed cost vouchers** (`LCV-000001`; `landed_cost_vouchers`, `landed_cost_voucher_charges`, `landed_cost_voucher_receipts`, append-only `landed_cost_allocations`) for bills that arrive after the goods: `draft → posted`, no void. A voucher belongs to one branch and names the supplier that bills it (`charge_supplier_id`, required, active), a voucher date not after the organization's today, the supplier's bill number (`reference`, ≤ 64), notes, 1–20 charges and 1–50 goods receipts of its branch. **Posting** (`Idempotency-Key`, one transaction; voucher row locked, then the stock levels in `store|variant|batch` order; audited `landed_cost_voucher.posted`) spreads the charges over all lines of the chosen receipts (same allocator, receipts in voucher order, then line id) and splits each line's amount by the quantity **still on hand from that receipt**: the on-hand share becomes one value-only `landed_cost` stock movement per level (quantity 0, the weighted average rises), the share of stock already gone (sold, used, written off or returned) becomes one expense "Landed cost on sold stock" (category created on first use) dated the voucher date, reference the voucher number, party the charge supplier, **booked on account**. The voucher total (charges + tax) is owed to the charge supplier (statement entry `landed_cost_voucher`). Allocation rows keep received and on-hand quantity, amount, on-hand and consumed amounts, average cost before and after and the movement id.
- **Voucher API:** `GET /purchasing/landed-cost-vouchers` (`purchases.view`; `status`, `branch_id`, `charge_supplier_id`, `goods_receipt_id`, `from`/`to`, `search`; sort `created_at|voucher_date|number|total`), `GET …/{id}` (`allocation_source` `posted` — the stored rows — or `preview` — live against today's stock while draft), `POST …/preview` (draft body → allocation table; nothing saved), `POST` (create draft; the number is taken at once), `PUT …/{id}` and `DELETE …/{id}` (drafts only, else 422 `LANDED_COST_VOUCHER_LOCKED`), `POST …/{id}/post` (`Idempotency-Key`; 422 `INVALID_STATUS_CHANGE` once posted, `LANDED_COST_VOUCHER_INCOMPLETE` without a charge or receipt). Writes and the preview need the new **`purchases.landed_cost`**.
- **Value-only stock adjustments** (Inventory): contract `StockValuation` (`EloquentStockValuation`) — `revalue(list<StockRevaluation>, StockReference)` locks the levels, sets average = (quantity × average + value) ÷ quantity (4 dp) and appends one movement per level (quantity 0, `unit_cost` = the per-unit increase, `value` = the value added); `onHandFromDocument()` attributes a level's stock on hand to the inbound document that brought it. Movement type `landed_cost`; new `stock_movements.value` (NULL for every other type; returned with `products.view_cost`). `StockChange` refuses value-only types.
- **On-account expenses** (Expenses): `ExpenseRecorder::recordSystemExpense([… 'on_account' => true])` books an expense owed to a supplier — no payments-ledger entry, `method` is how it will be settled (`bank_transfer` for landed costs); `expenses.on_account`, list field `on_account`, `method_label` "On supplier account"; `POST /expenses/{id}/void` answers 422 `EXPENSE_ON_ACCOUNT`.
- **Supplier performance** (read model, no writes): `GET /purchasing/supplier-performance?date_from=&date_to=&branch_id=&supplier_id=&sort=` (`purchases.view`; organization dates, default the last 90 days up to today, at most ten years; `meta.period` with the previous period of equal length; not paginated; sort by `score` (default `-score`), `name` or any metric, empty values last) → one row per supplier with activity in the range: `orders`, `spend`, `on_time_rate`, `fill_rate`, `avg_lead_days`, `return_rate`, `price_change_pct`, `quote_response_rate`, `quotes_won`, late / short delivery counts, `score` (0–100, integer string) with `score_components` and `score_weights`. `GET /purchasing/suppliers/{id}/performance` → the same metrics, a 12-month trend (orders, on-time rate, fill rate, spend) and up to 20 late or short deliveries (PO, expected and received dates, days late, ordered / received / short quantity). **Score** (pure `Domain\Performance\SupplierScore`): on time 35, fill 30, returns 15 (100 − 5 × return rate), price stability 10 (100 − 5 × max(0, price change %)), quote responsiveness 10; components clamped to 0–100; a metric without data is left out and the other weights are scaled up to 100; no metric → null. Formulas: [API_DOCUMENTATION.md § SC3](docs/API_DOCUMENTATION.md#supply-chain--landed-cost-and-supplier-performance-sc3).
- **Exports (X1):** landed cost vouchers (`landed-cost-vouchers`) and supplier performance (`supplier-performance`); the goods receipts export gains *Charges* and *Payable*.
- `GET /purchasing/receipts` filter `branch_id`.
- **Permission** `purchases.landed_cost` ("Create, edit, delete and post landed cost vouchers").
- **Admin** (`src/features/landed-cost`, `src/features/supplier-performance`): receipt editor *Charges* card (type, description, amount, tax, allocation, *Billed by* — default "This invoice") with a live per-line landed-unit-cost preview computed in the browser with the server's rounding (`allocation.ts`, BigInt, largest remainder); receipt detail with charges, *Charges* / *Landed unit cost* / *Later vouchers* columns and goods, charges, landed and payable totals; *Purchasing → Landed costs* (`/purchasing/landed-costs`: status tabs, search, *Export*; editor `/purchasing/landed-costs/new` — billed by, date, supplier bill number, notes, charges, searchable receipt picker with other branches' receipts disabled, debounced server preview of on-hand vs sold shares and new landed unit costs; *Save draft*, *Delete*, *Save & post* with confirmation and `Idempotency-Key`; detail with the posted allocation and the expense number); *Purchasing → Supplier performance* (`/purchasing/supplier-performance`: date range and branch in the URL, default the last 90 days in the organization's timezone, score badge — 80+ *Good*, 60–79 *Fair*, below 60 *Poor* — sortable columns with `aria-sort`, *Export*); supplier page *Performance* tab (`?tab=performance`: KPI cards, 12-month trend table without a chart library, late / short deliveries); supplier statement labels *Charge* and *Landed cost*; movement type label "Landed cost (value only)".
- **Demo data** (`DemoLandedCostSeeder`, runs last, through the real actions; earlier documents, numbers and the stock the full-stack tests count unchanged): suppliers *Dhaka Apparel Sourcing* and *Sundarban Freight Services*; `PO-000003` (Cotton Polo Shirt L 15, XL 10; ordered 40 days ago, expected 30 days ago) received late and short 27 days ago as `GRN-000002` (L 15, XL 6) with sea freight 600.00 + 90.00 VAT by value billed by Sundarban and handling 150.00 by quantity on Apparel's invoice (landed unit cost L 315.1427, XL 337.1433), 2 XL returned (`PRN-000001`); `PO-000004` (L 10) received complete and on time as `GRN-000003`; `LCV-000001` from Sundarban (`SFS-INV-5521`, 800.00 customs duty by value on `GRN-000002`, posted): L 560.00 to stock, XL 240.00 = 160.00 to stock + 80.00 expensed as `EXP-000002`.
- Tests: backend `Purchasing/Tests/Unit/LandedCostAllocatorTest` (4), `SupplierScoreTest` (3), `Feature/LandedCostTest` (6), `Feature/SupplierPerformanceTest` (4), `ExportableListsTest` (+2 lists); frontend 27 Vitest tests (`landed-cost/allocation.test.ts` 11, `receipt-charges.test.tsx` 4, `pages/voucher-pages.test.tsx` 5, `supplier-performance/supplier-performance.test.tsx` 7) plus the two lists in `exportable-lists.test.tsx`; mocked Playwright `landed-cost-admin.spec.ts` (3 × desktop/mobile); full-stack `landed costs reach stock cost and the supplier scorecard shows a late, short supplier`.

#### Changed
- `PostGoodsReceipt` posts stock at the landed unit cost (= the unit cost when the receipt has no charges) and stores the charges and the landed and payable totals.
- Supplier balances (`GET /purchasing/supplier-balances`) and statements count a receipt at its `payable_total` instead of `total` and add receipt charges and posted vouchers billed by the supplier; statement entry types `receipt_charge`, `landed_cost_voucher`.
- **Role map:** Branch Manager, Inventory Manager and Accountant gain `purchases.landed_cost` (Organization Admin through `*`). Run `php artisan pos:permissions:sync`.
- Purchasing tabs: *… Receipts, Returns, Landed costs, Supplier payments, Supplier performance, Settings*.
- `PurchasingContext::requireActiveSupplier()` takes the field to report on (`charge_supplier_id`, `charges.N.charge_supplier_id`).

#### Fixed
- Shared lines editor (`components/common/lines-editor.tsx`: purchase order, goods receipt, stock adjustment and transfer editors): on phones the table's screen-reader-only header text escaped the horizontal scroll container and widened the page to about 764 px; the scroll container (and the receipt lines card) is now `relative`.

#### Notes
- **Valuation decision: value-only adjustments are safe.** Inventory value is Σ quantity × average cost over `stock_levels` rows (one per store × variant × batch). Adding value V to a level with quantity q > 0 sets the average to (q · average + V) ÷ q (4 dp): the quantity does not move, the level's value grows by V (up to the 4-dp rounding of the average) and later outbound movements leave at the new average. A level without positive stock is never revalued (its share is expensed). The operation is a separate contract (`StockValuation`) rather than a method on `StockLedger`, so the quantity write path and the test doubles that implement it stay unchanged; it takes the same `store|variant|batch` lock order, so it cannot deadlock with a stock posting.
- **Attribution: newest stock on hand.** The ledger pools units per level, so the quantity still on hand from a receipt is clamp(level quantity now − quantity posted into that level by other documents after the receipt, 0, quantity the receipt brought), capped by received − returned; several lines of one receipt on the same level take it last line first. This assumes first-in-first-out consumption; it is exact for batch-tracked lines whose batch no other document fills. Products that do not track stock have nothing on hand (everything expensed).
- **On-account expense:** the consumed share is an expense, not a payment — it is part of the voucher total owed to the charge supplier and is settled by a supplier payment, so it writes no payments-ledger entry and cannot be voided on its own. Its `method` is `bank_transfer`, so `GET /expenses?method=bank_transfer` also lists landed-cost expenses. The category is "Landed cost on sold stock" also for the share of units returned to the supplier.
- **Deviations from the SC3 brief:** (1) `charge_supplier_id` is required on vouchers; (2) vouchers are `draft|posted` only (no void) and take their number when the draft is created, so a deleted draft leaves a gap; (3) the voucher preview is `POST /purchasing/landed-cost-vouchers/preview` with the draft body, and receipt charges have no preview endpoint (the editor computes it with the server's rounding); (4) `ExpenseRecorder` gains `on_account` and Inventory a new `StockValuation` contract; (5) the performance list is not paginated and `score` is a string; (6) price change uses the supplier's unit price (line subtotal ÷ quantity), not the landed cost; (7) additions: receipts `branch_id` filter, receipts export *Charges* / *Payable*, `stock_movements.value`, `score_components` / `score_weights`, late / short counts.
- **Demo valuation changes:** stock quantities the full-stack tests assert are unchanged (juice 54, Miniket rice 321 at 61.7147, polo M 12). Polo L 15 → 40 (average 320.0000 → 323.4286) and XL 8 → 12 (340.0000 → 352.1090); total inventory valuation about 37 037.42 → 46 679.87. Balances: Dhaka Apparel Sourcing 9 637.50, Sundarban Freight Services 1 490.00 (690.00 freight + 800.00 duty); Pran 0.00 and Local Mills 6 100.00 unchanged.
- **Run `php artisan pos:permissions:sync`** after deploying (see [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)); until then nobody, the Organization Admin included, can create or post vouchers.
- Results: backend 681 tests (675 pass, 6 skipped — 5 PostgreSQL-only and the opt-in real PDF; +23: 19 for SC3 and the 4 `PurchaseOrderCancelReleaseTest` cases of the SC2 fix that were not in the SC2 count), Pint clean; frontend typecheck, lint, build and 797 Vitest tests (108 files); mocked Playwright 135 pass, 46 skipped (+1 load-flaky: a different mocked test flakes on each full run — this time the online-catalog carousel — and all pass on repeat, 24/24); full-stack 22/22 on desktop on a fresh seed, including the new landed cost test.
- Open issues: the **PostgreSQL run is still pending** — the new CHECKs (`stock_movements_value_only_check`, the landed cost CHECKs) and the append-only triggers have not run on PostgreSQL.
- **Supply chain track complete (SC1–SC3).**

### SC2 — Purchase requisitions, approvals and supplier quotes (supply chain)

Branches raise purchase requisitions, an approver chosen by amount approves them, approved requisitions become purchase orders and/or requests for quotation; purchase orders need approval above the auto-approve limit; supplier quotes are compared and awarded. Second slice of the supply chain track.

#### Added
- **Approval limits** (Purchasing, `purchase_approval_settings`, one row per organization; defaults until saved): `auto_approve_limit` 10 000.00 (at or below: no approval), `manager_limit` 100 000.00 (above auto and at or below: `purchases.approve` or `purchases.approve_high`; above: `purchases.approve_high`), `require_po_approval` (default `true`). Boundaries belong to the lower tier; CHECK `0 ≤ auto ≤ manager`. `GET /purchasing/approval-settings` (any of `purchases.view|request|approve|approve_high|settings`), `PATCH` (`purchases.settings`); audited. Pure `Purchasing\Domain\Procurement\ApprovalPolicy` (`level()`, `preApprovalCeiling()` = approved × 1.05, `share()`) and `ApprovalLevel` (`none|manager|high`).
- **Single-step tiered approval:** the amount (estimated or order total incl. tax, base currency) decides the level when the document is submitted; one approval by an eligible approver completes it. The approver needs the level's permission and access to the document's branch and must not be the requester / creator / submitter — 403 `SELF_APPROVAL_NOT_ALLOWED` (also for the Organization Admin), 403 `APPROVAL_LIMIT_EXCEEDED` `{approval_level, required_permission, amount}`. Later limit changes do not touch submitted documents.
- **Purchase requisitions** (`purchase_requisitions`, `purchase_requisition_lines`, append-only `purchase_requisition_status_history`; numbers `PR-000001`): `draft → submitted → approved → converted`, `submitted → rejected` (reason required), `cancelled` (requester while draft / submitted; `purchases.manage` also while approved and nothing converted). Estimated unit costs left empty are prefilled — suggested supplier's catalog row → preferred catalog row → last goods-receipt cost → variant purchase price — and the estimate incl. tax is computed by the server. Submitting at or below the auto-approve limit approves at once (`approved_by` NULL, `auto_approved: true`). API `GET/POST /purchasing/requisitions`, `GET/PUT /purchasing/requisitions/{id}` (drafts only, requester or `purchases.manage`), `POST …/{id}/submit|approve|reject|cancel|convert`, `GET /purchasing/requisitions/estimates?variant_ids[]=&supplier_id=`. Holders of only `purchases.request` see their own requisitions; `purchases.view` and the approve permissions see the branch's.
- **Convert** (`purchases.manage`): `POST /purchasing/requisitions/{id}/convert {purchase_orders?: {lines: [{requisition_line_id, quantity?, supplier_id?}]}, rfq?: {lines, title?, reply_by?, notes?, supplier_ids?}}` → draft purchase orders grouped by supplier (default: the line's suggested supplier, else the preferred catalog supplier; cost = that supplier's active catalog cost, else the estimate) and/or one draft RFQ, in one transaction. Each order is **pre-approved** for the requisition's estimate of the quantities it covers (`purchase_orders.approved_amount`); quantities default to what is still open; the requisition becomes `converted` when every line is fully converted. Links both ways (`purchase_orders.requisition_id`, `rfqs.requisition_id`).
- **Requisition from reorder suggestions:** `POST /purchasing/reorder-suggestions/requisitions` (`purchases.request`, `Idempotency-Key`; `{store_id, needed_by?, notes?, submit?, lines: [{variant_id, quantity, supplier_id?, unit_cost?}]}`) — for branch staff without `purchases.manage`.
- **Purchase order approval:** status `pending_approval` between `draft` and `ordered`. `POST /purchasing/orders/{id}/submit` (`purchases.manage`) → `ordered` when no approval is needed (setting off, total ≤ auto limit, or pre-approved and total ≤ approved amount × 1.05), else `pending_approval` and approvers are notified; `POST …/approve` → `ordered`, `POST …/reject {reason}` → back to `draft` with the reason. Cancel also from `pending_approval`. The PO document gains `requisition`, `rfq`, `approval_level`, `approver_permission`, `pre_approved_amount`, `pre_approval_limit`, `submit_requires_approval`, `submit_approval_level`, submitted / approved / rejected by and at, `rejection_reason`, `history`, `can_approve`; append-only `purchase_order_status_history` (also written on creation and by goods receipts).
- **Requests for quotation** (`purchases.manage` runs them, `purchases.view` reads them; `rfqs`, `rfq_lines`, `rfq_suppliers`, `supplier_quotes`, `supplier_quote_lines`, append-only `rfq_awards` and `rfq_status_history`; numbers `RFQ-000001`): `draft → sent → awarded | closed`, `draft | sent → cancelled`. Created blank (`POST /purchasing/rfqs`) or from requisition lines (convert; those lines are fixed, `RFQ_LINES_LOCKED`); suppliers invited while draft or sent (`POST …/suppliers`; a supplier added to a sent RFQ is issued the request at once), removed while draft (`DELETE …/suppliers/{supplierId}`). **Send** (`POST …/send`) needs a reply-by date, a line and ≥ 2 suppliers (`RFQ_SUPPLIERS_REQUIRED`): per supplier a PDF (X1 `PdfRenderer` + letterhead: number, lines with SKU / item / quantity / unit, blank price and lead-time columns, reply-by, needed-by, notes — never prices), downloadable at `GET …/suppliers/{supplierId}/pdf` (`RFQ-000001-<supplier code>.pdf`); suppliers with an e-mail address get a **queued** e-mail with the PDF attached (`emailed_at`, address recorded), the others are flagged `send_manually`. **Quotes** (`POST …/quotes {supplier_id, status: received|declined, valid_until?, notes?, lines: [{rfq_line_id, unit_price, quantity_offered?, lead_time_days?, notes?}]}`; recording again replaces the answer). **Comparison** (`GET …/comparison`; pure `QuoteComparison`): per line every supplier's unit price, line total (requested quantity × price, tax-exclusive), lead time, validity, flags `lowest_price`, `fastest`, `expired`, `partial`; per supplier total, lines quoted, coverage, `complete`. **Award** (`POST …/award {lines: [{rfq_line_id, supplier_id, quantity}], update_catalog?}`; sent RFQs only; split awards allowed) → one draft PO per supplier at the quoted prices, pre-approved when the RFQ came from an approved requisition, else subject to PO approval; `update_catalog` writes the quoted cost and lead time into the SC1 supplier catalog (row updated or created). `POST …/close` (sent → closed, no award) and `…/cancel`. Quantities an RFQ does not award (closed, cancelled, partly awarded) go back to its requisition (a `converted` requisition reopens as `approved`).
- **Approvals inbox:** `GET /purchasing/approvals` (`purchases.approve` or `purchases.approve_high`) — submitted requisitions and POs pending approval that the user may approve (level, branch, not their own), oldest first; filters `kind`, `approval_level`, `search`; `meta.counts`.
- **Notifications** (in-app, database channel, after commit): `purchasing.requisition_submitted` and `purchasing.order_pending_approval` → eligible approvers of the branch (never the requester / submitter); `purchasing.requisition_approved|rejected` → the requester; `purchasing.order_approved|rejected` → the submitter; `purchasing.rfq_replies_overdue` → the RFQ's creator. No notification on automatic approval.
- **Daily quotes-overdue reminder:** `php artisan purchasing:rfq-reminders [--any-hour]`, scheduled hourly (`withoutOverlapping`); from 07:00 in each organization's timezone, one notification per sent RFQ past its reply-by date with suppliers that have not answered, per local day (claimed in `rfq_reminder_runs`).
- **Permissions** `purchases.request` (raise, edit and submit own requisitions), `purchases.approve` (up to the manager limit), `purchases.approve_high` (above it), `purchases.settings` (approval limits).
- **Exports (X1):** requisitions (`purchase-requisitions`), RFQs (`rfqs`), approvals inbox (`pending-approvals`).
- **Contracts:** `SupplierDirectory::contacts()` (contact person, e-mail, phone, address, active, archived), `UserDirectory::active()`.
- **Admin** (`src/features/procurement`): Purchasing tabs *Requisitions* (status tabs; editor with product picker and catalog cost prefill, needed-by, notes; detail with timeline, approval level badge and who may approve, submit / approve / reject / cancel / convert — per line purchase order with supplier, RFQ or not now), *Approvals* (inbox, approve / reject inline), *RFQs* (list; editor; invite suppliers with an e-mail badge; send — who was e-mailed, PDF per supplier; record-quote dialog; comparison matrix with lowest / fastest highlighted, totals and coverage; award defaulting to the lowest price, *update catalog*; links to the created POs), *Settings* (`/purchasing/settings`, *Approval limits* card, `purchases.settings`); a *Requisitions* sidebar entry for requesters and approvers without `purchases.view`; PO detail with *Approve* / *Reject* (reason), pending-approval, level and *Pre-approved* badges, links to the requisition / RFQ, rejection note and history; Reorder page *Raise requisition* for users with `purchases.request` but without `purchases.manage`. Every transition sends an `Idempotency-Key`; every list has *Export*.
- **Demo data** (`DemoProcurementSeeder`, runs after `DemoSupplyChainSeeder`, through the real actions; earlier documents, numbers and stock unchanged): approval settings saved with the defaults; `PR-000001` raised and submitted by the cashier (480 mango juice from Pran + 100 kg rice without a suggested supplier, estimate 16 036.00, manager level — in the owner's inbox); `PR-000002` (250 kg rice, 15 250.00) approved by the owner and converted into the draft, pre-approved `PO-000002` (Local Mills Wholesale); `RFQ-000001` (cotton polo shirts, 2 sizes × 30) sent to Pran and Local Mills (no e-mail addresses → send manually) with Pran's quote (295.00 / 305.00, 25 offered on the second line, 10 days, valid 30 days).
- Tests: backend `Purchasing/Tests/Unit/ApprovalPolicyTest` (10 cases), `QuoteComparisonTest` (2), `RequisitionWorkflowTest` (7), `PurchaseOrderApprovalTest` (4), `RfqWorkflowTest` (5), `ExportableListsTest` (+3 lists); frontend 51 Vitest tests in `features/procurement`; mocked Playwright `procurement-admin.spec.ts` (4 × desktop/mobile); full-stack `a manager approves a branch requisition from the inbox and converts it into pre-approved purchase orders`.

#### Changed
- PO editor: **"Save & place order" is now "Save & submit"** (`POST /purchasing/orders/{id}/submit`): placed at once within the auto-approve limit or a pre-approval, otherwise sent for approval.
- `POST /purchasing/orders/{id}/place` ("mark ordered") still works where no approval is needed and otherwise refuses with **422 `APPROVAL_REQUIRED`** `{approval_level, total}` (it does not move the order to `pending_approval`).
- **Role map:** Branch Manager's `purchases.*` is replaced by `purchases.view`, `.manage`, `.receive`, `.return`, `.pay`, `.request`, `.approve` (no `approve_high`, no `settings`); Inventory Manager's `purchases.*` by `purchases.view`, `.manage`, `.receive`, `.return`, `.pay`, `.request` (does not approve); Cashier gains `purchases.request`; Organization Admin keeps everything through `*` (the only built-in holder of `purchases.approve_high` and `purchases.settings`); Accountant unchanged. Run `php artisan pos:permissions:sync`.
- `purchases.manage` description: "Create, edit, place and cancel purchase orders; convert requisitions; run RFQs".
- Reorder suggestions count orders `pending_approval` as drafts (`draft_on_order`), not as on order.
- `purchase_orders.status` CHECK rebuilt with `pending_approval` (SQLite: the enum column is widened to a string).
- Purchasing tabs: *Purchase orders, Requisitions, Approvals, RFQs, Reorder, Receipts, Returns, Supplier payments, Settings*, each gated by its own permission(s); section tabs accept any-of permission lists; nav items support `unless`.

#### Fixed
- Cancelling a purchase order that came from a requisition (converted directly or awarded from a requisition RFQ) now gives its unreceived quantity back to the requisition lines (`RequisitionQuantities::releaseFromOrder`, inside the cancel transaction, requisitions then lines locked in id order); a `converted` requisition reopens as `approved` with a system history entry "Quantities released by PO-… (cancelled)." and can be converted again. New nullable `purchase_order_lines.requisition_line_id` (FK, index; migration `2026_11_07_100100`) links the lines; PO lines in the API carry it. Before, a partly converted requisition could be neither cancelled nor re-converted once its orders were cancelled. Known limit: editing the quantity of a converted draft does not adjust the requisition's `converted_quantity`, and a line deleted from such a draft loses its link.
- Convert dialog: the RFQ title input allowed 200 characters while the API accepts 150; now 150.
- Requisition convert dialog: after a full conversion the refreshed requisition could no longer be converted, so the dialog unmounted at once and the links to the created POs / RFQ were never shown. It is now rendered from the dialog state only (found by the full-stack test).

#### Notes
- **Single-step tiered approval** by design: the amount picks the permission, one approval completes the document. Multi-step approval chains are a later slice.
- **Quotes are entered by staff**; there is no supplier portal. Suppliers receive the PDF by e-mail (queued) or by hand.
- **Deviations from the SC2 brief:** (1) one quotes endpoint `POST /rfqs/{id}/quotes` (status `received|declined`), re-posting replaces the answer; (2) `place` refuses with `APPROVAL_REQUIRED` instead of moving the order to `pending_approval`; (3) closing an RFQ is terminal (no reopen); (4) converted PO lines take the chosen supplier's active catalog cost, else the requisition estimate; (5) comparison line totals use the requested quantity (not the offered one; `partial` flags less), excluding tax; (6) PO expected date = the requisition's / RFQ's needed-by date when not past, else today + the longest lead time; (7) no notification on automatic approval; (8) estimated costs are shown to requesters without `products.view_cost`; (9) additions: `rfq_suppliers.sent_at` / `email`, `rfq_awards`, `rfq_reminder_runs`, the estimates endpoint; history rows `{from_status, to_status, note, user, at}`; (10) approval limits are changed with the new `purchases.settings` (not an existing admin permission).
- Not wired in the admin yet (API exists): removing an invited supplier, inviting suppliers from the convert dialog (`rfq.supplier_ids`), optional cancel / close reasons. The convert dialog sends lines without a suggested supplier to an RFQ by default (the API would default them to the preferred catalog supplier).
- **Run `php artisan pos:permissions:sync`** after deploying, keep a **queue worker** running for RFQ e-mails and the **scheduler** for the reminders; PDF prerequisites are those of X1 (see [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)).
- Results: backend 658 tests (652 pass, 6 skipped — 5 PostgreSQL-only and the opt-in real PDF), Pint clean; frontend typecheck, lint, build and 768 Vitest tests (104 files; one storefront checkout test is load-flaky and passes alone); mocked Playwright 129 pass, 44 skipped (one supply-chain test was flaky once under full load; 18/18 on repeat); full-stack 21/21 on desktop on a fresh seed, including the new procurement test.
- Open issues: the **PostgreSQL run is still pending** — the new CHECKs and the append-only triggers have not run on PostgreSQL. Next: **SC3** landed cost and supplier performance.

### SC1 — Supplier catalog, reorder suggestions and replenishment (supply chain)

What each supplier sells at what terms, what each store should hold, and suggestions that turn into draft purchase orders or replenishment transfers. First slice of the supply chain track.

#### Added
- **Supplier catalog** (Purchasing, `supplier_products`): per supplier and variant the supplier SKU, unit cost (`NUMERIC(18,4)`, per base unit, tax-exclusive), pack size (≥ 1; purchase suggestions round up to whole packs), minimum order, lead time (0–365, default 7), preferred flag (at most one per variant — setting one unsets the previous, partial unique index on `(organization_id, variant_id) WHERE is_preferred`), active flag, and `last_purchase_cost` / `last_purchased_at` written by `PostGoodsReceipt` on the supplier's existing rows (never user input, never a new row). API `GET/POST /purchasing/supplier-products`, `PATCH/DELETE /purchasing/supplier-products/{id}` (`supplier_id` and `variant_id` fixed after creation; last-cost fields never accepted), `POST /purchasing/supplier-products/{id}/preferred` (422 `SUPPLIER_PRODUCT_INACTIVE`, `SUPPLIER_INACTIVE`), `GET /purchasing/supplier-products/lookup?supplier_id=&variant_ids[]=` (PO prefill); `purchases.view` / `purchases.manage`; audited.
- **Per-store reorder rules** (Inventory, `stock_reorder_rules`): `min_qty` (reorder point) and optional `max_qty` (order-up-to) per store and variant; without a rule the variant's `reorder_level` is the minimum. `GET /inventory/reorder-rules` (`inventory.view`, branch-scoped), `PUT /inventory/reorder-rules` (bulk upsert of up to 500 rules of one store), `DELETE /inventory/reorder-rules/{id}` (`inventory.manage`).
- **Replenishment settings** (Inventory, `replenishment_settings`, one row per organization; defaults until saved): source (central) store, coverage days (14, 1–180), velocity days (30, 7–180), safety days (3, 0–60). `GET` (`inventory.view`) / `PATCH /inventory/replenishment-settings` (`inventory.manage`).
- **Reorder suggestions** `GET /purchasing/reorder-suggestions?store_id=` (`purchases.view`; `supplier_id`, `search`, `only=purchase|transfer`; `meta.store`, `source_store`, `settings`): pure `Purchasing\Domain\Reorder\ReorderCalculator` over on hand, open purchase orders (`ordered` / `partially_received`), transfers in transit and net units sold over `velocity_days` (sales and web orders minus cancellations and returns, from the stock ledger); reorder point = max(min, ⌈sold × (lead + safety) / velocity⌉), target = max ?? reorder point + ⌈sold × coverage / velocity⌉; reorder when available ≤ reorder point; transfer from the source store's surplus first, the rest bought from the preferred supplier raised to the minimum order and rounded up to whole packs; `reason` `below_min|velocity`, `days_of_cover`, `draft_on_order`. Formula and row: [API_DOCUMENTATION.md § Supply chain](docs/API_DOCUMENTATION.md#supply-chain--supplier-catalog-reorder-suggestions-and-replenishment-sc1).
- **From suggestions to documents** (both `Idempotency-Key`, one transaction): `POST /purchasing/reorder-suggestions/purchase-orders` (`purchases.manage`) → one **draft** PO per supplier through `SavePurchaseOrder` (order date today in the organization's timezone, expected date + the longest catalog lead time, 7 without a row) → `{purchase_orders: [{id, number, status, supplier, line_count, total, expected_date}]}`; `POST /purchasing/reorder-suggestions/transfers` (`inventory.transfer`) → one transfer from the source store, **dispatched** at once → `{transfers: [{id, number, status, from_store, to_store, lines_count}]}`; errors `NO_SOURCE_STORE`, `SOURCE_IS_DESTINATION`, `SOURCE_STORE_INACTIVE`, `SOURCE_STORE_NOT_ACCESSIBLE`, `INSUFFICIENT_STOCK`.
- **Daily reorder alert:** `php artisan purchasing:reorder-notifications [--any-hour]`, scheduled hourly (`withoutOverlapping`); from 07:00 in each organization's timezone, one in-app notification per store and local day ("N items need reordering at {store}", type `purchasing.reorder_needed`, link `/purchasing/reorder?store_id=…`) to the holders of `purchases.manage` in the store's branch; claimed in `reorder_notification_runs` (unique store + day), so repeated runs never notify twice.
- **Permission** `inventory.manage` ("Manage per-store reorder rules and replenishment settings").
- **Exports (X1)** of the supplier catalog (`supplier-catalog`) and reorder suggestions (`reorder-suggestions`).
- **Contracts:** `BranchDirectory::activeStores()`, `OrganizationDirectory::activeIds()`, Inventory `ReplenishmentData` (settings; per store on hand, in transit, net sold, effective rule); `Shared\Domain\ValueObjects\Decimal::ceil()`, `floor()`, `min()`, `max()`.
- **Admin** (`src/features/supply-chain`): *Purchasing → Reorder* (`/purchasing/reorder`, `purchases.view`) — store (default: the active branch's store), supplier and search filters, *Purchase / Transfer / All* tabs, on hand / on order / in transit / avg. per day / days of cover / reason, a warning for quantities already on draft orders, editable quantity with pack-size round-up hint, supplier switch to another catalog supplier, selection across pages, *Create purchase orders* (grouped preview per supplier; lines without a supplier are skipped) and *Create transfers*, links to the created documents, *Export*; supplier page `/suppliers/:supplierId` (supplier names in the list link to it) with a *Catalog* tab (needs `purchases.view`: add / edit dialog with product picker, preferred toggle, last purchase cost read-only, *Export*); product editor *Suppliers* (catalog rows, set preferred) and *Reorder rules* per store (min / max); *Inventory → Settings* (`/inventory/settings`, `inventory.manage`) with the *Replenishment* card; purchase order editor prefills the catalog cost (only into empty or auto-filled costs) and shows pack / minimum hints.
- **Demo data** (`DemoSupplyChainSeeder`, runs last, through the real actions; no document, number or stock changed): Pran → mango juice (preferred, 18.00, carton of 24, 3 days), Local Mills → Miniket rice (preferred, 61.00, sack of 25, minimum 50, 2 days, last cost 61.00 from the demo receipt), Pran → rice (alternative, 63.50, 50, 7 days); main-store rules juice 160 / 288, rice 400 / 600, Cotton Polo Shirt M 15 / 30. No source store (single-store demo). A fresh seed suggests juice 144 from Pran, rice 300 from Local Mills and polo M 18 without a supplier.
- Tests: backend `Purchasing/Tests/Unit/ReorderCalculatorTest` (19), `SupplierCatalogTest` (7), `Inventory/.../ReplenishmentConfigurationTest` (5), `ReorderSuggestionsTest` (6), `ReorderActionsTest` (4), `ReorderNotificationTest` (3), `DecimalTest` (+1), `ExportableListsTest` (+2 lists); frontend 21 Vitest tests in `features/supply-chain` (quantities, reorder page, supplier page, inventory settings, product page section, PO hints) plus the reorder page in `exportable-lists.test.tsx`; mocked Playwright `supply-chain-admin.spec.ts` (3 × desktop/mobile); full-stack `reorder suggestions turn into a draft purchase order from the preferred supplier`.

#### Changed
- `TransferStock::dispatch()` takes `allocateBatches` (default `false`): lines without a batch of batch-tracked products are allocated first-expiry-first-out by the ledger and stored as one transfer line per batch. Used by replenishment transfers only; the transfer screen is unchanged.
- `PostGoodsReceipt` updates the receipt supplier's catalog rows (last purchase cost and date) inside the receipt transaction.
- Purchasing tabs gain *Reorder*; inventory tabs gain *Settings* (only with `inventory.manage`).

#### Notes
- **Slice plan** (owner request of 2026-11-06: auto reorder, requisitions and approvals, supplier quotes and catalog, landed cost and supplier tracking): **SC1** (this) supplier catalog, reorder suggestions → draft POs and replenishment transfers; **SC2** purchase requisitions with approvals and RFQ / supplier quote comparison; **SC3** landed cost and supplier performance.
- **Deviations from the SC1 brief:** (1) transfers have no draft state, so replenishment transfers are **dispatched immediately** (status `in_transit`, stock leaves the source at once; the store receives as usual), with FEFO batch allocation; (2) draft purchase orders are **not** counted as on order — they are reported separately as `draft_on_order` and flagged on the Reorder page; (3) replenishment settings live in their own table (`replenishment_settings`), not in organization settings; (4) the transfers answer uses `lines_count` (purchase orders: `line_count`) and a list `transfers` with one entry; (5) the daily alert is scheduled hourly and fires from 07:00 organization-local time rather than at a fixed UTC time; (6) suggestion rows carry extra fields `pack_size`, `min_order_qty`, `min_qty`, `max_qty`, `has_rule`, `draft_on_order`, and `variant.allow_decimal`; (7) catalog and reorder-rule lists join `product_variants` / `products` read-only to sort and search (the documented read-model exception); the rule fallback reads `product_variants.reorder_level` read-only.
- **Run `php artisan pos:permissions:sync`** after deploying: `inventory.manage` reaches Organization Admin, Branch Manager and Inventory Manager only after the sync. The scheduler must run for the daily alert (see [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)).
- Purchase quantities sent to `POST …/purchase-orders` are taken as sent; pack sizes and minimums are applied in suggestions and as client hints, not enforced on the order.
- Known: development-mode React warning "uncontrolled → controlled" from the shared `StoreSelect` on the Reorder page (no functional effect).
- Results: backend 627 tests (621 pass, 6 skipped — 5 PostgreSQL-only and the opt-in real PDF), Pint clean; frontend typecheck, lint, build and 714 Vitest tests (97 files); mocked Playwright 121 pass, 42 skipped (one mobile web-orders test was flaky once under full load; 36/36 on `--repeat-each=3`); full-stack 20/20 on desktop on a fresh seed, including the new reorder test.
- Open issues: the **PostgreSQL run is still pending** — the new CHECKs and the partial unique index have not run on PostgreSQL.

### X1 — PDF and Excel export on admin lists

Every admin list exports what it currently shows — same filters, search and sort, every matching row, not just the visible page — as an Excel workbook or a PDF.

#### Added
- **Export on list endpoints:** `?export=xlsx|pdf` on 31 admin list endpoints (32 exports — `/expenses` gives `expenses` or `income` by `type`) with their normal filters, permission and tenant/branch scoping. Answer: the file with `Content-Disposition: attachment; filename="<stem>-<org-slug>-<YYYYMMDD-HHmm>.<ext>"` (organization's timezone), `Cache-Control: no-store, private`, `X-Export-Rows`. Limits (`config/exports.php`): xlsx 50 000 rows, pdf 2 000 rows → 422 `EXPORT_TOO_LARGE` (`details.limit`, `rows`, `format`), counted before any row is read. PDF renderer missing or failing → 503 `PDF_UNAVAILABLE` (never a 500). Unknown `export` value → 422 `VALIDATION_FAILED`. 10 exports per minute per user (`EXPORT_RATE_LIMIT`; 429 `TOO_MANY_REQUESTS` with `Retry-After`; the JSON list is not counted). Every export is audited as `export.created` (`list`, `format`, `filters` — the query without `export`/`page`/`per_page` — and `rows`). Endpoint, filename stem and column table: [API_DOCUMENTATION.md § Exports](docs/API_DOCUMENTATION.md#exports-x1).
- **Cost columns** follow `products.view_cost`: *Cost* (products), *Value* (stock on hand) and *Unit cost* (stock movements) appear only with it; `/inventory/valuation` needs it as before.
- **Shared export pipeline** (`Shared\Application\Export`, `Shared\Infrastructure\Export`, `Shared\Infrastructure\Http\Exports`): `ListQuery::apply()` (search + sort without paging, shared by the list and its export); `RowSource::fromQuery()` (count first, then 500-row chunks — `EXPORT_CHUNK_SIZE` — of the list's own query with a primary-key tie-breaker, each chunk through the list's JSON presenter) and `RowSource::fromRows()` (statements, valuation, promotion report); `ListExport` definitions per module (`<Module>\Presentation\Http\Exports\*`: stem, title, columns, `FilterSummary` — "Status: Completed · Branch: Dhaka Main · Date: 01 Nov–05 Nov 2026", ids shown by name); `ListExporter` (validation, throttle, limit, letterhead, writer, audit, headers); `ExportColumn` types `text|number|money|quantity|date|datetime|status`.
- **Excel writer** (`XlsxExportWriter`, OpenSpout): bold, frozen header row; money as numeric cells `#,##0.00`, numbers and quantities numeric; dates and date-times as date cells in the organization's timezone; column widths; sheet name ≤ 31 characters; text always written as text (a value starting with `=` never becomes a formula). Streams to a temporary file under `storage/app/private/exports`, deleted after sending.
- **PDF writer** (`PdfExportWriter` → `PdfRenderer` contract → `BrowsershotPdfRenderer`): Blade view `exports.list` — letterhead (name, legal name, address, phone, e-mail, tax number, storefront theme logo), title, filter summary, generated-at (organization's timezone) and user, table header repeated on every page, right-aligned numbers, every value escaped; A4, landscape above six columns, footer "Page X of Y". JavaScript disabled; fonts and logo inlined as data URIs.
- **Letterhead contract** `Shared\Application\Contracts\DocumentLetterhead`, implemented by Organizations (`OrganizationLetterhead`) and decorated by Storefront (`ThemeLogoLetterhead`, logo via the new `MediaLibrary::dataUri()` — a rendition ≥ 240 px, ≤ 512 KB).
- **Fonts:** `backend/resources/fonts` — Poppins and Hind Siliguri (400/600, Latin, Latin-ext and Bengali woff2 subsets from Fontsource 5.3.0) with their OFL license files; Bangla text shapes correctly in PDFs.
- **PDF renderer package** `backend/pdf-renderer` (`package.json` + lockfile, `puppeteer-core` 25.16.0, Node ≥ 22.12; `browser.cjs` hands puppeteer-core to Browsershot's script). Installed with `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` — Chrome is never downloaded. `config/pdf.php`: `chrome_path` (empty = newest Playwright Chromium under `%LOCALAPPDATA%\ms-playwright`, then `/usr/bin/chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `/snap/bin/chromium`), `node_binary`, `npm_binary`, `node_modules_path`, `renderer_script`, `timeout` 60 s, `no_sandbox`.
- **Admin:** *Export* button (`components/common/export-menu.tsx`: *Excel (.xlsx)* / *PDF*; "Exporting…" with `aria-busy`; disabled while the list loads or is empty) in the header of 30 list screens — sales, sales returns, web orders, web returns, COD remittances, promotions, promotion report (promotion page → *Report*), reviews, register sessions, payments, customer payments, expenses and income, products, stock, batches, stock movements, adjustments, transfers, purchase orders, goods receipts, purchase returns, supplier payments, supplier statement, customers, customer statement, suppliers, contact messages, newsletter subscribers, users, audit log. It sends the list's current query without `page`/`per_page`. `lib/api/download.ts` downloads with the API client's base URL, cookies, `X-XSRF-TOKEN` and `X-Branch-Id` (blob → object URL → `<a download>`, filename from `Content-Disposition`); `features/exports/lists.ts` (`EXPORTABLE_LISTS`), `errors.ts` (toasts for `EXPORT_TOO_LARGE` with the limit, `PDF_UNAVAILABLE`, 401, 403, 429, network).
- Tests: backend `Shared/Tests/Feature/ListExportTest` (13: xlsx read back with OpenSpout, formulas, PDF HTML through `FakePdfRenderer`, portrait/landscape, limits, validation, permission, isolation, audit, throttle, missing Chrome, Chrome locator, opt-in real PDF with `PDF_E2E=1`), `ExportableListsTest` (33: every exportable list answers xlsx and pdf with its first header and stem — 32 cases — plus a route-reflection guard that every route taking `ListExporter` is covered), `Unit/ExportValuesTest` (4); frontend `download.test.ts` (8), `export-menu.test.tsx` (10), `exportable-lists.test.tsx` (29, plus a source scan), `wired-pages.test.tsx` (5); mocked Playwright `exports-admin.spec.ts` (3 × desktop/mobile); full-stack `an admin list exports to Excel and PDF with the current filters` (Products → Excel and PDF downloads, filename `products-<org>-YYYYMMDD-HHmm`).

#### Changed
- `backend/composer.json`: `php` `^8.3` → **`^8.4`** (OpenSpout 5 requires PHP 8.4). New dependencies `openspout/openspout` 5.12.2 and `spatie/browsershot` 5.4.1 (with `spatie/temporary-directory` 2.4.0), pinned.
- The 30 list controllers that export return `Symfony\Component\HttpFoundation\Response` (the JSON page through `ApiResponse` or a file); their Scramble response schemas may differ from before.
- Frontend list query builders extracted and shared by list and export (sales, returns, products, customers, customer payments, suppliers, expenses).
- `GET /cms/newsletter-subscribers/export` (CSV of confirmed subscribers) is kept unchanged next to the new xlsx/pdf export of the list.

#### Fixed
- **Business dates follow the organization's timezone** (pre-existing since Phase 4). The application clock is UTC (`config/app.php`), so between 00:00 and 06:00 Asia/Dhaka "today" on the server was still yesterday and a GRN dated today by the browser failed `before_or_equal:today`. New `Organizations\Application\Support\OrganizationDate` (`timezone()`, `today()` of the tenant's organization, falling back to `app.timezone`) is used for GRN `invoice_date` and `lines.*.manufactured_on`, supplier payment `paid_on` and expense/income `occurred_on` (COD remittance `received_at` already did this). Test `PurchasingWorkflowTest::test_business_dates_follow_the_organization_timezone_not_the_utc_clock` (20:30 UTC = 02:30 next day in Dhaka). The full-stack POS/back-office specs now pass between 00:00 and 06:00 Dhaka (run at about 00:45). Stored timestamps stay UTC.

#### Notes
- **Licenses:** OpenSpout MIT, Browsershot MIT, spatie/temporary-directory MIT, puppeteer-core Apache-2.0, Poppins and Hind Siliguri SIL OFL 1.1. mPDF was rejected (GPL); Dompdf was rejected (no Bangla shaping).
- **PDF needs Node.js ≥ 22.12 and a Chrome/Chromium on the server** (see [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)); without them PDF answers 503 `PDF_UNAVAILABLE` and Excel keeps working. Verified with a real render (`PDF_E2E=1`): 3 pages, Poppins and Hind Siliguri embedded, Bangla shaped (গ্রাহক … রহিম), letterhead, generated-at in Asia/Dhaka, right-aligned money, "Page 1 of 3".
- PDF rows are held in memory while the HTML is built (bounded by the 2 000-row limit); Excel streams.
- Not exported: inventory valuation is export-capable in the API but has no admin screen; loyalty accounts and online customer accounts have no list screen; catalog taxonomies, branches, roles, registers, blog, pages, FAQ, media, shipping, payment methods, web categories/brands and platform organizations are not covered.
- Results: backend 580 tests (574 pass, 6 skipped — 5 PostgreSQL-only and the opt-in real PDF), Pint clean; frontend typecheck, lint, build and 692 Vitest tests (91 files); mocked Playwright 116 pass, 40 skipped; full-stack 19/19 on desktop (the 18 earlier tests on a fresh seed at 00:45 Asia/Dhaka plus the export test).
- Open issues: the **PostgreSQL run is still pending**.

### E-commerce E12b — Bangla storefront and content translations (online store track)

The storefront in English and Bangla (ADR-011): a typed UI dictionary, per-record content translations with per-field fallback to English, language resolution, hreflang, and store language settings.

#### Added
- **Store languages** (`storefront_settings`, Storefront migration `2026_11_05_100200`; audited): `bangla_enabled` (default true), `default_locale` `en|bn` (default `en`; `bn` while Bangla is off → 422 on `default_locale`, PostgreSQL CHECK), `bangla_digits` (default false). `GET|PATCH /storefront/settings`. Admin: *Online store → Settings → Languages* ("Offer the store in Bangla", *Default language*, "Bengali digits in Bangla"; saved per change).
- **Language resolution** (Shared `Application\Localization\LocaleContext`, request-scoped; staff, console and queued work read English): public `/api/v1/store/*` reads `?lang=` only (`en|bn`; missing, unknown or disabled → the store default, `en` while Bangla is off) and answers with `Content-Language`; the HTML shell and sitemaps read `?lang=` > `lang` cookie > default. The `lang` cookie is excluded from cookie encryption (written by the SPA).
- **Bootstrap:** `store.locales` (`["en"]` or `["en","bn"]`), `store.default_locale` (`en` while Bangla is off), `store.bangla_digits` (false while Bangla is off) and the resolved `locale`.
- **Content translations:** nullable `translations` jsonb `{"bn": {field: value}}` (PostgreSQL CHECK: an object) on `product_listings`, `category_listings`, `brand_listings` (OnlineCatalog `…100000`), `cms_pages`, `faq_items`, `blog_categories`, `blog_posts` (Cms `…100100`), `menu_items`, `banners`, `homepage_sections` (Storefront `…100200`), `shipping_methods` (Shipping `…100300`), `payment_gateways` (OnlinePayments `…100400`), `promotions` (Promotions `…100500`); the announcement's translations live in the theme document (`announcement.translations`). Field list and limits per entity: `docs/API_DOCUMENTATION.md` (E12b).
- Shared helpers: `Domain\Translations` (`pick`, `pickMany`, `value`, `of`, `decode`, `compact` — the one fallback rule: a non-blank translation, else the base value, per field), `Application\Support\TranslationInput` (validation rules with the base field's limits, partial merge, trimming, blank → removed, HTML sanitizing, `only`, `present`), `Application\Localization\FixedText` (the few server-written words — Home, Blog, Shop, Search, Cart, Wishlist, Checkout, My account, Your order — in Bangla), `Infrastructure\Persistence\TranslationsColumn` (migration add/drop with the CHECK).
- **Staff APIs** return `translations` (always `{"bn": {…}}`) and accept partial `translations` on product / category / brand listings, pages, FAQ (`question`, `answer_html`), blog posts and categories, menu items, banners, homepage sections (title, subtitle; `rich_text` `body_html`; newsletter `text`, `button_label`), the theme announcement, shipping methods, payment methods (`display_name`, `instructions`) and promotions. Errors `translations.bn.<field>` (limit, type), `translations.bn` (unknown field), `translations` (unknown locale) — 422 `VALIDATION_FAILED`.
- **Public localized reads:** catalog cards, product page (incl. breadcrumbs and SEO texts), categories and tree, brands, facets, search suggestions, related products, homepage sections and banners, bootstrap menus / announcement / popup, pages, FAQ, blog list / categories / posts, checkout delivery and payment methods, preview and cart names, the order page's payment label and instructions, review product names. Search (`q`, suggestions) matches base **and** Bangla names of products, brands and categories in either language. Geography: `GET /store/geo/divisions|districts?lang=bn` → `name` is the Bangla name, sorted by it.
- `orders.locale` (`en|bn`, default `en`, PostgreSQL CHECK; Orders `…100600`) from the checkout request's `lang`, returned on the shopper's order; `customer_accounts.preferred_locale` (`en|bn`, nullable, CHECK; CustomerAccounts `…100700`) set on sign-up / sign-in, returned in the account profile (`GET /store/account/me`, register, login). Both for the e-mails of E13.
- **Shell and SEO:** `<html lang>`, localized title / description / Open Graph, `og:locale` `bn_BD` / `en_US` + `og:locale:alternate`, `<link rel="alternate" hreflang="en|bn|x-default">` on indexable pages while Bangla is on (the non-default language adds `?lang=`; x-default = the default language's URL), canonical in the page's language (`lang` kept only when not the default), JSON-LD `inLanguage` on `WebSite`, `CollectionPage`, `BlogPosting`. Sitemaps list `xhtml:link rel="alternate" hreflang` (en, bn, x-default) per `<url>` while Bangla is on.
- **Storefront UI** (`src/storefront/i18n/**`): English and Bangla dictionaries per namespace (`en/*.ts`, `bn/*.ts`; Bangla typed against English — a missing key is a type error), 883 keys in 12 namespaces; `t(key, vars)` with `{name}` placeholders, plurals by `count` and localized numbers (`translate.ts`), `rich.ts`, `format.ts` (`Intl` `en-BD` / `bn-BD`, Latin digits unless `bangla_digits`, `৳` first, lakh grouping in Bangla), `runtime.ts` (`lang` cookie, locale for the HTTP client and price helpers), `useLocale()` (`locale.ts`), `use-locale-controller.ts` (`?lang=` > cookie > default within `store.locales`), `dictionaries.ts` (Bangla as a lazy chunk). Every storefront string goes through `t()`.
- **Language switcher** (`components/language-switcher.tsx`, "English / বাংলা") in the header (md+) and the mobile drawer when the store offers both: writes the `lang` cookie (1 year, `path=/`, `SameSite=Lax`), replaces `?lang=` in the URL (dropped for the default; path kept), sets `<html lang>` and refetches. `http.ts` adds `lang` to every `/store/*` request (also POSTs); every storefront query key ends with the locale (`localized()` in `store-keys.ts`; `setLocalizedData` drops other-language copies after a write).
- Head manager (`useDocumentMeta`): translated titles, canonical per language, client-side hreflang and `og:locale`.
- **Fonts** (new dependencies, ADR-011): `@fontsource/hind-siliguri` 5.3.0 (Bengali subset, 400–700; body) and `@fontsource-variable/baloo-da-2` 5.3.0 (headings), applied under `:lang(bn)` in `storefront.css`; English unchanged.
- **Admin:** reusable `features/translations/components/bangla-translations.tsx` — a collapsible "বাংলা (Bangla)" section with "N of M translated", inputs labelled "{Field} in Bangla" (`lang="bn"`), the English text as placeholder / hint, the base field's limits and counters, TipTap for rich text, opens on a server error; wired into product, category and brand listings, pages, FAQ, blog posts and categories, menu items (`BanglaInput`), banners (secondary label on hero slides only), homepage sections, announcement bar, shipping methods, payment methods and promotions. The admin UI itself stays English.
- **Demo data** (`DemoTranslationsSeeder`, runs last): Bangla on, English default, Latin digits; Bangla for 4 categories, 2 brands, 5 products (name, short description), 15 menu labels, 6 banners, 9 homepage sections, the About us / FAQ / Contact titles and 4 FAQ entries, 2 blog categories and 2 posts (title, excerpt), 2 shipping methods and cash on delivery. No record, number or stock level changed.
- Tests: 529 backend tests (524 pass, 5 PostgreSQL-only skipped on SQLite) — new `TranslationsTest` (3), `CatalogTranslationsTest` (6), `StorefrontLanguagesTest` (6), `ContentTranslationsTest` (2), `CheckoutLanguagesTest` (3); 640 Vitest tests in 87 files (new `storefront/i18n/i18n.test.ts`, `storefront-i18n.test.tsx`, `storefront-i18n-{content,catalog,checkout,account}.test.tsx`, `features/translations/bangla-translations.test.tsx`, `translations-wiring.test.tsx`); Playwright: new mocked `storefront-bangla.spec.ts` and `translations-admin.spec.ts` (mocked suite: 110 pass, 38 skipped); new full-stack test `a shopper switches the store to Bangla: …` (full-stack 18/18 on desktop).

#### Changed
- Server cache keys are `storefront:{org}:v{version}:{locale}:{key}`; the weak ETag hashes the locale with the body, so an English and a Bangla answer never share an entry or an ETag.
- The shell answers with `Vary: Cookie` (its language can come from the `lang` cookie).
- Order placement runs in the base language (`LocaleContext::runAs('en')`): product, delivery method, promotion and place snapshots stay English whatever the shopper's language.
- Storefront: bootstrap, homepage, pages, catalog and blog reads go through `storeApi` / `storeRequest`; small English text fixes ("1 suggestion available", "1 product", grouped counts).
- `WebOrderWorkflowTest` shape assertions include `locale`.

#### Fixed
- Lead fix: order and return status badges, the order timeline and return reasons used the server's English labels, so they stayed English in Bangla. New dictionary keys `orders.status.*` (7) and `orders.returnStatus.*` (6) and helpers `orderStatusLabel`, `returnStatusLabel`, `returnReasonLabel` (`orders/returns-api.ts`: code → dictionary, server label for unknown codes), used by the account order page, order page, order row, returns view and order timeline.
- Full-stack locators: substring label matches collided with the new "… in Bangla" inputs (Headline, Section text, Post text, Name) — now `exact: true`.

#### Notes
- **Not translated in E12b:** product attribute names and values, variant option names, product page tab labels, features-strip and testimonials item texts, FAQ group names, the store name and meta description, product names in placed orders (English snapshots), address-book district names, e-mails (E13), the admin UI. Promotion `description` is translatable but not shown to shoppers. FAQ translates `answer_html` (the base field's name), not `answer`.
- Menu items and the announcement are saved as whole documents (`PUT /storefront/menus/{id}/items`, `PUT /storefront/theme`), so their translations are replaced with what is sent, not merged.
- Known: on the first switch the interface is English for a moment while the Bangla chunk loads; Baloo Da 2 also renders Latin text inside Bangla headings.
- Bundle: storefront initial JS +63 KB raw / +15.4 KB gzip (804 → 868 KB, 235 → 250 KB gzip; mostly the English dictionary and i18n code); CSS +2.9 KB; Bangla dictionary chunk 84 KB (14.3 KB gzip, lazy); 8 woff2 font files (453 KB on disk: Hind Siliguri's Bengali subset in 4 weights, Baloo Da 2 variable in 4 subsets), fetched only on Bangla pages per `unicode-range`.
- Full-stack: the first run hit stray listeners on `:8040` and was invalid; rerun on `:8041`.
- Open issues: the **PostgreSQL run is still pending** — the jsonb search SQL (`lower(translations->'bn'->>'name') like …`) and the new CHECKs have never run; the pre-existing **timezone mismatch** (`config/app.php` `timezone` = `UTC`) is still open; Bangla e-mails → E13 (`orders.locale` / `preferred_locale` are stored for them).
- Next: E13 (AI features per the plan, plus Bangla e-mails).

### E-commerce E12a — SEO and performance (online store track)

Structured data, crawler rules, sitemaps, HTTP and server caching of public storefront reads, storefront indexes, and client-side head tags, image priorities and code splitting. Bangla UI and content translations follow in E12b.

#### Added
- **JSON-LD in the shell** (`StorefrontShellController` + `Storefront\Presentation\Http\Support\StructuredData`): one `<script type="application/ld+json">` per document, encoded with `JSON_HEX_TAG|JSON_HEX_AMP|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE` (a `</script>` in store data cannot end the element). `Organization` (name, home URL, logo, `contactPoint` with the footer phone / e-mail when set) on every page; `WebSite` with a `SearchAction` (`/search?q={search_term_string}`) on the homepage; `Product` (plain-text description ≤ 5000, SKU, absolute image URLs, `Brand`, one `Offer` for a single variant or an `AggregateOffer` with `lowPrice`/`highPrice`/`offerCount` and an `Offer` per variant — price as a string, the automatic-promotion price with `priceValidUntil` = the promotion's end date, availability `InStock` / `LimitedAvailability` (low stock, ≤ 5) / `OutOfStock`; `aggregateRating` only with ≥ 1 approved review) + `BreadcrumbList` (Home → category path → product); `CollectionPage` + `BreadcrumbList` on category and brand pages; `BlogPosting` (headline ≤ 110, description, image, `datePublished`, `dateModified`, author `Person`, publisher `Organization`, `mainEntityOfPage`) + `BreadcrumbList` on posts; `BreadcrumbList` on content pages and blog categories. Pages that are noindex carry `Organization` only.
- **`GET /robots.txt`** (every host, no session, `text/plain`, `Cache-Control: public, max-age=3600`): the open store on its primary domain with indexing allowed gets `User-agent: *`, `Disallow:` `/cart`, `/checkout`, `/account`, `/order/`, `/search`, `/admin`, `/api/` and `Sitemap: {scheme}://{primary}/sitemap.xml`; a closed store, a store with indexing off, a secondary domain or an unknown host gets `Disallow: /`.
- **Sitemaps:** `GET /sitemap.xml` (index) and `GET /sitemaps/{pages|categories|brands|blog|products-N}.xml` — only live / visible / published records (blog categories: only those with a readable post), absolute URLs on the primary domain, `<lastmod>` (W3C, UTC) from `updated_at` (products: the later of listing and product), products with `image:image` (first image, image-sitemap namespace), at most 5000 product URLs per file (`config('storefront.sitemap_products_per_file')`). `application/xml; charset=UTF-8`, `Cache-Control: public, max-age=600`, `X-Robots-Tag: noindex`. 404 for a closed store (also in staff preview), indexing off, a secondary domain, an unknown or out-of-range file. No session or cookie.
- **Setting `allow_indexing`** (`storefront_settings`, bool, default true; audited): `GET|PATCH /storefront/settings` and the bootstrap `store.allow_indexing`. False → robots `Disallow: /`, sitemaps 404, every shell page `noindex` (for staging stores). Admin: *Online store → Settings → Search engines* switch "Allow search engines to index the store".
- **HTTP caching** (`StorefrontHttpCache`, alias `storefront.cache`, opt-in per route) on `GET /store/bootstrap`, `/store/homepage`, `/store/categories[/{slug}]`, `/store/brands[/{slug}]`, `/store/products[/{slug}]`, `/store/products/{slug}/related`, `/store/search/suggest`, `/store/products/{slug}/reviews`, `/store/pages/{slug}`, `/store/faq`, `/store/blog`, `/store/blog/categories`, `/store/blog/{slug}`: weak `ETag` (xxh128 of the body without `request_id`) and `304` on `If-None-Match`; `Cache-Control: public, max-age=60, stale-while-revalidate=300` for anonymous answers, `private, no-cache` when a session or cookie travels with the answer (the bootstrap, which starts the shopper session), `no-store, private` without an ETag for previews and answers a controller already marked `no-store`.
- **Server cache with a content version** (Shared `StorefrontContentVersion`, Storefront `CacheStorefrontContentVersion`): per organization counter `storefront:{org}:version`; cached entries `storefront:{org}:v{version}:{key}` for the bootstrap, the public homepage, the catalog candidate set (`catalog:products:{hash of category ids}`) and every sitemap file. Lifetime: until the next bump, 10 minutes, or the next scheduled change (`ContentSchedule`: banners, homepage sections, the announcement, listing windows, automatic promotions, blog posts and pages going live or ending), whichever comes first. Bumped after commit (never on rollback) by the `ChangesStorefrontContent` model trait (products, variants, images, categories, brands, attributes and values, listings, related products, promotions, targets, redemptions, reviews entering or leaving `approved`, banners, sections and items, menus and items, theme, settings, domains, pages, FAQ, blog categories and posts, media, organization), by stock movements at the fulfilment store, and explicitly after query-builder bulk writes (attribute values, related products, promotion targets, banner and section reordering, section items, menu items, the rating projection).
- **Indexes** (OnlineCatalog migration `2026_11_01_150100`): `product_listings_live_window_index` (organization_id, published_at, unpublished_at) `WHERE is_published`; `product_listings_unpublish_index` (organization_id, unpublished_at) `WHERE is_published AND unpublished_at IS NOT NULL`; `product_variants_live_product_index` (product_id, sort_order) `WHERE deleted_at IS NULL AND is_active` — partial on PostgreSQL, plain composite on SQLite.
- `Shared\Domain\PlainText` (`fromHtml`, `excerpt` at a word boundary) for meta descriptions (≤ 160) and structured data.
- **Storefront head manager** `useDocumentMeta({title, description, image, canonical, noindex, type})` (`src/storefront/use-document-meta.ts`, replaces `use-document-title.ts`): on in-app navigation writes `<title>` ("{title} | {store}"), `meta[name=description]`, `link[rel=canonical]` (absolute; `?page=N` kept past page 1, every other parameter dropped), `meta[name=robots]` `noindex, follow`, `og:type|title|description|url|image`; `null` while loading; store defaults back on unmount. Noindex everywhere in preview or with `store.allow_indexing` false; search, filtered / sorted listings and private pages (`privatePage()`: cart, wishlist, checkout, orders, account) noindex. Wired into home, product (`og:type product`), shop / category / brand / search listings, content pages, blog index / category / post (`article`), newsletter pages and 404.
- **Images:** `MediaImage` `priority` prop (`loading="eager"`, `fetchpriority="high"`); otherwise `loading="lazy"`, `decoding="async"`, `sizes` and intrinsic `width`/`height`. Priority on the first hero slide, the product main image, the blog post cover and the category banner.
- **Code splitting:** `lazyPage()` in `src/storefront/routes.tsx` (`React.lazy` + Suspense, loading view `role="status"` "Loading the page") for content pages, blog, newsletter, cart, wishlist, checkout, order pages and the account area; the product gallery's lightbox (`product-lightbox.tsx`) loads on first open. Storefront entry chunk 290.50 kB (gzip 73.46) → 160.64 kB (gzip 43.43); initial JS including modulepreload ≈ 912 kB (gzip ≈ 275) → ≈ 655 kB (gzip ≈ 209). No Vite config change.
- Tests: 509 backend tests (504 pass, 5 PostgreSQL-only skipped on SQLite) — new `StorefrontSeoTest` (12), `StorefrontIndexesTest` (1, PostgreSQL only), `PlainTextTest` (2); 583 Vitest tests in 79 files (new `storefront/storefront-seo.test.tsx` (9); `checkout-settings.test.tsx` +2); Playwright: `storefront-catalog.spec.ts` head-tag checks (mocked suite: 100 pass, 36 skipped); full-stack 17/17 on desktop.

#### Changed
- Shell meta: `meta[name=robots]` is now `noindex, follow` (the `X-Robots-Tag` header stays `noindex`); the canonical URL of listings (`/shop`, `/category/*`, `/brand/*`, `/blog`, `/blog/category/*`) drops the query string except `?page=N` (N > 1), and a listing with any other parameter (filters, sort; `utm_*`, `gclid`, `fbclid`, `msclkid`, `ref` ignored) is noindex; product, category and brand descriptions fall back to a plain-text excerpt (≤ 160) of the listing text; blog category title `"{name} | {store}"` (was `"{name} | Blog | {store}"`).
- Bootstrap and homepage controllers no longer compute their own ETags (the middleware does); the homepage answer is now `public` for anonymous visitors, the bootstrap `private, no-cache`.
- `backend/public/robots.txt` removed — robots.txt is served by Laravel.
- `StorefrontCatalog` gains `sitemapEntries()`, `nextScheduledChange()` and structured product data in `pageMeta()`; `PageDirectory` / `BlogDirectory` gain `sitemapEntries()` and `nextPublicationAt()`; `CatalogPromotions` gains `nextChangeAt()`.
- `StorefrontPublicTest` counts three `</script>` (Organization + WebSite JSON-LD and the payload); `BlogTest` the new blog category title; `PromotionCatalogTest` bumps the version after its raw query-builder write.

#### Fixed
- Lead fix: the catalog candidate cache stored `ProductListing` Eloquent objects; with `cache.serializable_classes` = false (Laravel 13 default here) a serializing store (file, database, Redis) returns incomplete objects → homepage and listings answered 500. Tests used the array store and missed it. The candidate set is now cached as raw attributes and rehydrated with `newFromBuilder()`; `test_cached_reads_survive_a_serializing_cache_store` (file store; bootstrap, homepage, products and sitemaps read twice) guards it.

#### Notes
- As built beyond or instead of the spec: the cache middleware lives in Storefront (not Shared); the bootstrap is `private, no-cache` (it starts the session) yet cached server-side; sitemaps are also 404 with indexing off and on secondary domains; the `X-Robots-Tag` header says `noindex` while the meta tag says `noindex, follow`; facets are not cached separately (computed from the cached candidate set); search, id and slug lookups are not cached (unbounded keys); the shell loads a product twice (meta and JSON-LD).
- Lighthouse was not measured: it needs a new dependency.
- PostgreSQL: `EXPLAIN` of the listing, facet, product, homepage, blog and sitemap queries and `StorefrontIndexesTest` are pending (no PostgreSQL access); the query review assumes a few thousand products per organization.
- Open issues: the **PostgreSQL run is still pending**; the pre-existing **timezone mismatch** (`config/app.php` `timezone` hard-coded to `UTC`) is still open. Full-stack: one earlier run hit the 30 s per-test timeout in a POS test (passed on rerun).
- Next: E12b — Bangla UI dictionary and content translations.

### E-commerce E11 — Blog, popup banner and refunds for paid cancellations (online store track)

CMS depth deferred from E5 (blog, homepage blog teaser, blog menu links, popup banner) and the cancellation of paid, undelivered orders that E10b left out.

#### Added
- **Cancel and refund a paid order:** `POST /web-orders/{id}/cancel {reason (≤ 200), refund?: {method: cash|bank_transfer|mobile_banking, reference? (≤ 80)}}` (idempotent) now also cancels a **paid** order (`paid`, `partially_refunded`) that is `confirmed` or `processing`, or `shipped` with its parcel returned to the sender. Everything paid and not yet refunded (`paid_total − refunded_total`) goes out through the payments ledger (`online_order_refund`, direction out; cash from the user's open register session in the order's branch → `CASH_SESSION_REQUIRED`, `INSUFFICIENT_CASH`, nothing changes on refusal), the stock goes back once to the exact `order_line_stock` allocations (`online_order_cancel`), the order becomes `cancelled` with payment status `refunded` and `refunded_total = paid_total`, one status-history row, audits `web_order.cancelled` (with the refund) and `web_order.refunded` — one transaction, order row locked. Paid without `refund.method` → `422 REFUND_REQUIRED` (`details.refund_amount`); paid without `web_orders.refund` → 403; delivered or already cancelled → `INVALID_STATUS_TRANSITION`. Unpaid orders keep the old rule (`web_orders.manage`; `refund` is ignored). After commit, event `OrderCancelledWithRefund` → queued e-mail `OrderCancelledWithRefundEmail` to the order's contact address (amount, method, reason; account order link for orders of a customer). The staff web order gains `cancel_refund_amount` (string | null) and lists `cancel` in `allowed_actions` for paid orders that can be cancelled when the user holds `web_orders.refund`; the refund appears in `payments` (direction `out`).
- **Blog** (Cms module): `blog_categories` (name ≤ 80, slug, description ≤ 300, sort order) and `blog_posts` (category — null when the category is deleted —, slug, title ≤ 160, excerpt ≤ 300, sanitized `body_html` (ADR-009), cover from the media library, author, `draft|published` with `published_at` — a future time schedules the post —, SEO title ≤ 70 and description ≤ 160, `reading_minutes` at 200 words a minute, at least 1); both soft-deleted; slugs unique per organization, case-insensitively, among rows not deleted.
- **Staff blog API** (`cms.manage`): `GET|POST /cms/blog-categories`, `PUT /cms/blog-categories/order {ids}` (`ORDER_MISMATCH`), `PATCH|DELETE /cms/blog-categories/{id}` (delete leaves its posts uncategorised; `IN_USE` while a menu or homepage section links to it; at most 100 categories, `LIMIT_REACHED`); `GET /cms/blog-posts?status=draft|scheduled|published&category_id=<uuid>|none&search=&sort=&page=` (`meta.status_counts`), `GET|POST|PATCH|DELETE /cms/blog-posts[/{id}]` (`CATEGORY_NOT_FOUND`, `MEDIA_NOT_FOUND`; delete → `IN_USE` while a menu links to it). Rows carry category, author name, `status`, derived `state`, `is_visible`, `published_at`, cover, `reading_minutes`, `preview_url`. A cover used by a post cannot be deleted from the media library (`BlogMediaReferences` on the `MediaReferences` tag).
- **Public blog API:** `GET /store/blog?category=&page=` (readable posts, newest first, 9 per page; `meta.category`; unknown category → 404 `NOT_FOUND`), `GET /store/blog/categories` (only categories with readable posts, with `post_count`), `GET /store/blog/{slug}` (card plus `body_html`, SEO, `prev` (older) / `next` (newer), up to 3 `related` posts of the same category). Drafts, scheduled and deleted posts → 404, except `?preview=1` for signed-in staff of the store with `cms.manage` (`state`, `Cache-Control: no-store, private`).
- **Storefront shell:** `/blog`, `/blog/category/{slug}` and `/blog/{slug}` are known paths with server-written meta (post: `"{seo_title ?? title} | {store}"`, description, absolute `og:image` from the cover, `og:type` `article`; previews `noindex` and `no-store`); unknown slugs → 404.
- **Blog menu links:** menu item types `blog` (the blog index, no target), `blog_category` and `blog_post` (target required; `BLOG_CATEGORY_NOT_FOUND` / `BLOG_POST_NOT_FOUND`). `GET /storefront/link-targets` gains `blog_categories` and `blog_posts` (drafts and scheduled posts flagged by `state` and `is_visible`). The bootstrap resolves them to `/blog`, `/blog/category/{slug}` and `/blog/{slug}` and drops deleted targets and posts that are not readable yet.
- **Homepage `blog_posts` section:** config `{category_id: uuid | null, limit 3–12 (default 3), view_all_url (SafeLink, default /blog; explicit null = no link)}`; payload `{posts: [public cards]}`; hidden while empty. Unknown category → `BLOG_CATEGORY_NOT_FOUND`.
- **Popup banner:** banner placement `popup` with `popup_delay_seconds` (0–60, default 5) and `popup_frequency` (`once_per_session|once_per_day|once_per_week`, default `once_per_day`) — null for other placements. The bootstrap gains `popup`: the first live popup by sort order `{id, title, subtitle, image, mobile_image, link_url, button_label, delay_seconds, frequency, updated_at}`, or null (also when its desktop image is missing).
- **Storefront:** `/blog` and `/blog/category/:slug` (card grid with cover, category chip, date and reading time; category chips; pagination), `/blog/:slug` (breadcrumbs, meta line, cover, body through `RichText`, *Filed under*, previous/next, related posts, 404), the homepage blog section (*View all posts*) and the popup (`storefront/popup/**`: Radix dialog, labelled, Esc and close button, focus returns, mobile image under 768 px, reduced motion respected; not shown on `/cart`, `/checkout`, `/account*`; frequency kept in `localStorage` / `sessionStorage` under `sf-popup:{id}:{updated_at}` with an in-memory fallback, every access in try/catch).
- **Admin:** *Content → Blog* tab (`/content/blog`, `/content/blog/new`, `/content/blog/:postId`; `cms.manage`): posts list (All / Published / Scheduled / Drafts with counts, category filter incl. uncategorised, search, pagination), post editor (title, slug from the title, category, excerpt, TipTap body, cover from the media picker, Draft / Publish now / Schedule in the organization's timezone, SEO counters 70 / 160, Preview and View in store, delete with the `IN_USE` message), categories dialog (add, edit, reorder, delete). Menus editor link types *Blog (all posts)*, *Blog category*, *Blog post*; homepage builder `blog_posts` editor; Banners page *Popup* card (delay, frequency, "Not shown (another popup comes first)"); web order cancel dialog on paid orders: refund amount, *Paid back by*, reference, *Cancel and refund* (`REFUND_REQUIRED`, `CASH_SESSION_REQUIRED`, `INSUFFICIENT_CASH` shown inline).
- Demo data (`DemoStorefrontSeeder`): categories *Recipes* and *Store news*; four published posts with generated cover artwork (`mango-lassi`, `same-day-delivery-now-in-mirpur`, `weeknight-khichuri`, `our-new-opening-hours` — 28, 21, 14 and 7 days before seeding) and `pitha-for-winter` scheduled 7 days ahead; *Blog* in the main menu after *Apparel*; homepage section *From our blog* before the newsletter; popup banner "Free delivery over ৳3000" (5 s, once per day), **inactive**. No seeded order, number or stock changed.
- Tests: 494 backend tests (490 pass, 4 PostgreSQL-only skipped on SQLite) — new `BlogTest` (5), `BlogLinksAndPopupTest` (3), `PaidOrderCancellationTest` (4; renders the e-mail); 572 Vitest tests in 78 files (new `storefront/storefront-blog.test.tsx`, `storefront/popup/frequency.test.ts`, `storefront/storefront-popup.test.tsx`, `features/content/pages/blog-pages.test.tsx`, `features/storefront/pages/cms-depth.test.tsx`, `features/web-orders/pages/cancel-refund.test.tsx`); Playwright: new mocked `blog-admin.spec.ts`, `storefront.spec.ts` +2 (mocked suite: 100 pass, 36 skipped) and two full-stack tests (18 in all).

#### Changed
- `CancelOrder`: `cancelLocked()` stays unpaid-only (`ORDER_PAID`); new `cancelWithRefund()` (paid, staff) and `cancellableWithRefund()`. The staff cancel route left the `can:web_orders.manage` group; the controller checks `web_orders.manage` (unpaid) or `web_orders.refund` (paid). Customer self-cancel (E9; paid → `ORDER_NOT_CANCELLABLE`) and the expiry job are unchanged; `cancelLocked()` still refuses paid orders (`ORDER_PAID`).
- New `Orders\Application\Services\RefundPayout` — the one refund path, now also used by `OrderReturnWorkflow::refund()` (E10b).
- Permission descriptions: `web_orders.refund` also covers cancelling paid orders with a refund; `cms.manage` covers the blog. No new permission.
- `MenuItemType` gains `TARGETED` / `hasTarget()`; `menu_items_target_check` rebuilt; `banners_placement_check` allows `popup`. Cms exposes the `BlogDirectory` contract (Storefront reads blog links, cards and shell meta through it) and the `BlogReferences` tag (Storefront's `MenuBlogReferences`, `SectionBlogReferences`).
- `WebOrderWorkflowTest` (paid cancel → `REFUND_REQUIRED`) and `HomepageBuilderTest` (`blog_posts` in the section types; the unknown-placement case uses `category_top` now that `popup` exists) updated.

#### Fixed
- A blog category without published posts (e.g. linked from a menu before its first post) showed *Page not found* in the storefront while the menu link and the server shell treated it as a page: the category page now takes its name from the listing's `meta.category` and shows "No posts have been published yet"; unknown slugs still 404 from the API.
- Lead fix: `OrderCancelledWithRefundEmail` read `cancel_reason`, which the storefront order view does not contain → `ErrorException` in the after-commit listener → HTTP 500 although the cancel and refund were committed. The sender now passes `cancel_reason` and the template falls back to null; `PaidOrderCancellationTest` renders the mail (`toMail`) so missing keys fail the test.

#### Notes
- As built beyond or instead of the spec: cancelling a paid order needs only `web_orders.refund` (not also `web_orders.manage`); a category reorder endpoint; a category slug is optional on create (from the name); blog slugs must be lower-case and `categories` is reserved as a post slug; a post's cover key nulls on media delete (posts that are not deleted, drafts included, are protected by the media reference check); `view_all_url: null` hides the link; no `GET /store/popup` (bootstrap only, with `updated_at` for the frequency key); a menu may link a draft post (shown once readable); the scheduled demo post is stored `published` with a date 7 days ahead; paging through `meta.pagination`.
- Promotion redemptions and coupon usage are not reversed by a paid cancellation.
- The demo popup is inactive so it does not cover pages during the full-stack tests; switch it on under *Online store → Banners → Popup*.
- Open issues: the **PostgreSQL run is still pending** (the new CHECKs on `blog_categories`, `blog_posts`, `banners` and `menu_items` have never run). The **pre-existing timezone mismatch** (`config/app.php` `timezone` hard-coded to `UTC`) is still open. Title, description and `og:image` are written by the server shell on the first load only; in-app navigation between blog pages does not update them client-side (as with `/pages/{slug}`). Full-stack: one run hung once on the homepage "Loading" while Vite re-optimized dependencies on its first hit (rerun green); the blog test retries opening a Radix select (`expect.toPass`).

### E-commerce E10b — Online returns and refunds, customer web activity, promotion report, ratings on cards (online store track)

Completes E10 (E10a: fulfilment). Online returns mirror the POS returns of Phase 6: proportional amounts with the remainder rule, restock to the original batches, refunds through the payments ledger.

#### Added
- **Return window:** `storefront_settings.return_window_days` (0–60, default 7; 0 = no online returns), counted from the order's `delivered_at`. `PATCH /storefront/settings` accepts it (audited) and `GET` returns it. Only `delivered` orders whose money was received (`paid`, `partially_refunded`) can be returned.
- **Online returns** (Orders module): `order_returns` (`RTN-WEB-000001` numbering via `SequenceGenerator`; status `requested|approved|received|refunded|rejected|cancelled`; reason `damaged|wrong_item|not_as_described|changed_mind|other`; customer note ≤ 500, staff note ≤ 500, rejection reason ≤ 200; `requested_by customer|staff`; `override_window`; `items_amount`, `shipping_refund`, `refund_amount` = items + shipping refund; refund method `cash|bank_transfer|mobile_banking` and reference ≤ 80; per-step times and actors), `order_return_lines` (requested quantity — fixed — and approved quantity with its amount, tax and cost; `restock` decided at receipt; `restocked_quantity`), the append-only `order_return_line_stock` (the `order_line_stock` allocation — batch, unit cost, movement — that restocked goods went back to) and the append-only `order_return_history`. New `orders.refunded_total`; order payment status gains `partially_refunded` and `refunded`.
- **Flow:** `requested` (customer or staff) → `approved` (staff may lower quantities — 0 drops a line — and add a `shipping_refund` up to the delivery fee not yet refunded) | `rejected` (reason) | `cancelled` (the customer, own return, while requested) → `received` (per line: restock — `online_return` stock movement back to the exact batches the order took, at their cost — or write-off) → `refunded` (payments ledger out, source `online_order_refund`). Refunds move the order to `partially_refunded`, or `refunded` once refunds equal `paid_total`; the order stays `delivered`. A line's amount is its proportional share of what the order line charged (discount and tax included); the return that takes the last unit of a line takes the exact remainder (`Sales\Domain\ReturnShare`). Quantities held by active returns (all but rejected and cancelled) limit what is left. Every step locks the order row, then the return row; out-of-order steps → `INVALID_STATUS_TRANSITION`. Audited `web_order_return.requested|approved|rejected|cancelled|received|refunded` and `web_order.refunded`.
- **Customer API:** `GET /store/account/orders/{number}` adds `returnable`, `return_deadline`, `return_unavailable_reason` (`not_delivered|not_paid|returns_disabled|window_closed|nothing_left`), `payment_status_label`, `refunded_total`, `returns[]` and per line `id` and `returnable_quantity`. `POST /store/account/orders/{number}/returns {reason_code, note?, lines: [{order_line_id, quantity}] (1–50)}` (idempotent) → 201; `422 RETURN_NOT_ALLOWED` (`details.reason`), `QUANTITY_EXCEEDS_RETURNABLE` (`details.lines`). `GET /store/account/returns` (own, newest first, 10 per page). `POST /store/account/returns/{number}/cancel` (idempotent; `422 RETURN_NOT_CANCELLABLE` unless requested). Another customer's order or return → 404.
- **Staff API:** `GET /web-order-returns?status=&search=&page=` (`web_orders.view`; `meta.status_counts`), `GET /web-order-returns/{id}` (lines, history, refund payments, `allowed_actions`); `POST /web-orders/{id}/returns` (staff-created; `override_window: true` with a required `note` after the window or with returns switched off) and `POST /web-order-returns/{id}/approve|reject|receive|refund` — all `web_orders.refund` and idempotent. Refund errors `REFUND_EXCEEDS_PAID`; cash refunds `CASH_SESSION_REQUIRED`, `INSUFFICIENT_CASH`. The staff web order adds per line `id` and `returnable_quantity`, `refunded_total`, `return_deadline`, `return_window_open`, `returns[]`, refunds in `payments` (direction `out`) and the allowed action `create_return`.
- **Notifications:** a customer's new request → inbox notification to every user with `web_orders.refund` (link `/web-returns/{id}`); approved, rejected and refunded → queued e-mail `OrderReturnStatusEmail` to the order's contact address (with a link to the account order page on the primary storefront domain, `StorefrontConfig::primaryUrl()`, when the order belongs to a customer).
- **Customer web activity:** `GET /customers/{id}/web-activity` (`customers.view`) → `{account | null, orders {count, total_spent (paid − refunded), last_order_at, average_order}, returns_count, reviews {count, pending}, wishlist_count, cart {item_count, updated_at} | null, recent_orders [5]}`, composed through three new Customers contracts (`CustomerWebOrders` ← Orders, `CustomerReviewStats` ← Reviews, `CustomerShoppingLists` ← Cart) with no-op defaults.
- **Promotion report:** `GET /promotions/{id}/report?date_from=&date_to=` (`promotions.view`; calendar days in the organization's timezone, at most 366 days) → `{date_from, date_to, timezone, currency, redemptions, orders, cancelled_orders, discount_total, order_revenue, average_discount, by_day [{date, redemptions, discount}]}`; with both dates every day of the range is listed.
- **Ratings on cards:** product cards gain `rating {average (one decimal), count} | null` (approved reviews, `ProductRatings::summaries()` — one grouped query per listing, no N+1); `GET /store/products?sort=rating` (average desc, then count desc, unrated last).
- **Storefront:** account order page *Return items* dialog (per-line checkbox and quantity stepper up to the returnable quantity, reason, note, deadline, a note that delivery and COD fees are not refunded; messages per error reason), the order's returns card with *Cancel request*, new `/account/returns` page (account nav, overview tile, header menu); stars with a text alternative ("Rated 4.5 out of 5", "(12)") on product cards; *Top rated* in the sort select.
- **Admin:** *Web returns* in the sidebar after *Web orders* (`/web-returns`, `web_orders.view`): list with status tabs and counts and search; return page with approve (quantity edit, optional shipping refund, note), reject (reason), receive (restock checkbox per line, on by default) and refund (method, reference) — actions need `web_orders.refund` and send an `Idempotency-Key`. Web order page: *Returns* card and *Create return* (override-window checkbox; note required after the window), payment status *Partially refunded* / *Refunded*, refunds in the payments. Customer sheet: *Web activity* card. Promotion editor: *Report* tab (date range defaulting to the last 30 days in the organization's timezone, five KPIs, per-day table with totals — no chart library). Inventory movement label *Online return*.
- Permission `web_orders.refund` (Organization Admin through `*`, Online Store Manager through `web_orders.*`, Accountant explicitly).
- Demo data: `return_window_days` 7 set explicitly (`DemoStorefrontSeeder`). No seeded order, number or stock changed; `WEB-000001` (delivered, paid, 2 × Pran Mango Juice) is left un-returned for the full-stack test.
- Tests: 482 backend tests (478 pass, 4 PostgreSQL-only skipped on SQLite) — new `OrderReturnsTest` (full lifecycle with exact restock to the original batches and ledger refund; window, override, reject and customer cancel; cash refund needs a register session; view versus refund permission; customer and organization isolation), `CustomerWebActivityTest`, `PromotionReportTest`, `ProductCardRatingsTest`; 522 Vitest tests in 72 files (`storefront/storefront-returns.test.tsx`, `features/web-returns/**`, `web-activity-card.test.tsx`, `report-panel.test.tsx`); Playwright: new mocked `returns-admin.spec.ts`, `storefront-account-orders.spec.ts` and `storefront-catalog.spec.ts` +1 each (mocked suite: 92 pass, 32 skipped) and the full-stack test `a shopper returns a delivered item; staff approve, receive it back into stock and refund it` (15/15 on desktop).

#### Changed
- `PaymentStatus::isPaid()` (paid, partially refunded or refunded) replaces `=== Paid` checks in `CancelOrder`, `CancelOwnOrder`, `OrderWorkflow::assertUnpaid()` and `RecordCodRemittance` — fixes a pre-existing gap: a refunded order would have counted as unpaid there (cancellable, COD payment recordable again, remittable).
- `ProductRatings` gains `summaries(array $productIds)`; `CatalogReadModel` takes `ProductRatings`; `CatalogSort` gains `rating`. `MovementType::OnlineReturn` (`online_return`, inbound).
- Storefront shell: `/account/returns` is a known (never indexed) account path.
- `WebOrderWorkflowTest` and `StoreCatalogTest` assertions updated (`create_return` in allowed actions, ratings on cards).

#### Notes
- As built beyond or instead of the spec: no `order_refunds` table — the refund (method, reference, time, actor) is on the return and the money in the payments ledger; extra columns `items_amount`, `override_window`, `requested_by_user_id` and the immutable `requested_quantity` next to the approved `quantity`; staff-created returns also start `requested`; `override_window` also bypasses returns switched off; cash refunds go through the refunding user's open register session in the order's branch (`PaymentLedger::record`), bank transfer and mobile banking through `recordSystem` (no drawer); a fully refunded order reports `nothing_left`; lines not listed at receipt are restocked; the promotion report reads `orders` read-only (read-model exception — Promotions does not depend on Orders) and adds `cancelled_orders` (redemptions of later-cancelled orders stay counted); the admin entry is *Web returns* (`/web-returns`) because the POS already has *Returns* (`/returns`).
- Shipping and COD fees are not refunded automatically; staff may add a shipping refund at approval. Returns do not reverse promotion redemptions or coupon usage.
- Not built: cancelling a paid order that is not delivered yet with a refund (still `ORDER_PAID` / `ORDER_NOT_CANCELLABLE`; returns need delivery), reversing a COD remittance, refunds without a return, an admin form for the return window, a stored rating projection.
- **Return window setting:** *Online store → Settings → Checkout* gains "Return window (days)" (0–60, default 7; 0 turns customer returns off), saved through `PATCH /storefront/settings`.
- Lead fixes: the staff notification link is `/web-returns/{id}` (was `/web-order-returns/{id}`); inventory movement label for `online_return`; `integration.spec.ts` matches the POS *Returns* link exactly (the new *Web returns* link also matched).
- Open issues: the **PostgreSQL run is still pending** (the local `postgres` password was rejected; the new CHECKs, triggers and every PostgreSQL-only test have never run). The **pre-existing timezone mismatch** (`config/app.php` `timezone` hard-coded to `UTC`; between 00:00 and 06:00 Asia/Dhaka the GRN invoice date and the sales list's "today" disagree) is still open. The first full-stack attempt failed at the very first sign-in (cold backend); the rerun passed 15/15 on desktop. One Vitest test failed once under full parallel load and passed on rerun (522/522).

### E-commerce E10a — Fulfilment: couriers, shipments, printing and COD remittances (online store track)

E10 is split: **E10a** (this) drives the order lifecycle from the admin; **E10b** (next) covers online returns and refunds, customers' web activity, promotion reports and ratings on product cards with the rating sort.

#### Added
- **Couriers** (Shipping module): `couriers` (name ≤ 80, unique per organization regardless of case; phone ≤ 20; optional `tracking_url_template` — an absolute http(s) URL containing `{tracking}`, replaced by the url-encoded tracking number; active switch; sort order). Staff `GET /shipping/couriers?active=1` (`shipping.manage` or `web_orders.view`), `POST /shipping/couriers`, `PATCH`/`DELETE /shipping/couriers/{id}` (`shipping.manage`; a courier that carried a shipment or sent a remittance → `422 IN_USE`, deactivate it instead). Audited `courier.*`. `CourierDirectory` contract (find, summaries, tracking link) for Orders.
- **Shipments** (Orders module): `shipments` (one per order in E10a; courier, courier name snapshot, tracking number ≤ 60, status `handed_over|in_transit|delivered|returned`, `cod_amount` = the total of an unpaid cash-on-delivery order, else 0; shipped/delivered/returned times) and the append-only `shipment_events` (status, note ≤ 200, occurred_at, recorded by). `POST /web-orders/{id}/ship` now takes `{courier_id, tracking_number? (≤ 60), note? (≤ 200)}` — an active courier of the organization, else a field error on `courier_id` — and creates the shipment with its first event `handed_over`. New `POST /web-orders/{id}/shipment/events {status: in_transit|delivered|returned, note?, occurred_at?}` (`web_orders.manage`, idempotent): `occurred_at` defaults to now, may be at most 5 minutes ahead and not before the hand-over; `delivered` delivers the order (the E8a deliver path); `returned` (refused or undeliverable) marks the parcel returned to the sender. Orders without a shipment → `422 SHIPMENT_NOT_FOUND`; a delivered or returned parcel → `INVALID_STATUS_TRANSITION`. Audited `web_order.shipment_updated` / `web_order.shipment_returned`.
- **Returned parcels:** `POST /web-orders/{id}/cancel` also accepts a `shipped` order whose shipment is `returned` and which is unpaid — the stock goes back to the exact batches through the existing `CancelOrder` path, once.
- **Orders board:** `GET /web-orders` gains `payment_method` (`cod`|`bank_transfer`), `courier_id`, `district_id`, `date_from`/`date_to` (aliases of `from`/`to`: calendar days of `placed_at` in the organization's timezone) and `cod_unremitted=1` (delivered COD orders still unpaid); 25 per page by default. Rows add `district`, `courier_name`, `tracking_number`, `shipment_status`, `delivered_at`. `meta.status_counts {all, pending_payment, confirmed, processing, shipped, delivered, cancelled, cod_unremitted}` for the current filters except `status` (and except `cod_unremitted` for its own count).
- **Bulk processing:** `POST /web-orders/bulk/process {order_ids (1–100)}` (`web_orders.manage`, idempotent) moves each confirmed order to processing in its own transaction; never all-or-nothing → `{results: [{id, number, ok, error_code?, message?}], succeeded, failed}` (`NOT_FOUND`, `INVALID_STATUS_TRANSITION`).
- **Printing:** `GET /web-orders/print?ids[]=…&kind=packing_slip|invoice` (`web_orders.view`, 1–100 ids, read-only, records nothing) → `{kind, organization {name, legal_name, address, phone, email, tax_number, logo_url (storefront theme logo)}, orders}` in the requested order; a packing slip carries no price fields, an invoice adds line prices, discounts and tax and the order totals (subtotal, discounts, delivery and its discount, COD fee, promotions, coupon, total, paid, balance due). Any id that is not an order of the organization → 404. The admin renders print-ready HTML — no PDF library.
- **COD remittances** (permission `web_orders.remit`): `cod_remittances` (`REM-000001` numbering, courier, `reference` ≤ 60 = the courier's statement number, `received_at` date, method `bank_transfer|cash|mobile_banking`, gross, fee, net, link to the fee expense, note ≤ 500; append-only) and `cod_remittance_lines` (one per order; an order is remitted once). `POST /cod-remittances {courier_id, reference?, received_at (not after today in the organization's timezone), method, fee_amount (≥ 0, ≤ gross), order_ids (1–500), note?}` (idempotent): all or nothing — every order must be this organization's, cash on delivery, unpaid, delivered and shipped with that courier, else `422 REMITTANCE_INVALID` with `details.orders [{id, number, reason: not_found|not_cod|already_paid|not_delivered|other_courier}]`. In one transaction with the orders locked in id order: each order is paid through the same code path as *Record COD payment* (`OrderWorkflow::recordCodPaymentLocked`: ledger `cash_on_delivery` for the order total, source `online_order`, reference = the REM number), and a fee above zero becomes an expense in the category "Courier fees" (created when missing; party = the courier, dated `received_at`, reference = the REM number) through the new Expenses `ExpenseRecorder` contract. `GET /cod-remittances?courier_id=&date_from=&date_to=&search=&page=` (newest number first) and `GET /cod-remittances/{id}` (adds `note`, `expense {id, number}`, `lines`). No edit or delete. Audited `cod_remittance.recorded`. The staff order adds `shipment` (with `events`), `cod_remittance {id, number, received_at}` and the allowed action `add_shipment_event`.
- **Storefront:** the guest order page and the account order page show the courier and, when the courier has a template and the order a tracking number, a *Track parcel* link (new tab, `rel="noopener"`); both order views gain `tracking_url` (null otherwise).
- **Admin:** *Online store → Shipping* gains a *Couriers* tab (`/storefront/shipping/couriers`: list, add/edit dialog with a live tracking-link example, active switch, delete of unused couriers). *Web orders* becomes a board: status tabs with counts (All, Pending payment, Confirmed, Processing, Shipped, Delivered, Cancelled, *COD to collect*), filters kept in the URL (search, courier, payment method, district, date range), row selection with bulk *Mark processing* (per-order result dialog; the `Idempotency-Key` is reused on retry), *Print packing slips* and *Print invoices*. Order detail: *Ship* dialog with the active couriers (a link to the settings when there are none), tracking number and note; shipment card (courier, *Track parcel*, cash to collect, timeline of updates, *Add tracking update* — In transit / Delivered / Returned to sender with a note; the server takes the current time); cancel wording for returned parcels; print links; link to the remittance; pre-E10a orders show their stored courier line. Print view `/web-orders/print?ids=…&kind=…` outside the admin layout (A4, one page per order, packing slip with a "packed" column and no prices; opens the print dialog once loaded; *Print* and *Back* are hidden on paper). *COD remittances* in the sidebar after *Web orders* (`web_orders.remit`): list (courier, date range), *New remittance* (courier → its delivered unpaid COD orders with checkboxes and a running gross; fee ≤ gross, net, method, statement number, received date defaulting to today in the organization's timezone; `REMITTANCE_INVALID` reasons inline per order with a remove button) and the remittance page (amounts, fee expense number, orders).
- Permission `web_orders.remit` (Organization Admin through `*`, Online Store Manager through `web_orders.*`); the built-in **Accountant** role gains `web_orders.view` and `web_orders.remit`.
- Demo data: couriers Pathao (tracking template `https://merchant.pathao.com/tracking?consignment_id={tracking}`), Steadfast and RedX (`DemoCheckoutSeeder`). `WEB-000001` is now shipped through the new ship path with Pathao (`DEMO-TRK-0001`, a shipment with a tracking link), still delivered and paid; new `WEB-000003` — 1 kg Miniket Rice, 132.00, shipped with Steadfast (`DEMO-SF-0002`), in transit, COD unpaid (`DemoAccountSeeder`). No remittance is seeded. Seeded Miniket Rice stock 321; juice stays 54.
- Tests: 474 backend tests (470 pass, 4 PostgreSQL-only skipped on SQLite) — new `FulfilmentTest` (couriers CRUD, validation, `IN_USE`, permissions and isolation; shipment events, tracking link and delivery; storefront tracking link; returned parcel cancelled with exact restock, once; board filters and counts; bulk process; print; remittance validation, payment, fee expense, replay, list/detail and isolation; remittance permissions); 477 Vitest tests in 66 files (`web-orders-board.test.tsx`, `couriers-page.test.tsx`, `cod-remittances/remittances.test.tsx`, `storefront/orders/track-parcel.test.tsx`, web order page additions); Playwright: mocked `web-orders-admin.spec.ts` (+3 tests) and new `cod-remittances-admin.spec.ts` (mocked suite: 82 pass, 30 skipped) and the full-stack test `a COD parcel is delivered and paid through a courier remittance in the admin`.

#### Changed
- `POST /web-orders/{id}/ship` no longer accepts `courier_name`; `courier_id` is required. The order still stores `courier_name` and `tracking_number`, so lists, e-mails and the storefront keep working. Orders shipped before E10a have no shipment and no events (`shipment: null`, shown as a legacy courier line; tracking updates → `SHIPMENT_NOT_FOUND`; `/deliver` still works for them).
- `POST /web-orders/{id}/deliver` adds a `delivered` event when the order has a shipment and is refused for a parcel returned to the sender.
- `OrderWorkflow::recordCodPayment()` now wraps `recordCodPaymentLocked()`, the one COD payment path shared with remittances. `OrganizationDirectory::summary()` returns `legal_name`, `tax_number`, `email`, `phone`, `address`. `shipping.manage` now also covers couriers.
- Full-stack suite: guest orders placed by the suite start at `WEB-000004` (the seed places three).

#### Notes
- Decisions: shipments belong to the **Orders** module (the order lifecycle), couriers to **Shipping**; one shipment per order in E10a. Printing is HTML with print CSS in the SPA — **no PDF library**. Remittances are **all or nothing** and append-only (a reversal, if needed, is E10b). The manual *Record COD payment* stays for own-rider deliveries.
- As built beyond or instead of the spec: `status_counts` also has `all` and every status; bulk results are wrapped in `{results, succeeded, failed}` and carry `message`; `SHIPMENT_NOT_FOUND` is a new code; printing answers 404 when any id is foreign (no partial sheet); `received_at` is a date, not a time; an inactive courier can still be named on a remittance (it only cannot take new shipments); the fee expense uses ledger method `cash_on_delivery` (the fee was withheld from the collected cash) on the first order's branch; for a returned parcel *Record COD payment* is hidden and the endpoint refuses it (`INVALID_STATUS_TRANSITION`, `details.shipment_status: returned`) — no cash was collected, so the order stays cancellable.
- Not built: several shipments per order, courier API integrations and automatic tracking, PDF files, editing or reversing a remittance, online returns and refunds (E10b).
- Open issues: the **PostgreSQL run is still blocked** (the local `postgres` password was rejected; the new CHECKs, triggers and every PostgreSQL-only test have never run). The **pre-existing timezone mismatch** (`config/app.php` `timezone` hard-coded to `UTC`; between 00:00 and 06:00 Asia/Dhaka the GRN invoice date and the sales list's "today" disagree) is still open. The E10a full-stack run was outside that window: 14/14 on desktop against a fresh seed.

### E-commerce E9 — Customer account area: orders and reviews (online store track)

#### Added
- **Order history** `GET /store/account/orders?status=open|delivered|cancelled&page=` (signed-in customer, `Cache-Control: no-store`): the customer's own web orders (`orders.customer_id`), newest first, 10 per page; `open` = awaiting payment, confirmed, processing or shipped; an unknown `status` is a field error. Rows `{number, placed_at, status, status_label, payment_status, payment_method_label, item_count, total, currency, first_item: {name, image_url}}`.
- **Order detail** `GET /store/account/orders/{number}`: the E8a/E8b order view (lines with discounts, totals, promotions, coupon, address, history, courier and tracking number, payment instructions) plus `can_cancel`, `cancelled_at`, `cancel_reason` and per line `product_id`, `variant_id`, `review` (`{id, rating, status}` or null) and `reviewable` (delivered and not reviewed yet). Another customer's order, another store's order and unknown numbers are 404; guests 401.
- **Customer cancel** `POST /store/account/orders/{number}/cancel {reason? ≤ 200}` (`storefront-write`, `Idempotency-Key` required — `idempotent:shopper`, scope `customer:{account id}`; a retry replays the first answer with `Idempotent-Replayed: true`): only while `pending_payment` or `confirmed` **and** unpaid, else `422 ORDER_NOT_CANCELLABLE` (`details.status`, `details.payment_status`). New `CancelOwnOrder` locks the order and reuses the E8a `CancelOrder::cancelLocked()` path (stock back to the exact batches, history row with actor type `customer`); afterwards the `OrderCancelledByCustomer` event sends the shopper a queued cancellation e-mail and every staff user with `web_orders.view` an inbox notification "Order WEB-… cancelled by the customer". Returns the order as `GET` shows it.
- **Buy again** `POST /store/account/orders/{number}/reorder` → `{cart, added: [{variant_id, name, quantity}], skipped: [{name, reason: unavailable|out_of_stock|limit}]}`: every line's variant goes into the customer's cart with the ordered quantity through the new `ShoppingCart::addLines()` (merged with existing lines, capped at the fulfilment store's stock and 999, at most 50 lines); prices are today's.
- **Reviews module** (`reviews`: one per customer and product, rating 1–5, optional title ≤ 120, body 10–2000 characters of plain text, status `pending|approved|rejected`, rejection reason, moderator, `order_line_id` of the delivered line that verifies the purchase). Customer API `GET/POST /store/account/reviews`, `PATCH/DELETE /store/account/reviews/{id}`: writing needs a **delivered** web order line of the product (`422 REVIEW_NOT_ALLOWED`; asked through Orders' `PurchaseVerifier`), a second review of the product → `422 REVIEW_EXISTS` (`details.review_id`); new and edited reviews are `pending` (an edit clears the moderation); own list 20 per page with product name, slug, image, status and rejection reason. Public `GET /store/products/{slug}/reviews?sort=newest|highest|lowest&rating=&page=`: approved only, 10 per page, author as first name + last initial ("Rina A."), every review `verified: true`, and a top-level `summary {average (one decimal, null without reviews), count, distribution "1"…"5"}` over all approved reviews (not narrowed by `rating`). `GET /store/products/{slug}` gains `rating: {average, count} | null`.
- **Moderation** (staff): `GET /reviews?status=&rating=&search=&page=&per_page=` (`reviews.view`; pending first, then newest; search over title, body, product name, customer name and e-mail; `meta.pending_count`), `POST /reviews/{id}/approve`, `POST /reviews/{id}/reject {reason? ≤ 200}`, `DELETE /reviews/{id}` (`reviews.moderate`). Repeating an approve or reject changes nothing. Audited `review.approved`, `review.rejected`, `review.deleted`.
- Permissions `reviews.view` and `reviews.moderate` (Organization Admin through `*`; Online Store Manager already lists `reviews.*`, ADR-016).
- Rate limiter `reviews` on new reviews: `POS_REVIEW_RATE_LIMIT` (default 5) per hour per signed-in customer, after `storefront-write`.
- **Storefront:** account navigation and header menu gain *Orders* and *Reviews*; `/account/orders` (tabs All / Open / Delivered / Cancelled, pagination, empty state with *Start shopping*), `/account/orders/:number` (shared order view: lines, discounts, totals, address, status timeline with courier and tracking number, payment instructions; *Cancel order* with a confirm dialog and optional reason; *Buy again* opens the mini-cart and lists skipped items in a toast; *Write a review* / edit / delete per delivered line in a dialog with a 1–5 star radio group), `/account/reviews` (own reviews with Pending / Published / Rejected and the reason); account overview *Recent orders* (last 3). Product page: stars + "4.5 (12 reviews)" near the title linking to a *Reviews* tab (summary with distribution bars, sort, rating filter, pagination, "No reviews yet", and "Bought this? Review it from your orders." for signed-in customers). A signed-in customer's confirmation page links to the account order page; guests keep `/order/:number`. The HTML shell serves `/account/orders`, `/account/orders/{number}` and `/account/reviews` as `noindex`.
- **Admin:** *Reviews* in the sidebar after *Promotions* (`reviews.view`): tabs Pending (default) / Approved / Rejected / All, rating filter, search, pagination, approve, reject with an optional reason, delete with confirmation — read-only without `reviews.moderate`. Web order detail: history entries say who acted (customer, staff, system) and a customer cancellation shows "Cancelled by customer" with the reason.
- Demo data (`DemoAccountSeeder`, last in `DatabaseSeeder`, through the real placement and workflow services, order e-mails and staff notifications suppressed): `shopper@demo.test` has `WEB-000001` — 2 × Pran Mango Juice 250ml with the "Juice week" discount, 111.75 including 60.00 delivery, processed, shipped (Pathao, `DEMO-TRK-0001`), delivered, COD recorded — with an approved 5-star review "Tastes like real mangoes", and `WEB-000002` — 1 kg Miniket Rice, 132.00, confirmed, unpaid COD (cancellable). No pending review is seeded (there is no second customer account).
- Tests: 463 backend tests (459 pass, 4 PostgreSQL-only skipped on SQLite) — new `AccountOrdersTest` (history and groups, guest orders not attached, detail, customer B and another organization → 404, cancel with restock/history/notifications, cancel rules, re-order, shell paths) and `ReviewsTest` (delivered purchase only, once; edit/delete and isolation; public list, summary, sort, filter; moderation idempotency and audit; permissions; rate limit; public author name); 439 Vitest tests in 62 files (`storefront-account-orders.test.tsx`, `features/reviews/pages/reviews-page.test.tsx`, web order additions); Playwright: mocked `storefront-account-orders.spec.ts` and `reviews-admin.spec.ts` (mocked suite: 72 pass, 28 skipped) and the full-stack test `a shopper cancels an order, buys again and reviews a delivered product; the admin publishes the review`.

#### Changed
- `order_status_history.actor_type` (`customer` \| `staff` \| `system`, nullable): written by placement (customer), the staff workflow (staff), the expiry job (system) and the customer cancel; older rows are derived by the presenter. The staff web order history adds `actor_type` next to `actor`. `CancelOrder` takes a nullable reason and an actor type.
- `StorefrontCatalog::liveProductId()` and `productSummaries()`; `CustomerDirectory::summaries()` returns `email`; the product page asks OnlineCatalog's new `ProductRatings` contract (no ratings without the Reviews module).
- Seeded juice stock: the two demo web-order juices lower the full-stack expectations of the receipt and POS tests (56 → 54, 152 → 150, 150 → 148).
- New config `pos.review_rate_limit` (`POS_REVIEW_RATE_LIMIT` in `.env.example`).

#### Notes
- Decisions: orders placed as a **guest with the same e-mail are not attached** to the account (owning the address is not proven); **only verified purchases** (a delivered order line) can be reviewed — no unverified reviews; product **cards show no rating** until E10 (with the rating sort); the rating summary is an aggregate query over approved reviews, **not cached** in E9.
- As built beyond or instead of the spec: per line `review` + `reviewable` instead of `can_review`, plus `variant_id`; `cancelled_at` and `cancel_reason` on the detail; `details.payment_status` on `ORDER_NOT_CANCELLABLE`; `actor_type` on the staff history only (the guest-facing `/store/orders/{number}` history is unchanged); the customer's review list is 20 per page; the `reviews` limiter also counts refused attempts (`REVIEW_EXISTS`, `REVIEW_NOT_ALLOWED`); moderation takes no idempotency key (approve/reject are naturally idempotent); review bodies are trimmed plain text stored as typed (not sanitized — every client escapes them).
- Not built: reviews with photos, helpful votes and replies, ratings on cards and the rating sort (E10); returns from the account (E10); cancelling a paid order (needs refunds, E10); a pending-count badge in the admin sidebar.
- Open issues: the PostgreSQL run is still blocked (the new CHECKs and every PostgreSQL-only test have never run). The **pre-existing timezone mismatch** recorded in E8b is still open (`config/app.php` `timezone` hard-coded to `UTC`; GRN invoice date and the sales list's "today" disagree between 00:00 and 06:00 Asia/Dhaka). The E9 full-stack run was outside that window: all 13 full-stack tests passed on desktop against fresh seeds.

### E-commerce E8b — Promotions, coupons, flash sales and hot deals (online store track)

#### Added
- **Promotions module** (web channel only; the POS ignores promotions): `promotions` (name ≤ 80, description ≤ 200 shown to shoppers, type `percent` / `fixed` / `free_shipping`, value, scope `order` / `products` / `categories` / `brands` with targets — categories include their sub-categories — optional `min_subtotal`, `max_discount`, trigger `automatic` / `coupon`, optional start and end, `show_countdown`, active switch, optional total and per-customer usage limits), `promotion_targets`, `coupons` (codes upper-case `[A-Z0-9-]{3,40}`, unique per organization regardless of case, optional usage limit, `used_count`, active switch) and the append-only `promotion_redemptions`. A promotion with `show_countdown` (automatic, product scope, with an end) is a **flash sale**. Free delivery is order scope only; percent 0.01–100, fixed > 0. The module depends only on the Catalog, Products, Customers and Organizations contracts; Cart, Orders, OnlineCatalog and Storefront use it through `PromotionPricing`, `PromotionRedemptions` and `CatalogPromotions`.
- **Application rule** (pure, clock-free `Domain\PromotionEngine`, unit-tested): (1) each line gets at most **one product promotion** — among the live automatic ones and the coupon's, the one giving that line the largest discount (ties → earliest end, then id); percent of the line amount, fixed per unit (never more than the line amount); `min_subtotal` against the subtotal of the lines it matches; `max_discount` caps the promotion's total, shared out with `Money::allocate`; (2) the **single best order promotion** applies to the subtotal after product discounts (`min_subtotal` against the subtotal before discounts); (3) **free delivery** when any free-shipping promotion is eligible — the delivery fee is waived, the COD fee is still charged; (4) a valid coupon beaten by an automatic offer stays on the cart unused (`better_offer`, "A better offer is already applied.") and is not redeemed. No customer groups, stacking flags or priorities.
- **One pricing path** (ADR-005): `CartPricer` passes each line's product discount to `SaleCalculator` as the line's `Discount::amount` and the order discount as its invoice discount, so tax is computed after discounts in both tax modes and cart, checkout preview, placement and order agree.
- **Cart:** lines add `discount_amount` (product discount + share of the order discount) and `promotion` (`{id, name}` or null); totals `subtotal` (before discounts), `discount_total`, `tax_total`, `total`; `promotions` (`[{id, name, kind: product|order, amount}]`), `free_shipping` (`{id, name}` or null) and `coupon` (`{code, applied, reason, message, promotion_name}` or null). `POST /store/cart/coupon {code}` (one coupon per cart, `carts.coupon_code`) returns the repriced cart or `422 COUPON_INVALID` with `details.reason` `not_found` (also switched off or malformed) / `not_started` / `expired` / `usage_limit_reached` / `customer_limit_reached` / `min_subtotal` (+ `details.min_subtotal`) / `not_applicable` (also an empty cart); `DELETE /store/cart/coupon`. A coupon that becomes invalid later stays on the cart with `applied: false` and its reason, is ignored in the totals and never blocks checkout.
- **Checkout and orders:** preview, placement and the order view add `discount_total` (goods), `shipping_discount` (the waived delivery fee), `promotions` (`[{name, kind: product|order|shipping, amount}]`), `coupon_code` (only when the coupon was redeemed) and line `discount_amount`; the preview also returns the cart's `coupon`. New `orders.discount_total`, `shipping_discount`, `coupon_code`, `order_lines.discount_amount` and the append-only `order_promotions` snapshot. Placement locks the promotions **with usage limits** and the coupon (`FOR UPDATE`, sorted ids), prices again under the locks (at most three rounds) and appends one redemption per promotion used (shipping only when a fee was waived), incrementing `coupons.used_count`; a limit reached meanwhile drops that promotion and answers the existing `409 TOTAL_CHANGED` with the fresh preview (whose `coupon.reason` explains it). An idempotent replay redeems nothing twice. Per-customer limits count signed-in customers by customer and guests by lower-case contact e-mail (at placement).
- **Catalog display:** product cards and the product detail add `promotion` (`null` or `{id, name, type, value, ends_at, show_countdown, price}` — the best live automatic product-scope promotion for one unit, total usage limit respected; coupon promotions are never shown); product detail variants add `promo_price`. Listing filters and sorting keep the base price.
- **Hot deals** homepage section (`hot_deals`): config `{promotion_id (a flash sale, or null for every running one), limit 4–12 (8), view_all_url}` (a promotion that is not an automatic countdown promotion → `PROMOTION_NOT_FOUND`); public payload `{products: [card], ends_at}` (the earliest end among the shown cards); left out when no flash sale has live products (preview `state: "empty"`).
- **Staff API** (`promotions.view` / `promotions.manage`): `GET/POST /promotions`, `GET/PATCH/DELETE /promotions/{id}` (delete only while unused, else `IN_USE`), `GET/POST /promotions/{id}/coupons` (one code or up to 500 generated — prefix + 8 characters without look-alikes; `NOT_A_COUPON_PROMOTION`, `CODES_EXHAUSTED`), `PATCH/DELETE /coupons/{id}` (delete unused codes only), `GET /promotions/{id}/redemptions`. Combination rules are field errors. Audited `promotion.*` and `coupon.*`. The staff web order detail shows the same discount fields.
- **Admin:** *Promotions* in the sidebar after *Web orders* (list with state badges, status/trigger filters, search, pagination and a "Flash sale" tag; editor with helper text on how offers combine, value as % or currency, maximum discount for percent only, free delivery forcing the order scope, countdown switch only where allowed, usage limits, schedule in the organization's timezone, product/category/brand target picker; *Coupons* tab with search, add, bulk generate with prefix and a "Copy all" dialog, on/off switch, usage limit, delete unused; *Redemptions* tab linking to the web order). A promotion that orders used offers deactivation instead of deletion. Homepage builder: hot-deals section editor (one flash sale or "All flash sales", limit, view-all link). Web order detail: discount column, promotion rows with their kind, the waived delivery fee and the coupon code.
- **Storefront:** promo badge (−10 % / −৳20) and promotional price with the base price struck through ("From" when variants differ) on cards, quick view and product page, replacing the "Sale" badge; countdown chip (hh:mm:ss, days above 24 h; screen readers get a static "Ends …" label, reduced motion updates once a minute) — cards revert when the sale ends. Cart page and mini-cart: line discounts, discount rows with promotion names, free-delivery note and a coupon box (messages per reason, rate-limit message, better-offer note). Checkout summary and order page: discounts, coupon, waived delivery ("Was ৳60 Free"), a note linking to the cart when the coupon is not applied. Homepage hot-deals section with a large countdown and a product rail that hides itself and refetches the homepage at zero. The order confirmation e-mail lists the discounts, the coupon and the free-delivery saving.
- Permissions `promotions.view` and `promotions.manage` (Organization Admin; Online Store Manager already holds `promotions.*`, ADR-016).
- Rate limiter `coupon` on applying a code: `POS_COUPON_RATE_LIMIT` (default 10) per minute per signed-in customer, else per guest cart, else per IP (ADR-015).
- Demo data (`DemoPromotionsSeeder`, after the checkout seeder): flash sale "Juice week" (10 % off brand Pran, countdown, ends 7 days after seeding — mango juice 25.00 → 22.50, litchi drink 22.00 → 19.80), coupon promotion "Welcome 50" (code `WELCOME50`, 50 off orders from 500, once per customer) and "Free delivery over 3000" (automatic). `DemoStorefrontSeeder` adds a "Hot deals" section (every flash sale, limit 8, view all `/shop`) right after the hero.
- Tests: 447 backend tests (443 pass, 4 PostgreSQL-only skipped on SQLite) — new `PromotionEngineTest` (14 unit tests: best per line, ties, fixed per unit capped, minimum subtotals, capped allocation, order discount after product discounts, free delivery, better offer), `PromotionCheckoutTest`, `PromotionAdminTest`, `PromotionCatalogTest` and PostgreSQL-only `PromotionConcurrencyTest` (two placements racing for a single-use coupon; **not run yet**); 401 Vitest tests in 60 files; Playwright: `promotions-admin.spec.ts` and new tests in `storefront-checkout.spec.ts`, `storefront.spec.ts` and `web-orders-admin.spec.ts` (mocked suite: 60 pass, 26 skipped — the opt-in full-stack specs and two by design) and the full-stack test `a flash sale and the WELCOME50 coupon lower the price from card to placed order and the admin order`.

#### Changed
- `StorefrontCatalog::variantsForCart()` returns `brand_id` and `category_id` for the promotion rules; `StorefrontCatalog::hotDealCards()`; `ProductDirectory::products()` (names of non-archived products, for targets).
- Checkout preview and placement waive the delivery fee under a free-delivery promotion (`shipping_total` `"0.00"`, `shipping_discount` = the waived fee); cart writes in the storefront also invalidate the cached checkout preview.
- New config `pos.coupon_rate_limit` (`POS_COUPON_RATE_LIMIT` in `.env.example`).

#### Notes
- As built beyond the spec: redemptions also store `customer_id`, `order_number` and `kind`; only promotions with usage limits are locked at placement (unlimited ones never serialize sales); the `better_offer` reason; list rows carry `show_countdown`, coupon rows `id`; the preview returns the cart's `coupon`; `coupon_code` on create; `orders.coupon_code` only when the coupon was redeemed; coupons list sorted by code by default; cards price a quantity of 1, so a product promotion whose `min_subtotal` is above the unit price does not show on cards.
- Not built: promotions at the POS (web only), freeing a redemption when an order is cancelled or expires (E10 may revisit), customer groups, stacking and priority, promotional prices in listing filters and sorting (E12).
- Open issues: the PostgreSQL run is still blocked (CHECKs, the append-only triggers and `PromotionConcurrencyTest` were never executed). `CatalogReadModel` caches can outlive a request inside one test process (the multi-shop test uses only the second shop's cart). **Pre-existing timezone mismatch** (not caused by E8b): `config/app.php` has `timezone` hard-coded to `UTC`, so between 00:00 and 06:00 Asia/Dhaka the GRN form's invoice date (the browser's local date) fails "before or equal to today" on the server, and forcing the browser to UTC instead breaks the sales list's "today" filter (organization timezone); the 6 POS/back-office full-stack tests failed for that reason in the E8b run, while the 6 e-commerce full-stack tests passed on desktop.

### E-commerce E8a — Shipping, checkout and orders with cash on delivery and bank transfer (online store track)

#### Added
- **Shipping module:** delivery zones (`shipping_zones`: name, active, order) made of districts (`shipping_zone_districts`; **one zone per district** per organization — saving a zone with a district another zone covers fails with `DISTRICT_IN_OTHER_ZONE`, naming the districts and their zones, backed by a unique index) and delivery methods per zone (`shipping_methods`: name, description, flat fee, optional `free_over` — free when the goods total after tax reaches it — `cod_allowed`, `cod_fee`, ETA 0–30 days with min ≤ max, active, order). Deleting a zone deletes its methods; orders keep their snapshot. Public `GET /store/shipping-methods?district_id=` (the active methods of the district's active zone, `[]` when none). Couriers and shipments are E10: shipping records a courier name and tracking number on the order.
- **OnlinePayments module** (ADR-006, offline methods only): `payment_gateways` per organization for `cod` and `bank_transfer` (enabled, display name, instructions ≤ 2000 shown after placing the order, settings `max_order_total` for COD and `hold_hours` 1–168 for bank transfer, order), rows created with defaults on first use (cash on delivery on, bank transfer off). Drivers behind the `PaymentGateway` interface never redirect; bank transfer orders wait for money. A disabled method, COD on a delivery method without COD or COD above `max_order_total` → `PAYMENT_METHOD_UNAVAILABLE` (`details.reason` `disabled` / `delivery_method` / `max_order_total`). **No online gateways yet** (E8c, once sandbox credentials are available).
- **Orders module** (ADR-003): web orders are their own document (`orders`, `order_lines`, `order_line_stock`, `order_addresses`, `order_status_history`), numbered `WEB-000001` per organization. Lifecycle `pending_payment → confirmed | cancelled`, `confirmed → processing | cancelled`, `processing → shipped | cancelled`, `shipped → delivered`; anything else is `INVALID_STATUS_TRANSITION`. Payment status `unpaid` / `paid`. Cash-on-delivery orders start `confirmed`; bank-transfer orders start `pending_payment` and expire after the method's hold hours. Lines, batch allocations and history are append-only (PostgreSQL triggers).
- **Checkout** (brief check 13): `GET /store/checkout/options`, `POST /store/checkout/preview` (the order as it would be placed now, any subset of the body) and `POST /store/checkout` (**`Idempotency-Key` required**). Placement runs in one transaction: lock the cart → reprice it through the E7 `CartPricer` → address, delivery method, payment method → compare the shopper's `expected_total` with the server total (`409 TOTAL_CHANGED` with the fresh preview) → number → **post the stock** from the fulfilment store (`online_order`, FEFO batches, never below zero even where the branch allows negative stock) → write the order and its snapshots → mark the cart converted. Any cart issue blocks placement (`CART_HAS_ISSUES` with the cart). Delivery and COD fees are added after tax and are **not taxed**. Guests (when the store allows it) give name, e-mail and phone; their orders have **no customer record** (contact snapshot only) and get a random access token (stored as sha-256) for `/order/{number}?token=`. Signed-in customers use a saved address (`shipping_address_id`) or a new one, optionally saved to the address book (skipped silently when the area is missing or the book is full). Unverified e-mail addresses may check out.
- `GET /store/orders/{number}` — the confirmation/status page data for the guest's token or the signed-in owner (anything else 404, `Cache-Control: no-store`); bank-transfer instructions while the order awaits payment.
- **Stock leaves exactly once** (brief check 14): placement posts `online_order` movements inside the order transaction and keeps the exact batch allocations in `order_line_stock`; cancellation puts them back to the same batches at the same cost (`online_order_cancel`). The order row is locked for every change, so a second cancel (or a cancel racing the expiry job) is refused without a second restock.
- **Staff web orders** (`web_orders.view` / `web_orders.manage`): `GET /web-orders` (status, payment status, date range in the organization's timezone, search by number, name, phone or e-mail), `GET /web-orders/{id}` (customer, client details, notes, history with actors, ledger payments, `allowed_actions`) and the steps `confirm-payment` (bank transfer, reference required), `process`, `ship` (courier, tracking number), `deliver`, `record-cod-payment` (shipped or delivered COD orders) and `cancel` (reason; unpaid orders only, `ORDER_PAID` otherwise), each with an `Idempotency-Key`, audited `web_order.*`, returning the full order. Confirmed bank transfers and COD remittances go into the payments ledger for the order total (`bank_transfer` / `cash_on_delivery`, source `online_order`, no drawer); a second payment is `ORDER_ALREADY_PAID`.
- **Expiry:** `orders:expire-pending`, scheduled every minute (`withoutOverlapping`), cancels bank-transfer orders past their hold with reason `payment_expired` and no actor, restocking them; each order is taken with `FOR UPDATE SKIP LOCKED` on PostgreSQL and re-checked under the lock.
- **E-mails and notifications:** a queued order confirmation e-mail to the contact address (lines, totals, delivery address, payment method, bank-transfer instructions and deadline, link to the order page — with the token for guests); an inbox notification "New online order WEB-000123" (`orders.new_online_order`, payload `{title, message, order_id, number, total, url, link}`) to every active staff user with `web_orders.view`. A notification failure never fails the order.
- **Admin:** *Web orders* in the sidebar (list with status and payment filters, search, date range and pagination, filters in the URL; order page with lines, totals, customer, delivery, payment with the instructions the customer received, history and action buttons per `allowed_actions` with dialogs for reference, courier/tracking and cancel reason — every action sends an `Idempotency-Key` reused on a safe retry); *Online store → Shipping* (zones with a district picker grouped by division, districts of other zones locked with that zone's name; methods per zone with a create/edit dialog) and *Online store → Payments* (cash on delivery and bank transfer cards: switch, display name, instructions, hold hours / maximum order total); *Allow guest checkout* switch under *Online store → Settings & domains*. Stock movement lists label `online_order` "Online order" and `online_order_cancel` "Online order cancelled"; the payments ledger shows source "Online orders" and links its entries to the web order.
- **Storefront:** *Checkout* button on the cart page and in the mini-cart (disabled with the reason while the cart is empty or has flagged lines); `/checkout` (one page: contact — prefilled for customers — delivery address with the address book or a new address with division → district selects and "Save this address", delivery methods with ETA and fee or "Free", payment methods with COD shown unavailable for methods without it, order notes, and an order summary recomputed by the server preview 250 ms after each relevant change; guests see "Sign in for faster checkout", or a sign-in prompt when the store requires an account). "Place order" generates one `Idempotency-Key` per attempt and reuses it only when the outcome is open (lost connection, 5xx, still processing); `TOTAL_CHANGED` shows the new totals and asks to confirm again; cart, stock, delivery and payment errors explain what to fix and focus the field. `/order/{number}`: "Thank you" on first view, then the status page (status, bank-transfer instructions with the deadline, lines, totals, address, delivery method, courier and tracking number); a guest's token moves from the URL into `sessionStorage` (replace navigation). After placing the order the cart is empty (guest cart cookie forgotten).
- The shell answers `/checkout` and `/order/{number}` with `noindex`.
- Permissions `web_orders.view`, `web_orders.manage`, `shipping.manage` (Organization Admin and Online Store Manager) and `payment_gateways.manage` (Organization Admin only, ADR-016). Staff `GET /geography/divisions` and `/geography/districts` (any signed-in staff user) for the zone editor.
- Rate limiter `checkout` on preview and placement: `POS_CHECKOUT_RATE_LIMIT` (default 10) per minute per IP and shopper (customer account or guest cart).
- Demo data (`DemoCheckoutSeeder`): zones "Inside Dhaka" (Home delivery 60, free from 2000, COD fee 0, 1–2 days) and "Outside Dhaka" (all other districts: Courier delivery 120, COD fee 20, 3–5 days); cash on delivery and bank transfer enabled (demo instructions, 48-hour hold). No demo orders.
- Tests: 415 backend tests (412 pass, 3 PostgreSQL-only skipped on SQLite) — new `CheckoutTest` (guest COD order, idempotent and scoped replay, customer bank transfer with a saved address, saving the inline address, COD fee/free delivery/tampered totals, partial preview, options, errors, cart issues, no fulfilment store, guest checkout off, insufficient stock rolls back, never oversell with negative stock allowed, shell paths), `WebOrderWorkflowTest` (COD lifecycle with payment, idempotent bank-transfer confirmation, cancel restocks the exact batches once, expiry, permissions, isolation, zones and methods, payment method settings), PostgreSQL-only `CheckoutConcurrencyTest` (two checkouts for the last unit; **not run yet**), `TrustedProxiesTest`; 345 Vitest tests; Playwright: `storefront-checkout.spec.ts` and `web-orders-admin.spec.ts` (mocked; the mocked suite: 49 pass + 2 skipped by design) and the full-stack test `a guest places a cash-on-delivery order; the admin sees it and stock goes down once` (11/11 full-stack on desktop against a fresh seed).

#### Changed
- **Idempotency keys are scoped** (ADR-014): `idempotency_keys` gains `scope` (`user:{id}` for staff — existing rows backfilled — `customer:{account id}` for a signed-in shopper, `cart:{cart token hash}` for a guest), `user_id` becomes nullable and the unique key is `(scope, key)`. Storefront routes use the middleware as `idempotent:shopper`; a guest without a cart gets `422 CART_EMPTY`. Staff behaviour is unchanged.
- `BusinessRuleViolation` takes an optional HTTP status (default 422; `TOTAL_CHANGED` is 409).
- `PaymentLedger::recordSystem()` appends entries that do not pass through a drawer (refuses cash with `CASH_SESSION_REQUIRED`); `PaymentLedger::entriesOf()` lists a document's entries. `PaymentSource::ONLINE_ORDER` / `ONLINE_ORDER_REFUND` (E10); payment methods `cash_on_delivery` and `online_gateway` (E8c).
- Inventory: movement types `online_order` and `online_order_cancel`; `online_order` ignores the branch's `allow_negative_stock`. Stock movements record their author through `StaffActor`.
- Cart: `carts.converted_order_id` (a converted cart keeps its row, loses its lines and is never used again; the one-cart-per-customer index now covers only carts that are not converted); `CartPricer::quote()` returns the counted lines with their `SaleCalculator` amounts for the order snapshot.
- Storefront settings: `guest_checkout_enabled` (default on), in `GET/PATCH /storefront/settings`.
- `UserDirectory::withPermission()` (active users of an organization holding a permission); `CustomerAddressBook::find()`.
- The notification bell opens `data.url` (or the older `data.link`) when it is a same-origin path, so "New online order" opens the order.
- **Trusted proxies:** new `config/trustedproxy.php` reads `TRUSTED_PROXIES` (comma-separated addresses/CIDR, or `*`) for Laravel's `TrustProxies` middleware at runtime (works with `config:cache`). Behind a TLS-terminating proxy it must be set so e-mail links use `https://`, the cart cookie keeps `Secure` and rate limits key on the visitor's IP.
- Vitest: `testTimeout` 20 s and Testing Library `asyncUtilTimeout` 5 s — form-heavy page tests timed out on a loaded machine.

#### Fixed
- The deployment guide's sample `SESSION_DOMAIN=pos.example.com` contradicted its own E7 warning (it drops the session cookie on storefront hosts); the sample now leaves `SESSION_DOMAIN` unset.

### E-commerce E7 — Customer accounts, cart and wishlist (online store track)

#### Added
- **CustomerAccounts module** (ADR-002): online store accounts of customers (`customer_accounts`, 1:1 `customers`) on their own session guard `customer` (provider `customer_accounts`, tenant-scoped: accounts resolve only inside the storefront's organization, so a session of store A is anonymous on store B). Sign-up, sign-in (optional "remember me"), sign-out, e-mail verification, forgotten password, profile (name, Bangladeshi mobile) and password change. Sign-in regenerates the session id; sign-out forgets only the shopper and gets a new CSRF token, so a staff session in the same browser survives. Unknown e-mail, wrong password and disabled accounts give the same `INVALID_CREDENTIALS` answer with equalised hashing time.
- **Registration never links POS customers** (ADR-018): every sign-up creates a new customer record (`CUS-` sequence) and its account; the phone is copied to the customer only when no other customer of the organization uses it.
- **E-mail verification:** queued e-mail with a link to `/account/verify-email?token=` on the shopper's host (random token stored as sha-256, valid 24 hours, a new link replaces the old one); unverified accounts can sign in and shop; the account page shows a banner with "Resend". **Password reset** with its own `customer_password_reset_tokens` table (sha-256, one per e-mail and organization, valid 60 minutes, at most one e-mail a minute per address, identical answers whether or not an account exists); the reset signs the shopper in, marks the e-mail verified and rotates the remember-me token. Changing the e-mail address is not offered yet.
- **Geography module:** global reference tables `geo_divisions` (8) and `geo_districts` (64) with English (2018 government spellings) and Bangla names and BBS geocodes, loaded by the migration from a bundled data file; public `GET /store/geo/divisions` and `/store/geo/districts?division=` (cacheable for a day). No upazila/thana table yet — addresses keep a free-text area.
- **Address book** (Customers module, `customer_addresses`): label, recipient, Bangladeshi mobile (normalized to `01XXXXXXXXX` from `+88`, spaces, dashes — shared `BangladeshMobile`), division and district (the district must be in the division), area, address line, optional 4-digit postcode, default shipping and billing flags. At most 10 per customer (`ADDRESS_LIMIT_REACHED`); the first address becomes the default; exactly one default shipping address while any exist; deleting the default promotes the most recent one. Soft deletes.
- **Cart module:** guest carts by an httpOnly `cart_token` cookie (40 random bytes, SameSite=Lax, Secure on HTTPS, 30 days; only its sha-256 is stored) and one cart per customer. No prices are stored: **every read and every write reprices** through `CartPricer` — live listing, price, compare-at price, availability, stock at the fulfilment store and tax rate from the OnlineCatalog contract (`variantsForCart`), totals from the POS `SaleCalculator` with the organization's tax mode and currency. Lines that are no longer purchasable or out of stock stay in the cart, flagged (`issues`: `unavailable`, `out_of_stock`, `exceeds_stock`), with `line_total` `"0.00"` and left out of the totals; a line above the stock is flagged and counts with the available quantity. Quantities are never changed on read.
- Cart rules: whole units unless the product's unit allows decimals (3 places), at most 999 per line and 50 lines (`CART_FULL`); adding a variant already in the cart increases its line; `VARIANT_NOT_PURCHASABLE`, `OUT_OF_STOCK`, `INSUFFICIENT_STOCK` (`details.max_quantity`, `in_cart`).
- **Guest → customer merge** on sign-in, registration and password reset: guest lines are added to the customer's cart in one transaction (quantities summed and capped at the stock and 999; lines beyond the 50-line limit are dropped), the guest cart is deleted and its cookie forgotten; the response reports `merge: {merged_lines, capped_lines}`. Guest carts expire 30 days after their last change and are deleted by the daily `cart:prune`.
- **Wishlist** (Cart module): signed-in customers on the server (`wishlists`, `wishlist_items`; at most 200 entries, `WISHLIST_FULL`; entries of products that are no longer live are kept but not shown); guests keep theirs in the browser (product id and slug only, ≤ 100) and it is merged with `POST /store/wishlist/merge` after signing in.
- **`storefront.session` middleware:** storefront hosts are not Sanctum-stateful, so the bootstrap, account, cart and wishlist routes run the cookie/session/CSRF stack themselves (EncryptCookies, AddQueuedCookies, StartSession, ValidateCsrfToken) unless Sanctum already made the request stateful. Catalog, CMS and geography routes stay sessionless. The storefront client sends `X-XSRF-TOKEN` and, after a 419, refreshes the cookie with `GET /store/account/me` and retries once.
- Rate limiters `customer-auth` (sign-up, sign-in, forgot/reset password, resend verification, password change: `POS_AUTH_RATE_LIMIT` per e-mail+IP, four times that per IP) and `storefront-write` (cart, wishlist, address, profile writes and e-mail verification: 60/min per IP and 60/min per signed-in customer).
- **Staff:** `GET /customers/{id}` (and create/update/restore) include `online_account` (`null` or e-mail, verified/last sign-in/created times, status) through the Customers contract `CustomerOnlineAccounts`; `PATCH /customer-accounts/{customerId} {status: active|disabled}` (`customers.manage`, audited `customer_account.status_changed`). A disabled account — or an archived or inactive customer — is refused at sign-in and signed out on its next request (401 on signed-in routes; `me` answers `null`). Admin: an **Online store account** card in the customer account sheet (opened from the customers list) with Disable/Enable.
- **Storefront:** sign-in, registration, forgot/reset password and e-mail confirmation pages; account overview with verification banner, profile and password page, address book (add/edit dialog with division → district selects, default, delete with confirmation); account pages need sign-in (`/account/login?next=`; only relative storefront paths are accepted as `next`, against open redirects) and sign-in pages send signed-in shoppers on. Header: sign-in link or *My account* menu with sign-out, wishlist and cart icons with counts; **mini-cart drawer** (lines, quantity steppers, remove, subtotal, *View cart*). Product page and quick view: quantity stepper + *Add to cart* (disabled until a variant is chosen and while it is out of stock; stock errors narrow the stepper) and a wishlist heart; product cards: heart and *Add to cart* for single-variant products, else *Choose options*. Cart page: lines with image, variant, unit and compare-at price, stepper, line total, remove, flags with a one-click "Change quantity to N", totals (VAT line in exclusive mode, "Prices include VAT" in inclusive mode). Wishlist page (server or browser list, cards fetched fresh, single-variant products move to the cart). A notice tells the shopper when merged lines were reduced to the stock. **No checkout button** (E8) and no order history (E9).
- The shell answers `/account`, `/account/login`, `/account/register`, `/account/forgot-password`, `/account/reset-password`, `/account/verify-email`, `/account/profile`, `/account/addresses`, `/cart` and `/wishlist` with `noindex`.
- Demo data: shopper account `shopper@demo.test` / `password` (verified) on the demo store with a home address in Dhaka and the mango juice on the wishlist; no seeded cart.
- Tests: 388 backend tests (386 pass, 2 PostgreSQL-only skipped on SQLite) — new `CustomerAccountTest`, `CustomerSessionTest` (staff and shopper sessions in one browser, session fixation, store isolation, a non-stateful host with CSRF and 419), `AddressBookTest`, `CartTest` (repricing, flags, both tax modes equal to `SaleCalculator`, merge, isolation, rate limit, prune), `WishlistTest`, `CartRulesTest`; 272 Vitest tests; Playwright: `storefront-account-cart.spec.ts` (mocked; the mocked suite: 40 pass + 2 skipped by design) and the full-stack test `a guest cart merges into the shopper account at sign-in and its totals match the server`.

#### Changed
- Product cards add `default_variant_id` (only for products with exactly one active variant, else `null`); the product detail adds `allow_decimal` (the unit allows decimal quantities).
- `GET /store/bootstrap` now starts the storefront session and sets the `XSRF-TOKEN` cookie.
- Middleware priority: `storefront` and `storefront.session` run before authentication, so `auth:customer` looks accounts up inside the host's organization.
- `StorefrontCatalog` gains `variantsForCart()`; OnlineCatalog now also uses Products' `ProductDirectory`.

#### Fixed
- `auth:customer` makes `customer` the request's default guard, so `Auth::id()` could be a shopper's account id. Author columns (`TracksAuthor`) and the audit trail now use `StaffActor::id()`, which counts only staff users.

### E-commerce E6 — Online catalog and product page (online store track)

#### Added
- **OnlineCatalog module:** web listings of products (`product_listings`: address, publish switch with optional window `published_at`/`unpublished_at`, featured, "new until" date, short description, sanitized description, up to 30 specifications, SEO title/description, sort weight; states *draft*, *scheduled*, *live*, *expired*), per-variant web data (`variant_listings`: compare-at price, which must be above the selling price — `COMPARE_AT_NOT_ABOVE_PRICE` — and the product image shown for the variant), category and brand listings (address, visibility, image/banner or logo from the media library, description, SEO) and hand-picked **related** and **frequently bought together** products (≤ 12 each, ordered). Only active products can be published (`PRODUCT_NOT_SELLABLE`). A blank address takes a free suggestion from the name (`mango-juice`, `mango-juice-2`, …); addresses are unique per organization regardless of case.
- **Attribute dictionary** (Catalog module): attributes (name, slug, display *button*/*swatch*/*text*, filterable, order) with ordered values and swatch colours. Product options stay the source of truth; an option is linked to an attribute when the names match case-insensitively, and only linked, filterable attributes become shop filters. The product editor suggests attribute names and shows their known values.
- **Public shop API:** `GET /store/categories[/{slug}]`, `/store/brands[/{slug}]`, `/store/products` (search, category scope incl. subcategories, brands, price range, attributes, in stock, on sale; sorts featured, popularity, latest, price, name; 12/24/36/48 per page; **disjunctive facets with real counts**; `slugs=` mode for recently viewed lists), `/store/products/{slug}` (gallery, options in dictionary order, variants with price, sale, availability and image; staff preview of unpublished listings with `?preview=1`), `/store/products/{slug}/related` (falls back to the newest products of the same category) and `/store/search/suggest`.
- **Availability** from the storefront's new **fulfilment store** (`storefront_settings.fulfilment_store_id`, chosen under *Online store → Settings & domains*; `STORE_NOT_FOUND` for a store that is not an active store of the organization): products that do not track stock are always available; tracked ones need sellable on-hand stock there. Exact quantities are never public — only `in_stock` and `low_stock` (1–5 left).
- **Popularity projection** `product_stats` (net units sold in 30 days and in total from completed POS sales minus completed returns), rebuilt hourly by `storefront:refresh-product-stats` (`RefreshProductStats` job); drives the *popularity* sort and *best sellers* sources.
- **Homepage sections** product carousel, product grid (3–5 columns), product tabs (2–5 tabs), category strip and brand strip. Sources: hand-picked (`item_ids`), featured, new arrivals, best sellers, on sale, a category (with subcategories); strips: hand-picked, top level / all. Sections whose products, categories or brands are all unavailable are not rendered (preview state `empty`).
- **Menus link to categories and brands** (`type: category|brand`, `target_id`); items whose target has no visible listing drop out of the storefront navigation. `GET /storefront/link-targets` adds categories (tree order) and brands with their storefront address.
- **Storefront:** shop, category, brand and search pages (breadcrumbs, category banner and description, subcategory chips, filter sidebar / mobile drawer with counts, price range, swatches, in-stock and on-sale toggles, sort, grid/list view, page size, pagination — all state in the URL), product cards (hover image, sale/new/out-of-stock badges, price ranges, struck-through compare-at price), quick view, header search with keyboard-accessible suggestions, and the product page (gallery with hover zoom and lightbox, variant selector updating price, SKU, availability and image with `?variant=` in the URL, unavailable combinations disabled, "Excl. VAT" in exclusive tax mode, description and specifications tabs, related, frequently bought together, recently viewed). Prices are formatted in the store currency from the bootstrap. The shell answers `/shop`, `/search` (`noindex`) and existing `/category/{slug}`, `/brand/{slug}`, `/product/{slug}` with title, description and `og:image` (`og:type` `product` for products).
- **Admin:** *Online store* section on the product editor (publish and schedule, address with storefront link, featured, new-until, descriptions, specifications, SEO with counters, per-variant compare-at price and image, related and frequently-bought pickers; toast "Online listing saved."), the same form on `/admin/products/{id}/online-store` for online store staff who cannot edit products, *Online store → Categories* and *→ Brands*, *Catalog → Attributes*, the fulfilment store in *Online store → Settings & domains*, editors for the five new section types and category/brand menu items.
- Permissions `online_catalog.view`, `online_catalog.manage` and `attributes.manage` (Online Store Manager role through `online_catalog.*` and `attributes.manage`). The attribute list is readable with `products.view` or `attributes.manage`.
- PostgreSQL: `pg_trgm` extension and a GIN trigram index on `lower(products.name)` for substring search; CHECK constraints on listing windows, related kinds and compare-at prices.
- Demo data: Main store as fulfilment store, two more products (one with low stock), listings for every product for sale (two featured, two with compare-at prices, specifications, generated artwork), visible categories and brands with images, a *Size* attribute, refreshed product stats, three catalog homepage sections (featured carousel, category strip, New arrivals / Best sellers / On sale tabs) and *Shop* plus a *Grocery* mega menu in the main menu.
- Tests: 330 backend tests (328 pass, 2 PostgreSQL-only skipped on SQLite) — new `OnlineCatalogAdminTest`, `StoreCatalogTest`, `StorefrontCatalogIntegrationTest`, `CatalogDomainTest`, `AttributeManagementTest`; 211 Vitest tests; Playwright: `online-catalog-admin.spec.ts` and `storefront-catalog.spec.ts` (mocked, 36 pass + 2 skipped by design) and a full-stack test for brief checks 7–10 (a product created and published in the admin appears in search, listing and product page; repriced in the product editor, the new price shows on the product page, the shop listing, the search suggestions and the homepage carousel).

#### Changed
- `GET /store/bootstrap` adds `store.currency` (organization base currency) and `store.prices_include_tax` (`true` in inclusive tax mode).
- `GET /storefront/homepage-sections[/{id}]` returns `item_ids` and `items` (`{id, name, image_url}`) for hand-picked records; `/types` adds `manual_items` (record type and limits). Duplicating a section copies its hand-picked records.
- The sign-in rate limit is configurable: `POS_AUTH_RATE_LIMIT` (default 5 attempts per minute per account and IP, four times that per IP).
- `CatalogDirectory` gains `categories()`, `brands()` and `attributes()` (inactive records included) for the online catalog's read model.

#### Fixed
- The full-stack menu test counts the existing menu items instead of assuming the seeded main menu has four.

### E-commerce E5 — Content and homepage builder (online store track)

#### Added
- **Homepage builder** (Storefront module): `homepage_sections` + `homepage_section_items` with a typed config per section type (`Domain\SectionType`: defaults, normalization, media references). Types shipped: **hero slider**, **banner grid** (2, 3, 3-split or 4 columns), **text block** (rich text), **features strip** (icon, title, text), **testimonials** (quote, name, role, stars, photo) and **newsletter sign-up**. Sections can be added (go last), edited, duplicated (disabled copy right below), enabled/disabled, scheduled (`starts_at`/`ends_at`), reordered and deleted.
- **Banners** with placements `hero_slider` and `home_promo`: kicker, headline, text, one or two buttons (or the whole banner as link), desktop and mobile image, text colour and position, schedule, active flag, order per placement. Banners shown by a section cannot be deleted or moved to another placement (`IN_USE`, `BANNER_IN_USE`).
- **Public homepage API** `GET /store/homepage`: live sections in order with banners and media resolved; a section whose banners are all inactive or outside their schedule is left out, so empty blocks never render. `?preview=1` from staff of the store with `storefront.view` adds hidden, scheduled, ended and empty sections with their `state`. `ETag` support.
- **Cms module:** content pages (`/pages/{slug}`, layouts *standard*, *FAQ*, *contact*; draft/published with optional publication time; SEO title and description), FAQ entries (topic groups, order, active flag), contact form messages (honeypot, 5 per hour per visitor, handled/open in the admin), newsletter subscribers with **double opt-in** (confirmation e-mail with hashed tokens valid 7 days, one e-mail per address per 10 minutes, identical answers whether or not an address is known, click-to-unsubscribe) and a CSV export of confirmed subscribers.
- **Rich text** sanitized on the server with HTMLPurifier (`ezyang/htmlpurifier` 4.19, ADR-009 whitelist; images only from the media disk) through the new shared `HtmlSanitizer` contract; edited with **TipTap 3.32** in the admin (headings 2–4, emphasis, lists, quote, divider, safe links, images from the media library).
- **Menus link to content pages** (`type: page`, `target_id`): the storefront resolves the address, so renames follow and unpublished pages drop out of the navigation. A page linked from a menu cannot be deleted. `GET /storefront/link-targets` lists the pages for the editor.
- **Storefront:** homepage renderer (accessible hero carousel with optional autoplay that pauses on hover/focus, can be stopped and respects reduced motion; banner grids; text; features; testimonials; newsletter form), content pages with breadcrumb, FAQ accordion and contact form plus the store's contact details, newsletter confirm/unsubscribe pages, staff preview markers. The shell answers 200 with the page's title and description for published pages and `noindex` for the newsletter pages.
- **Admin:** *Online store → Homepage* (builder with type picker, per-type editors, banner chooser, preview link) and *→ Banners*; new *Content* area (`cms.manage`): Pages (list and editor), FAQ, Messages, Newsletter.
- Permission `cms.manage` (in the Online Store Manager role through `cms.*`).
- Demo data: Demo Mart gets About, FAQ, Contact and Privacy pages, four FAQ entries, generated banner artwork, a six-section homepage and menus linking to the pages.
- Tests: 295 backend tests (2 PostgreSQL-only skipped on SQLite) — new `CmsPagesTest`, `ContactAndNewsletterTest`, `HomepageBuilderTest`, `HtmlSanitizerTest`; 139 Vitest tests (20 new); Playwright: homepage sections and content pages (mocked) and a full-stack test for brief checks 1–2 and 5–6 (a banner edited in the admin shows on the storefront; a section added and moved to the top shows first; hidden again, it disappears).

#### Changed
- `PUT /storefront/menus/{id}/items` keeps the items in the order sent even when only some items carry optional keys (Laravel's `validated()` could reorder them).
- Timestamps with an offset (`2026-11-03T00:00:00+06:00`) are moved to the application timezone before Eloquent stores them (`Shared\Application\Support\Instants`), so schedules keep their instant.
- E5 ships the section types whose content and link targets exist. Product, category and brand sections follow with the online catalog (E6), deal countdowns with promotions (E8) and blog teasers with the blog (E11) — no section may link to a page that does not exist yet.

### E-commerce E4 — Storefront shell (online store track)

Plan, decisions and API surface of the e-commerce track: `docs/ecommerce/` (analysis E1, reference investigation E2, ADR-001…017 and API plan E3).

#### Added
- **Storefront module:** storefront settings (open/closed, site name, meta description), domains (host → organization, one primary), theme document (colours, fonts, button style, card radius, content width, sticky header, logo, favicon, scheduled announcement bar, footer about/contact/social/payment logos) normalized by `ThemeSchema`, policy-checked custom CSS, menus per location (`main`, `mobile`, `footer_1`..`footer_3`) with nested items up to three levels and mega menus on the main navigation.
- **Public storefront API:** `GET /api/v1/store/bootstrap` resolved from the request host (`storefront` middleware; unknown host, closed store or suspended organization → `404 STOREFRONT_NOT_FOUND`; staff with `storefront.view` preview a closed store), with `ETag` support and its own rate limiter (300/min per IP).
- **Storefront HTML shell:** every non-API, non-admin path is served by Laravel from the built `storefront.html` with server-written title, description, canonical, Open Graph, favicon and the inlined bootstrap payload; unknown storefront paths answer 404 with `noindex`. Modules can now ship `Presentation/Routes/web.php`.
- **Media module:** image library (JPEG/PNG/WebP/GIF ≤ 5 MB), de-duplication by checksum, WebP renditions 320/640/1280 px by a queued GD job, `srcset` everywhere, alt text, lookup by ids, in-use protection (foreign keys and tagged `MediaReferences` checkers).
- **Storefront app** (`frontend/storefront.html` → `src/storefront/`): announcement bar, header with logo, accent-coloured main navigation with dropdowns and mega menus (hover and keyboard), sticky header, mobile drawer, footer with menus/contact/social/payment logos, preview ribbon, home page with the store's name and description, not-found page; theme applied as CSS variables; Baloo 2 and Poppins self-hosted.
- **Admin screens:** *Online store* (`/admin/storefront`: settings and domains, theme with WCAG contrast checks, menus with a tree editor) and *Media library* (`/admin/media`, upload by drag and drop, alt text, delete), with read-only views for `storefront.view` without `storefront.manage`.
- Permissions `storefront.view`, `storefront.manage`, `storefront.custom_css`, `media.manage`; new built-in role **Online Store Manager** (custom CSS stays with the Organization Admin).
- Demo data: Demo Mart's storefront open on `STOREFRONT_DEFAULT_HOST` (default `shop.localhost`) with a main and a footer menu.
- Tests: 275 backend tests (2 PostgreSQL-only skipped on SQLite) — new `MediaLibraryTest`, `StorefrontAdminTest`, `StorefrontPublicTest`, `StorefrontRulesTest`; 119 Vitest tests (32 new: theme mapping, navigation, footer, menu tree operations, contrast, schedule conversion, settings/theme/menu pages); Playwright `storefront.spec.ts` and `storefront-admin.spec.ts` (mocked) and a full-stack test where a theme colour and a menu changed in the admin appear on the storefront.

#### Changed
- **The back office moved to `/admin`** (React Router `basename`; password-reset links now point to `/admin/reset-password`). The storefront owns `/`. The Vite dev server serves both (`/admin/*` → `index.html`, other pages → `storefront.html`); production routing is in `DEPLOYMENT_GUIDE.md`.
- `VITE_BACKEND_ORIGIN` from the shell now overrides `frontend/.env.local`; Playwright honours `E2E_PORT` (own dev server when 5173 is busy); the API rate limit is configurable (`POS_API_RATE_LIMIT`, default 120/min).

### Phase 6 — Payments, returns, refunds, cash registers, expenses, loyalty

#### Added
- **Payments module:** organization-wide payments ledger (`payments`, append-only) fed by every module through the `PaymentLedger` contract; cash registers per branch; register sessions (`SES-{BRANCH}-000001`) with opening float, cash in/out, closing count, expected cash and variance; X/Z session reports (cash reconciliation, totals per method and per kind of transaction); payment history with totals.
- **Sales returns and refunds:** returns against the original invoice (`RET-{BRANCH}-000001`) with an approval workflow (pending → completed/rejected; approvers' own returns complete at once), return reasons with a default restocking rule, per-line restock or write-off, restock to the exact batches sold from at their cost, serial numbers released, values from the invoice line (discounts and tax included, exact remainder on the last return), settlement against what the customer still owes before refunding, refunds by method (card/mobile/points capped at what was paid that way), preview endpoint.
- **Receivables:** customer payments (`RCP-000001`, capped at the balance) and customer statements with running balance; balances now subtract return credits and payments.
- **Expenses module:** expense and income categories, expenses and other income (`EXP-` / `INC-`), voiding with a reversing payment.
- **Loyalty module:** program settings (points per spend, point value, minimum redemption), point accounts and an append-only points ledger; points earned at checkout, redeemed as the `loyalty_points` payment method, reversed on cancellation and returns, manual adjustments. Plugs into Sales through the Sales-owned `LoyaltyProgram` contract.
- Permissions: `payments.view`, `payments.collect`, `cash_registers.view|operate|manage`, `returns.view|create|approve|manage`, `expenses.view|manage`, `loyalty.view|manage` (Cashier: operate registers, request returns, collect payments).
- Demo data: two registers, the cashier's open shift, return reasons, expense categories, an enabled loyalty program, a customer payment and an expense.
- Frontend:
  - **Cash registers** (`/cash-registers`): registers per branch with their open session, add/edit (managers), open a session with a counted float; session list with variance badges; X/Z report page (cash reconciliation, by method, by transaction type, entries) with cash in/out and close-with-count (live variance preview).
  - **POS terminal:** register-session bar (number, expected cash, cash in/out, close); without a session the till asks to open one before taking payment; loyalty points as a payment method for the selected customer (whole points, minimum redemption, “Use points” fills the affordable amount).
  - **Returns** (`/returns`): “Return items” on the invoice → per-line quantities or serials, restock switch defaulting from the reason, server preview of value and settlement (credit against the balance, refund due), refund split over the methods the invoice allows (card/mobile/points capped, rest in cash); approvers complete at once, others send for approval; return document with approve (refunds) / reject; return reasons tab. The invoice lists its returns and hides “Cancel sale” once it has any.
  - **Payments** (`/payments`): payments ledger with period, direction, method and type filters, totals, links to sales, returns and sessions; customer payments list.
  - **Customers:** account sheet per customer — running statement with “Receive payment”, loyalty points with history and manual adjustment; points column.
  - **Expenses** (`/expenses`): expenses and other income with period/category filters, totals by category, new entry (cash through the caller's session), void; categories tab.
  - **Loyalty** (`/loyalty`): program rules with a worked example.
  - Every money-moving mutation (checkout, cancellation, return, collection, expense) refreshes the ledger, register sessions, customer accounts and points.
- Tests: 240 backend tests (2 PostgreSQL-only skipped on SQLite) — new `CashRegisterTest`, `SaleReturnTest`, `CustomerPaymentTest`, `ExpenseTest`, `LoyaltyTest`, `ReturnShareTest`, `PointsRuleTest`; 87 Vitest tests (new: refunds and points arithmetic, partial return with immediate card refund, return sent for approval, approval with credit and cash refund, till asks for a register session, X→Z report close with variance, expense blocked without a session then paid by bank); 6 Playwright smoke tests; 6 full-stack Playwright tests (new: a cashier requests a return, the owner tops up the drawer and approves it with a cash refund out of the shift).

#### Changed
- **Every POS checkout needs the cashier's open register session** in the store's branch (`CASH_SESSION_REQUIRED`); cash refunds, cancellations, collections and expenses go through the user's drawer and cannot take it below zero (`INSUFFICIENT_CASH`).
- Cancelling a sale writes ledger reversals, reverses loyalty points, and is refused once the sale has returns (`SALE_HAS_RETURNS`).
- The sale document lists its returns and per-line returned quantities.
- `Idempotency-Key` is now also required on returns, return approvals, customer payments, expenses and cash movements.

### UI theme refresh

#### Changed
- New visual theme for the SPA, light and dark: purple top bar with brand and branch switcher over a fixed white icon sidebar (uppercase entries, highlighted active icon), grey page canvas, flat cards with hairline shadow and uppercase titles, tinted table headers, soft status badges (Active/Completed/Received in green, partially received and low stock in amber, in transit in cyan), Plus Jakarta Sans font (replaces Geist).
- Sales summary cards show the value in the primary colour with a round icon.
- Sign-in pages use the same top bar and canvas.

### Phase 5 — POS terminal and sales processing

#### Added
- **Sales module:** immutable sale invoices numbered per branch (`INV-{BRANCH}-000001`, prefix from organization settings) with product snapshots, cost of goods, batch allocations, serial numbers and payments; `SaleCalculator` (item and invoice discounts as percent or amount, exact allocation of invoice discounts, tax-inclusive and tax-exclusive pricing with per-line rounding); `PaymentSettlement` (split payments, change from cash only, partial payments leaving a due); customer credit limits under a per-customer lock; discount rules (`sales.discount`, product max. discount %, automatic customer group discount); cancellation (restock to the exact batches, negative payment reversals, serials released, audited); sales history with filters; daily sales summary with payments by method; customer balances.
- **POS module:** product grid with stock of the selling store, barcode/SKU lookup, live server pricing of the cart, held (parked) carts per branch, idempotent checkout that also consumes a resumed held cart.
- **Shared idempotency:** `idempotent` route middleware and `idempotency_keys` table (replay of successful responses, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `IDEMPOTENCY_KEY_REQUIRED`), pruned daily by the scheduler.
- Inventory: first-expiry-first-out batch allocation inside the stock ledger (expired batches are never sold), `StockLevels` contract for availability, movement type `sale_cancellation`.
- Directories: `CustomerDirectory` (Customers), `CatalogDirectory::categoryWithDescendants`, `ProductDirectory::sellablePage` and `max_discount_percent`, `BranchDirectory::profile` and store `branch_code`, `OrganizationDirectory` document settings, `UserDirectory::names`.
- Permissions: `pos.sell`, `sales.view`, `sales.discount`, `sales.credit`, `sales.cancel` (Cashier: `pos.*`, `sales.view`; Branch Manager: `pos.*`, `sales.*`).
- Demo sales seeder (a walk-in cash sale with change and a wholesale customer on account).
- Frontend: POS terminal (scan field, categories and product grid with stock, cart with quantity steppers, line and invoice discounts, serial capture, customer picker with credit position, held sales, recent sales, payment dialog with split/partial payments and change, receipt preview and printing for 58 mm / 80 mm thermal and A4, shortcuts F2/F4/F8/F9, cart persisted per branch, idempotency key reused on retry), Sales pages (daily summary, history, invoice detail with receipt and cancellation), customer balances on the Customers page.
- Tests: 217 backend tests (2 PostgreSQL-only skipped on SQLite); 74 Vitest tests; 6 Playwright smoke tests; 5 full-stack Playwright tests (new: a cashier scans, takes cash and the sale reaches stock and history).

#### Changed
- Users land on the POS terminal when they may sell (first navigation entry), otherwise on the first page their role may open.
- The stock ledger reports per-batch allocations for every change.

### Phase 4 — Purchasing and inventory

#### Added
- **Inventory module:** `StockLedger` as the single write path for stock — row-locked `stock_levels` projection (deterministic lock order, insert-if-missing then `FOR UPDATE`, availability checked after the lock), append-only `stock_movements` ledger with `balance_after` (PostgreSQL trigger + model guard), weighted average cost at 4 decimals, per-branch negative-stock setting (`INSUFFICIENT_STOCK` otherwise), batches with expiry (`BATCH_EXPIRY_MISMATCH`), untracked products and services skipped.
- Stock adjustments (`ADJ-`; opening, count, damage, expiry, theft, correction, other — with sign rules per reason), two-step stock transfers between any active stores (`TRF-`; dispatch at source average cost, receive or cancel), stock list with low-stock filter, batch/expiry list, movement history, valuation (cost-gated).
- **Purchasing module:** purchase orders (`PO-`; draft → ordered → partially received → received, cancel), goods receipts that are the supplier invoice (`GRN-`; stock in + payable in one transaction, against an order or standalone, open-quantity cap, duplicate supplier-invoice guard, due date from payment terms), purchase returns limited to the returnable quantity at original cost and batch (`PRN-`), supplier payments (`SPAY-`), supplier balances and running statements computed from documents. All totals computed server-side with `Money`/`Decimal`.
- **Notifications module:** in-app inbox (`/notifications`, unread count, mark read / all read). First notification: low stock — `StockFellBelowReorderLevel` is dispatched after commit and a queued listener notifies users with `inventory.view` for the branch.
- Shared: `Decimal` helper (BCMath, fixed scales) and `Money::ofProduct()`; directory contracts `ProductDirectory`, `UserDirectory`, `BatchDirectory`; `BranchDirectory::store()/storeSummaries()`; `TenantUnique::withMessage()`.
- Demo stock seeder (opening stock, an open purchase order, a posted receipt).
- Frontend: Inventory area (Stock with low-stock filter, Batches & expiry, Movements, Adjustments, Transfers with receive/cancel), Purchasing area (orders with draft/place/cancel, receive goods against an order with open quantities pre-filled, receipts with returns, purchase returns, supplier payments), supplier balances and statement sheet on the Suppliers page, notification bell, reusable product-lines editor (product search/scan picker, batch picker, signed quantities), exact decimal comparison/subtraction (`compareDecimal`, `subtractDecimal`) so quantities never touch floats.
- Tests: 179 backend tests (2 PostgreSQL-only lock tests skipped until PostgreSQL is configured); 63 Vitest tests; 6 Playwright smoke tests; 4 full-stack Playwright tests (new: receiving a purchase order moves stock 60 → 156 and the supplier balance).

#### Changed
- Accountant role gains `purchases.pay` (supplier payments).
- Suppliers page shows the balance owed (with `purchases.view`) instead of the opening balance.
- Mobile header: brand hidden below `sm` and branch switcher narrower so the notification bell, theme and account buttons stay reachable.

#### Deferred
- Serial-number capture (products can already be flagged `track_serials`): with the POS in Phase 5, where serials are scanned at sale time.

### Phase 3 — Products, catalog, suppliers and customers

#### Added
- **Catalog module:** categories (tree, max 4 levels, cycle protection), brands, units of measure with one-level conversion (box = 12 pcs), tax rates; case-insensitive uniqueness per organization; deletion refused with `IN_USE` while referenced.
- **Products module:** products with variants (options x values matrix), SKUs (auto-numbered when blank), multiple barcodes per variant with GS1 check-digit validation, purchase/selling/wholesale prices as NUMERIC, reorder level, max item discount, stock/batch/serial tracking flags, services, images (JPEG/PNG/WebP, random names, max 8), archive/restore, barcode/SKU lookup for the till, search by name/SKU/barcode. Price changes are audited with before/after values. Cost prices only for `products.view_cost`.
- **Suppliers module:** supplier master data with auto codes, payment terms, opening balance, archive/restore.
- **Customers module:** customers with auto codes, normalised unique phone numbers, groups with default discount, credit limit and opening balance (only with `customers.manage`; cashiers can register customers at the till), archive/restore with phone-conflict detection.
- Shared: `SequenceGenerator` (gap-free per-organization numbers), `TenantUnique` validation rule, `ReferentialIntegrity` helper, `409 CONFLICT` for unique-index races, paginated responses with per-item presenters.
- Demo catalogue seeder.
- Frontend: Products list (search incl. barcode scan, category filter, archived view with restore), product editor (details, stock tracking, variant generator, per-variant prices/barcodes, nested server errors, images), Catalog page (category tree, brands, units, tax rates), Suppliers and Customers pages (incl. customer groups), exact decimal-string money formatting, multipart uploads, route-level code splitting (main bundle 847 kB to 533 kB).
- Tests: 148 backend tests; 44 Vitest tests; 6 Playwright smoke tests; 3 full-stack Playwright tests (now including product creation and cost-price hiding).

#### Changed
- Accountant role gains product (incl. cost) visibility and tax-rate management; Cashier gains product view and customer registration.
- Users land on the first page their role may open (Products for most roles).

### Phase 2 — Authentication, authorization, organizations and branches

#### Added
- **Organizations module:** organizations (tenants) with profile, timezone, tax mode (inclusive/exclusive), receipt settings and immutable base currency; one-transaction provisioning (organization → main branch + main store → built-in roles → first admin); `tenant` middleware resolving organization and `X-Branch-Id`, rejecting inactive users and suspended organizations on every request; platform-admin API to list, provision, suspend and reactivate organizations.
- **Branches module:** branches with trading flags (`allow_negative_stock`), stores/warehouses per branch, `BranchDirectory` contract; guard against deactivating the last active branch.
- **Users module:** UUID users, organization-scoped roles, code-declared permission catalog (`PermissionRegistry`, `pos:permissions:sync`), five built-in roles defined by permission patterns, custom roles, branch membership; guards against self lock-out, losing the last active Organization Admin, and privilege escalation (no granting permissions you lack, no editing more powerful users).
- **Authentication module:** Sanctum SPA cookie login, device tokens with expiry, self-service sign-up, password forgot/reset (links to the SPA) and change, logout per credential, login activity for every attempt, `auth` rate limiter, enumeration-resistant failures.
- **Audit module:** append-only `audit_logs` with before/after diffs, secret redaction, request id and IP; audit and login-activity APIs.
- Shared kernel: `TenantContext`, `BelongsToOrganization` (tenant scope + stamping), `TracksAuthor`, `AuditTrail` and `TenantUser` contracts, `ListQuery` (search/sort/pagination), `Changes` diff helper.
- Development seeder (platform admin, demo organization admin and cashier).
- Frontend: session bootstrap via `/auth/me`, route guards (auth, guest, permission, platform), sign-in / sign-up / forgot / reset pages, branch switcher sending `X-Branch-Id`, permission-filtered navigation, account menu; pages for Branches (+ stores), Users, Roles & permissions, Organization settings, Audit log, Profile & security (password, devices, sign-in history) and platform Organizations.
- Tests: 98 backend tests (incl. tenant isolation, RBAC, lock-out guards, auth flows); 26 Vitest tests; 6 Playwright smoke tests; opt-in full-stack Playwright spec against a real backend.

#### Changed
- `ResolveTenant` runs before route-model binding (middleware priority) so bound models are tenant-scoped.
- Users table moved into the Users module and switched to UUID primary keys; Sanctum tokens use UUID morphs.
- `.env.example`: `POS_*` settings.

#### Fixed
- Frontend no longer issues requests with a stale `X-Branch-Id` from a previous session; rendering waits until the active branch is valid.

### Phase 1 — Project setup and architecture

#### Added
- Backend: Laravel 13 on PHP 8.4 with Sanctum 4, Scramble (OpenAPI at `/docs/api`), Predis.
- Backend: modular monolith skeleton under `app/Modules` with an auto-wiring `ModuleServiceProvider` (module routes under `/api/v1`, module migrations).
- Backend shared kernel: `Money` value object on `BCMath\Number` (no floats, half-away-from-zero rounding, loss-free allocation), `BusinessRuleViolation`, unified `ApiResponse` envelope, `ApiExceptionRenderer`, `AssignRequestId` middleware (`X-Request-Id` on responses, logs and jobs).
- Backend: `GET /api/v1/health` reporting database and cache status (200/503) without leaking error details.
- Backend: API rate limiter (120/min per user or IP), Eloquent strict mode outside production.
- Backend: `Modules` PHPUnit suite; tests target PostgreSQL `pos_test`.
- Database: `database/scripts/create_local_databases.sql` to create role `pos_app` and databases `pos`, `pos_test`.
- Frontend: React 19 + Vite 8 + TypeScript 7 (strict, `noUncheckedIndexedAccess`), Tailwind CSS 4, shadcn/ui (Radix, Nova preset), React Router 8, TanStack Query 5, Zustand 5.
- Frontend: typed API client for the envelope (`ApiError` with codes/field errors, XSRF + idempotency headers), query client defaults, app shell with responsive sidebar, light/dark/system theme, loading/error/empty state components, system status page.
- Frontend tests: Vitest + Testing Library (12 tests), Playwright smoke specs on desktop and mobile viewports (6 tests).
- Documentation: README, ARCHITECTURE, MODULE_STRUCTURE, DATABASE_DESIGN, API_DOCUMENTATION, DEVELOPMENT_GUIDE, TESTING_GUIDE, DEPLOYMENT_GUIDE, AI_INTEGRATION, CHANGELOG.

#### Changed
- `.env.example` defaults to PostgreSQL, Predis and Sanctum SPA stateful domains.
