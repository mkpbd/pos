# AI Integration

> Status: design fixed in Phase 1; implemented in Phase 8.

## Principles

1. **Optional.** `AI_ENABLED=false` by default. With AI disabled or the provider down, every POS function works unchanged; AI endpoints answer `503 AI_UNAVAILABLE`.
2. **Provider-independent.** Business code depends on `App\Modules\AI\Domain\Contracts\LanguageModel`, never on a vendor SDK.
3. **Read-only.** AI can read aggregated, permission-filtered data and propose actions. It never posts sales, changes prices, issues refunds or modifies inventory. Proposed actions are returned as drafts the user must open and confirm through the normal, authorized endpoints.
4. **No AI-generated SQL.** Natural-language questions are mapped to **whitelisted report definitions** with typed parameters (the Phase 7 report registry, below); the Reports module executes them with the caller's tenant, branch and permission scope.
5. **Least data.** Prompts contain aggregates (totals, top-N lists, trends), not raw customer PII or full ledgers.

## Components

```
app/Modules/AI/
  Domain/Contracts/LanguageModel.php        # complete(messages, tools, options): Completion
  Infrastructure/Providers/
    AnthropicLanguageModel.php              # default vendor adapter (Claude, via HTTP client)
    NullLanguageModel.php                   # used when AI is disabled; throws AiUnavailable
  Application/
    Tools/                                  # report tools the model may call (typed JSON schemas)
    Assistants/SalesAssistant.php, InventoryAssistant.php, InsightsAssistant.php, CustomerInsights.php
    NaturalLanguageReporting.php            # question → report intent + params → Reports module
  Infrastructure/Jobs/GenerateDailyInsights.php
```

Configuration (`config/ai.php`, Phase 8): `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_TIMEOUT`, per-organization monthly token budget.

## Report registry (built in Phase 7)

NL reporting selects from the Phase 7 registry (`Reports\Application\ReportRegistry`) and **nothing else**. The registry is the same list `GET /reports` serves: 17 keys such as `sales_daily`, `sales_by_product`, `profit_and_loss`, `low_stock`, `customer_dues` and `tax`. Each definition has typed `params` (`date`, `entity`, `enum`, `integer`, `boolean`, with `required`, `options`, `default`, `min` / `max`), `columns` with types and `cost_sensitive`, a permission and a group ([API_DOCUMENTATION.md § Reports](API_DOCUMENTATION.md#reports-and-dashboard-phase-7)).

- **Tools from definitions.** Phase 8 generates one tool per definition the user may run: `ReportRegistry::visibleTo($user)`, so a user without `reports.financial` never gets P&L or tax tools. Each tool's JSON schema comes from that definition's `params`. A model can only pick a registered key and fill its parameters.
- **One execution path.** A tool call goes through `ReportRunner::run($report, $params, $user)` like the reports page:
  - `ParameterResolver` types and range-checks the parameters (`RANGE_TOO_LARGE` for more than 366 daily days or five years);
  - it checks every id against the organization and rejects inaccessible branches and stores (422) before anything runs;
  - the branch scope = the user's branches ∩ `branch_id`.

  A rejected call is reported to the model as an error. It is never retried outside the registry.
- **Cost rules stay.** Without `products.view_cost` the runner strips cost-sensitive columns, which are listed in `meta.omitted_columns`. The model never sees cost, profit or stock value the user could not see on the reports page.
- **Shared definitions.** Answers use the same figures as the reports and dashboard (`SalesFacts`: POS + web orders on delivery, net of discounts and returns, excluding tax; COGS from line cost snapshots). The model explains numbers; it does not compute them.
- **Least data.** Tools pass the aggregated rows, at most one page (`per_page` ≤ 500; a smaller limit is chosen per tool), plus `meta.totals`. The "open report" link is `/reports/<key>?<params>`, which the admin page reads from the URL.
- Adding an AI capability that needs data the registry lacks means **adding a report definition first**: a reviewed query class with tests. It never means a free-form query.

## Natural-language reporting flow

```
User question ──▶ permission check (ai.ask) ──▶ LLM with report tools only
                                                   │ tool call: sales_by_product{date_from,date_to,branch_id,channel}
                                                   ▼
                                ReportRunner (Phase 7): ParameterResolver validates params,
                                applies tenant/branch scope, runs the registered report,
                                strips cost columns the user may not see, returns rows + totals
                                                   │
                                                   ▼
                                LLM summarizes rows ──▶ answer + the structured table + "open report" link
```

- Unknown/unsupported questions get a "can't answer that yet" response listing supported report types.
- Branch parameters outside the user's assignments are rejected before execution.
- Every AI request is audit-logged (user, intent, parameters, token usage), without storing full result sets.

## Features (Phase 8)

| Feature | Data source | Output |
|---------|-------------|--------|
| Sales assistant | sales reports of the registry (`SalesFacts`) and the dashboard figures | best sellers, period summaries, Q&A |
| Inventory assistant | stock ledger, sales velocity; SC1 reorder suggestions (`ReorderSuggestions` — deterministic, already computed per store) | explains and prioritizes the SC1 reorder suggestions, slow movers, shortage risk |
| Business insights | `sales_daily` / `sales_monthly`, `profit_and_loss` (with `reports.financial`) | narrative summaries, anomalies (z-score on daily sales) |
| Customer insights | customer purchase aggregates | RFM segments, loyalty suggestions |

Deterministic calculations (forecasts, RFM scores, anomaly flags) are computed in PHP/SQL; the model only explains and prioritizes them. This keeps numbers reproducible and testable.

## Testing

- `FakeLanguageModel` returns scripted tool calls/responses for deterministic tests.
- Tests assert: disabled AI → 503 without affecting POS; tool calls cannot escape tenant scope; no write endpoints are reachable from tools; only registry keys the user may run become tools; cost-sensitive columns never reach the prompt without `products.view_cost`.
