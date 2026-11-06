<?php

/*
| Optional AI module (Phase 8, docs/AI_INTEGRATION.md). Disabled by default: with AI off (or the
| provider down) every POS function works unchanged and the AI endpoints answer 503 AI_UNAVAILABLE
| (insights pages still return their deterministic facts, without a narrative).
|
| The API key is read here only; it is never logged, stored or returned by any endpoint.
*/
return [

    // Master switch for the whole application. Organizations can also turn AI off for themselves.
    'enabled' => (bool) env('AI_ENABLED', false),

    // anthropic (Claude Messages API over Laravel's HTTP client). "fake" is for local/testing only.
    'provider' => env('AI_PROVIDER', 'anthropic'),

    // Default model; any Messages API model id works.
    'model' => env('AI_MODEL', 'claude-sonnet-5-5'),

    'api_key' => env('AI_API_KEY'),

    // Seconds per HTTP attempt.
    'timeout' => (int) env('AI_TIMEOUT', 30),

    // Model ↔ tool round trips per question before a final answer is forced.
    'max_tool_rounds' => (int) env('AI_MAX_TOOL_ROUNDS', 4),

    // Default monthly token budget per organization (input + output tokens); 0 = unlimited.
    // An organization may override it in its AI settings.
    'monthly_token_budget' => (int) env('AI_MONTHLY_TOKEN_BUDGET', 2000000),

    // Rows of a tool result sent to the model (plus totals); the rest is summarized as a count.
    'tool_row_limit' => (int) env('AI_TOOL_ROW_LIMIT', 50),

    // Questions per minute per user on POST /ai/ask and /ai/explain-reorder.
    'ask_rate_limit' => (int) env('AI_ASK_RATE_LIMIT', 20),

    'anthropic' => [
        'base_url' => env('AI_ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
        'version' => env('AI_ANTHROPIC_VERSION', '2026-10-21'),
        // Response size cap per call (thinking + answer).
        'max_tokens' => (int) env('AI_MAX_TOKENS', 8000),
        // output_config.effort: low | medium | high | xhigh | max. Short report summaries do well at low.
        'effort' => env('AI_EFFORT', 'low'),
        // Server-side refusal fallback (`fallbacks: "default"`, beta server-side-fallback-2026-07-01; Claude API only).
        'refusal_fallback' => (bool) env('AI_REFUSAL_FALLBACK', true),
        // Retries on 429 / 5xx / connection errors, with exponential backoff (honours retry-after, capped).
        'max_retries' => (int) env('AI_MAX_RETRIES', 2),
        'retry_base_ms' => (int) env('AI_RETRY_BASE_MS', 500),
        'retry_max_ms' => (int) env('AI_RETRY_MAX_MS', 8000),
    ],

];
