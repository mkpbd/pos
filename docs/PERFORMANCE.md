# Performance on production-sized data (G1c)

`EXPLAIN (ANALYZE, BUFFERS)` of the heavy read paths on a database the size of a busy multi-branch shop after two years, what was fixed, and what is still over target. The tools stay in the code base, so the check can be repeated after every larger change.

## 1. Tools

| Command | What it does |
|---------|--------------|
| `php artisan pos:perf:seed [--scale=1] [--small=3]` | Development / testing only (refuses `APP_ENV=production`). Bulk-loads one large organization (*Perf Mart*, slug `perf-mart`) and `--small` small ones (scale / 100, so tenant filters have rows to skip) with `INSERT … SELECT generate_series` and PostgreSQL 18 `uuidv7(shift)` keys (time-ordered like the application's UUIDv7). Organizations, branches and their default stores come from the real provisioning actions; everything else is SQL that satisfies every CHECK, foreign key and append-only trigger. Refuses to run twice (run `migrate:fresh --seed` first). Ends with `VACUUM (ANALYZE)` and `storefront:refresh-product-stats`. Sign in as `perf-owner@perf.test` / `password` (all branches) or `perf-manager@perf.test` (Branch Manager of branch B1). |
| `php artisan pos:perf:explain [--only=…] [--runs=3] [--threshold=20] [--plans] [--json]` | Development only. Sends each scenario as a real `GET` through the HTTP kernel in process (every middleware, Sanctum user, tenant and branch scope, storefront host), with the cache store switched to an in-memory store that is emptied before every run (all numbers are **cache misses**; AI off; stored AI insights of the organization deleted before each insight run). One warm-up run, then the median of `--runs` (requests slower than 5 s: one run). The SQL of the last run is captured with `DB::listen`; statements of at least `--threshold` ms get `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with the bindings they ran with: execution and planning time, top node, sequential scans that read ≥ 5 000 rows, the worst row-estimate error, buffers; repeated statements (N+1 shapes, ≥ 5×) are listed. `--plans` prints the text plans. |

Scenarios (`System/Infrastructure/Performance/PerfScenarios.php`): dashboard (today, 30 days, branch manager), the sales, P&L, tax, sales by product / category / customer and monthly reports for the last 30 days and 12 months, inventory valuation, low stock, `GET /sales` (plain, filtered, by customer, number search), `GET /inventory/stock` (store, search, low stock), POS catalog / search / barcode and SKU lookup, product search, storefront listing (all, department, aisle, facets + sort, search, suggest), web orders (list, status, number and phone search), customers (list, name and phone search), audit log, AI insights (daily, monthly, customers) and reorder suggestions. Parameters are realistic: the best-selling variant's barcode, a regular customer, the branch-1 store, a department of ~3 000 live products.

## 2. Data and machine

| Table (large organization) | Rows |
|---|---|
| branches / stores | 5 / 10 (a store and a warehouse per branch) |
| products / variants / barcodes | 50 000 / 80 000 / 80 000 (60 % listed online: 30 000 live products) |
| customers / customer accounts | 200 000 / 50 000 |
| sales / sale lines | 600 000 / 2 000 000 over two years (1 % cancelled, 0.5 % returned, 40 % with a customer) |
| web orders / lines / addresses | 150 000 / 375 000 / 150 000 |
| stock levels / stock movements | 500 000 / 3 000 000 |
| payments ledger | 734 513 |
| purchase orders / lines, supplier products | 5 000 / 50 000, 40 000 |
| audit log / sign-ins | 500 000 / 60 000 |

Plus three small organizations (500 products, 6 000 sales, 1 500 web orders each) and the demo organization.

Seed time at `--scale=1`: **6 min 45 s** (sales and web orders 255 s, stock levels and opening movements 49 s, customers 13 s, `VACUUM (ANALYZE)` 11 s, product stats 23 s). Database size after the seed: 4.3 GB.

Machine: Windows 11 development box, AMD Ryzen 7 7700X (8 cores), 64 GB RAM, SSD; PostgreSQL 18.1 with **default settings** (`shared_buffers` 128 MB, `work_mem` 4 MB, `random_page_cost` 4, 2 parallel workers per gather); PHP 8.4 CLI (no OPcache). Other agents ran test suites on the same machine during some measurements, so single numbers vary by ±30 %; EXPLAIN execution times are the steadier signal. A tuned production server (§7) should be faster on the SQL side, not on the PHP side.

## 3. Results

Server time = wall time of the request in the kernel (median), cache miss. Targets: API reads < 300 ms, dashboard < 1 s.

| Request | Before | After | Queries | Target |
|---|---:|---:|---:|---|
| `dashboard.today` | 2.8 s | 2.0 s | 62 → 62 | over |
| `dashboard.30d` | 2.7 s | 2.0 s | 62 → 62 | over |
| `dashboard.30d.branch_manager` | 1.1 s | 1.0 s | 54 → 54 | over |
| `report.sales_daily.30d` | 459 ms | 233 ms | 24 → 24 | met |
| `report.sales_daily.12m` | 1.9 s | 2.2 s | 24 → 24 | over |
| `report.profit_and_loss.30d` | 451 ms | 205 ms | 28 → 28 | met |
| `report.profit_and_loss.12m` | 1.4 s | 1.8 s | 28 → 28 | over |
| `report.tax.30d` | 196 ms | 133 ms | 20 → 20 | met |
| `report.tax.12m` | 1.0 s | 1.1 s | 20 → 23 | over |
| `report.sales_by_product.30d` | 2.3 s | 2.2 s | 25 → 28 | over |
| `report.sales_by_product.12m` | 4.8 s | 5.2 s | 25 → 29 | over |
| `report.sales_by_category.30d` | 461 ms | 354 ms | 23 → 23 | over |
| `report.sales_by_category.12m` | 1.9 s | 2.2 s | 23 → 23 | over |
| `report.sales_by_customer.30d` | 1.1 s | 744 ms | 85 → 20 | over |
| `report.sales_by_customer.12m` | 8.4 s | 7.4 s | 550 → 28 | over |
| `report.sales_monthly.12m` | 2.3 s | 2.1 s | 24 → 24 | over |
| `report.sales_daily.12m.branch_manager` | 2.0 s | 958 ms | 25 → 25 | over |
| `report.inventory_valuation` | 1.3 s | 578 ms | 15 → 15 | over |
| `report.low_stock` | **HTTP 500** | 22.7 s | 22 → 1446 | over |
| `sales.list` | 106 ms | 43 ms | 16 → 16 | met |
| `sales.list.filtered` | 11 ms | 13 ms | 16 → 16 | met |
| `sales.list.customer` | 9 ms | 13 ms | 16 → 16 | met |
| `sales.list.search` | 172 ms | 30 ms | 16 → 16 | met |
| `inventory.stock` | 80 ms | 90 ms | 18 → 18 | met |
| `inventory.stock.search` | 40 ms | 45 ms | 19 → 19 | met |
| `inventory.stock.low` | 167 ms | 184 ms | 18 → 18 | met |
| `pos.catalog` | 137 ms | 254 ms | 19 → 19 | met |
| `pos.catalog.search` | 169 ms | 219 ms | 19 → 19 | met |
| `pos.lookup.barcode` | 8 ms | 10 ms | 20 → 20 | met |
| `pos.lookup.sku` | 8 ms | 9 ms | 20 → 20 | met |
| `products.list.search` | 75 ms | 82 ms | 19 → 19 | met |
| `store.products.all` | 7.1 s | 10.2 s | 421 → 421 | over |
| `store.products.department` | 583 ms | 809 ms | 59 → 59 | over |
| `store.products.aisle` | 99 ms | 136 ms | 32 → 32 | met |
| `store.products.facets` | 593 ms | 775 ms | 59 → 59 | over |
| `store.products.search` | 273 ms | 333 ms | 31 → 31 | over |
| `store.search.suggest` | 203 ms | 262 ms | 31 → 31 | met |
| `web_orders.list` | 219 ms | 128 ms | 17 → 17 | met |
| `web_orders.status` | 85 ms | 173 ms | 17 → 17 | met |
| `web_orders.search` | 419 ms | 18 ms | 17 → 17 | met |
| `web_orders.search.phone` | 235 ms | 51 ms | 17 → 17 | met |
| `customers.list` | 39 ms | 41 ms | 12 → 12 | met |
| `customers.search.name` | 226 ms | 165 ms | 13 → 13 | met |
| `customers.search.phone` | 95 ms | 32 ms | 12 → 12 | met |
| `audit.list` | 36 ms | 44 ms | 12 → 12 | met |
| `audit.filtered` | 7 ms | 11 ms | 12 → 12 | met |
| `ai.insights.daily` | **HTTP 500** | 57.5 s | 51 → 2945 | over |
| `ai.insights.monthly` | **HTTP 500** | 62.9 s | 50 → 2949 | over |
| `ai.customer_insights` | 10.6 s | 12.0 s | 727 → 207 | over |
| `purchasing.reorder` | **HTTP 500** | 4.4 s | 18 → 301 | over |
| `purchasing.reorder.search` | **HTTP 500** | 1.8 s | 18 → 64 | over |

Before = the first run (2026-11-24 morning), after = the final code (dashboard and sales list re-measured after the last index). Paths that were **HTTP 500** failed on PostgreSQL’s parameter limit (§4); their “after” is the first working number. The storefront rows did not change code; their after numbers were taken while other agents ran test suites on the machine (CPU at 100 %), which is also why some small paths show a few ms more. Key EXPLAIN execution times (steadier): POS lines of one day 130 ms → 2 ms, of 30 days 130 → 65–90 ms, of 12 months 1.1 s → 0.8 s; web-order search 80 ms → 4 ms; newest sales 230 ms → < 1 ms.

## 4. What changed

**Indexes** (new migrations in the owning modules, PostgreSQL only, built `CREATE INDEX CONCURRENTLY` through `Shared\Infrastructure\Persistence\ConcurrentIndex`, migrations with `$withinTransaction = false`):

| Index | Module | Serves | Build time here |
|---|---|---|---|
| `sale_lines_sale_id_facts_index` — `sale_lines (sale_id) INCLUDE (variant_id, quantity, discount_amount, invoice_discount_share, net_amount, tax_rate, tax_amount, cost_total)` (≈ 190 MB) | Sales | `SalesFacts` POS lines: with only `(sale_id, position)` PostgreSQL hash-joined a **full scan of all 2 M lines** even for one day; now an index-only nested loop (the table is append-only, so the visibility map stays set). Today's totals 130 ms → 2 ms, 30 days 130 ms → 70 ms per query. | 1 s (2 M rows) |
| `order_lines_order_id_facts_index` — `order_lines (order_id) INCLUDE (product_id, quantity, discount_amount, net_amount, tax_rate, tax_amount, cost_total)` | Orders | the web side of the same facts | 0.3 s |
| `orders_{number,contact_name,contact_phone,contact_email}_trgm_index` (GIN `gin_trgm_ops`, 21 MB) | Orders | staff web-order search (`ILIKE '%…%'` on four columns, run three times per request): 80 ms scan → 4 ms BitmapOr | 1 s |
| `customers_{code,name,phone,email}_trgm_index` | Customers | customer list search (also used to attach a customer at the till) | 2 s |
| `sales_number_trgm_index` | Sales | sales list invoice-number search | 1 s |
| `sales_org_sold_at_id_index` — `sales (organization_id, sold_at, id)` | Sales | newest sales of the organization: dashboard *recent transactions* and the sales list default order (`sold_at DESC, id DESC`) sorted all 600 000 sales (230 ms); now a backward index scan that stops after a page | 0.6 s |

`PerformanceIndexesTest` (PostgreSQL) asserts all twelve exist, are valid and have these definitions.

**Bug found at this volume — PostgreSQL's 65 535 bound-parameter limit.** Several queries put *every* variant / product / customer of a store or report into one `whereIn`; with ~80 000 variants per store they failed with `SQLSTATE[HY000] … number of parameters must be between 0 and 65535` → HTTP 500 on reorder suggestions, the low-stock report and both AI business-insight endpoints (and the daily reorder alert job, which uses the same code). Fixed with `Shared\Infrastructure\Persistence\WhereInChunks` (chunks of 10 000; same rows) in `EloquentReplenishmentData::storeInputs`, `EloquentProductDirectory::variants`, `ReorderSuggestions` (preferred catalog, open order quantities, last purchase costs), `SalesByProductReport` (products), `LowStockReport` (variants) and `CustomerDuesReport` (customers). `WhereInChunksTest` runs a 70 001-value list on PostgreSQL.

**Query shapes (results unchanged; the full suite proves it):**
- `LowStock::rows` (dashboard low-stock count, low-stock report): a `WHERE` keeps only levels that can have a reorder point (an active rule above zero, or no rule and a variant reorder level). The `HAVING` already dropped every other group, so the aggregate now sees a third of the rows (450 ms → 210 ms).
- `ReorderSuggestions::forStore`: the decision over every variant of the store uses `ProductDirectory::stockFlags()` (new: track stock / sellable / decimal unit from plain rows, the same rules as `variants()`); full descriptions are loaded only for the variants that get a row. One store with ~42 000 stocked variants: 7.6 s → 3.3 s.
- `SalesByCustomerReport::lastPurchases`: for more than 500 customers, one grouped query per channel over the period (kept customers filtered in PHP) instead of two queries per 500 customers (550 → 27 queries for 12 months).
- `ReportRunner::sortRows`: each row's sort value is prepared once, not on every comparison (~800 000 comparisons for a year of products).
- `Dashboard::topProducts`: the ten best in one pass instead of sorting every product sold in the range.
- `Names::of` and the customer report's name lookup use chunks of 10 000 instead of 500.

## 5. Still over target, and proposals

| Path | After | Where the time goes | Proposal |
|---|---|---|---|
| Twelve-month sales / P&L / tax / monthly / category reports | 1.1–2.2 s | Summing ~1 000 000 lines (`COUNT(DISTINCT s.id)` needs a sort) — 0.8–1 s per channel query even index-only; the P&L runs it for two periods. | A **daily summary table** `sales_daily_facts` (organization, branch, store, local day, channel, tax rate, cashier → docs, quantities, discounts, net, tax, cost, returns, delivery), appended in the same transactions as checkout, return, delivery and refund, with a one-off backfill; reports without product / category / customer dimensions read it (≈ 50 000 rows for two years instead of 2 400 000 lines). Product-level reports keep reading lines. Not built: it duplicates the sales definition and needs its own reconciliation tests — a phase of its own. |
| Sales by product / category / customer (12 months), dashboard top products | 0.75–7.4 s, dashboard 2.0 s | PHP: `SalesFacts::aggregate` merges the four sources per group with exact decimals (88 000 customers or 50 000 products per year ≈ 1.5 M decimal operations), then every row is presented and sorted. | Merge in SQL (`UNION ALL` of the four sources, `GROUP BY` the dimensions, `ROUND` like `finish()`), page and sort in SQL, and a `LIMIT 10` query for the dashboard's top products. Same numbers (PostgreSQL NUMERIC is exact; `ROUND` is half away from zero). |
| Dashboard | 2.0 s (today, 30 days), branch manager 1.0 s | 4 × period totals, trend, top products (above) and the low-stock count (220 ms: every stock level of the organization). Cached 60 s per scope. | The two items above; a partial index cannot serve the low-stock `HAVING` — a `stock_levels.below_reorder` flag maintained by the ledger would. |
| Low-stock report | 22.7 s (was HTTP 500) | Runs the SC1 reorder suggestions for every store with low items (5 × 3–4 s), PHP over ~40 000 variants per store. | Compute the reorder candidates in SQL (on hand + on order + in transit ≤ reorder point from the 30-day velocity) and run `ReorderCalculator` only for them; give the report its own page size. |
| Reorder suggestions | 1.8–4.4 s (was HTTP 500) | Same per store: ~0.9 s inputs (stock, 30-day movements, levels), ~1.5 s calculator over 42 000 variants, ~1 s preferred-supplier models. | As above; plain rows instead of `SupplierProduct` models. |
| AI business insights (daily / monthly) | 57–63 s (was HTTP 500) | Shortage risk runs the reorder suggestions of all 10 stores; plus slow movers (inventory valuation by product + a 30-day product report) and top movers. | Closed periods are stored in `ai_insights` and computed by the 07:30 `ai:daily-insights` job, so readers normally get the stored row; the job's cost grows with stores × variants. Limit shortage risk to the SQL candidates above, or reuse the job's reorder run. |
| AI customer insights | 12 s | The 12-month customer report (above) plus RFM scoring of 88 000 customers in PHP. Cached 1 h. | The SQL merge above; compute R/F/M quintiles with `ntile()` in SQL. |
| Storefront listing of a large category / the whole shop | 0.8 s (3 000 products) – 10 s (30 000) | In-PHP filtering (§6). | §6. |
| Inventory valuation | 0.58 s | Aggregate over all 500 000 stock levels, joined to variants and products. | Acceptable for an occasional report; the summary would be a per-store valuation snapshot. |

## 6. Storefront: limits of the in-PHP listing

`CatalogReadModel` loads the live candidate set of a listing (category subtree, search) with its variants, images, stock, stats and ratings, then filters, facets, sorts and pages in PHP (ARCHITECTURE § storefront). SQL is not the problem here (the E12a partial indexes are used; DB time stays under 15 % of the request). The cost grows with the candidate count:

| Listing (cache miss) | Live candidates | Server time | DB time | Peak PHP memory |
|---|---|---|---|---|
| aisle (leaf category) | ~170 | 100–140 ms | 25 ms | 56 MB |
| search `q=tea`, suggest | ~750 | 260–330 ms | 150 ms | 59 MB |
| department (category with 18 sub-categories), with or without facets | ~3 000 | 0.6–0.8 s | 90–100 ms | 80 MB |
| whole shop (no category) | 30 000 | 7–10 s (421 queries: chunked loads) | 0.8–0.95 s | 416 MB |

The candidate set is cached per organization content version (until a listing, price, stock-relevant or promotion change), so a warm shop serves these from the cache; every content change makes the next visitor pay the cold cost, and memory per request grows with the candidates (the shop-wide listing needs ~400 MB of PHP memory at 30 000 products — above a 256 MB `memory_limit`). Proposed for catalogs above ~5 000 live products: SQL-side filtering, sorting and paging for the common case (category + price + in-stock + sort, no attribute facets), a materialized `product_listing_facets` table (live product × attribute value, min/max price, in-stock flag) refreshed with the product-stats job, and facet counts with `GROUP BY` on it.

## 7. Production settings and upgrade notes

- PostgreSQL defaults are sized for a laptop. For a dedicated 16–32 GB server: `shared_buffers` 25 % of RAM, `effective_cache_size` 60–75 %, `work_mem` 16–32 MB (the report aggregates sort 1 M rows), `random_page_cost` 1.1 on SSD (with the default 4 the planner preferred a full `sale_lines` scan over 24 000 index probes even before the covering index), `max_parallel_workers_per_gather` 2–4. Autovacuum must stay on: the covering indexes rely on the visibility map of the append-only line tables.
- The G1c migrations build their indexes `CONCURRENTLY`: writes continue, but each build scans the table (here: 2 M sale lines in 1 s; plan roughly a minute per 20–50 M lines on a busy server) and waits for running transactions to finish. They must run outside a transaction (Laravel honours `$withinTransaction = false`); do not wrap `php artisan migrate --force` in an outer transaction. A build that fails half way leaves an `INVALID` index; the next `migrate` drops and rebuilds it.
- Disk: the `sale_lines` covering index is 186 MB next to a 415 MB heap (≈ 95 bytes per line).

## 8. Repeat the check

```bash
# empty development database (never the production one)
DB_DATABASE=pos_e2e php artisan migrate:fresh --seed
DB_DATABASE=pos_e2e php artisan pos:perf:seed            # ~7 min at --scale=1
DB_DATABASE=pos_e2e php -d memory_limit=2G artisan pos:perf:explain --runs=3 > perf.txt
DB_DATABASE=pos_e2e php artisan pos:perf:explain --only=report.sales_daily --plans   # one path, text plans
```

`PerformanceToolsTest` runs both commands at `--scale=0.0005` on `pos_test` (PostgreSQL only).
