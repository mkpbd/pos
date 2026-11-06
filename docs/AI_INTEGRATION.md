# AI Integration

> Status: design fixed in Phase 1; implemented in Phase 8.

## Principles

1. **Optional.** `AI_ENABLED=false` by default. With AI disabled or the provider down, every POS function works unchanged; AI endpoints answer `503 AI_UNAVAILABLE`.
2. **Provider-independent.** Business code depends on `App\Modules\AI\Domain\Contracts\LanguageModel`, never on a vendor SDK.
3. **Read-only.** AI can read aggregated, permission-filtered data and propose actions. It never posts sales, changes prices, issues refunds or modifies inventory. Proposed actions are returned as drafts the user must open and confirm through the normal, authorized endpoints.
4. **No AI-generated SQL.** Natural-language questions are mapped to **whitelisted report definitions** with typed parameters; the Reports module executes them with the caller's tenant, branch and permission scope.
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

## Natural-language reporting flow

```
User question ──▶ permission check (ai.ask) ──▶ LLM with report tools only
                                                   │ tool call: sales_by_product{from,to,branch_id,limit}
                                                   ▼
                                Reports module validates params, applies tenant/branch scope,
                                runs the predefined query, returns rows
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
| Sales assistant | sales views | best sellers, period summaries, Q&A |
| Inventory assistant | stock ledger, sales velocity; SC1 reorder suggestions (`ReorderSuggestions` — deterministic, already computed per store) | explains and prioritizes the SC1 reorder suggestions, slow movers, shortage risk |
| Business insights | daily/monthly aggregates | narrative summaries, anomalies (z-score on daily sales) |
| Customer insights | customer purchase aggregates | RFM segments, loyalty suggestions |

Deterministic calculations (forecasts, RFM scores, anomaly flags) are computed in PHP/SQL; the model only explains and prioritizes them. This keeps numbers reproducible and testable.

## Testing

- `FakeLanguageModel` returns scripted tool calls/responses for deterministic tests.
- Tests assert: disabled AI → 503 without affecting POS; tool calls cannot escape tenant scope; no write endpoints are reachable from tools.
