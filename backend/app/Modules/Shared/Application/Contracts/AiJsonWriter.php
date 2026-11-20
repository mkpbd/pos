<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * AI2a: one structured (JSON) answer written by the AI module for another module (online store
 * texts, AI drafts, category suggestions, bundle ideas), without tools. The model must answer
 * with JSON following `$schema` (structured output: every object `additionalProperties: false`
 * with all properties in `required`; no length / range constraints — clamp the answer on your
 * side; enums are fine).
 *
 * Gated (AI on for the application and the organization, a provider configured) and metered
 * (monthly token budget, one usage row per call) like every AI feature. The prompt and the answer
 * are never stored (the usage row keeps the feature, tokens and a field count). Never throws for
 * AI being off, the provider failing or the budget being used up: `data` is null and `status`
 * says why — `refused` (the provider declined), `empty` (no answer or `{}`), `invalid` (not a
 * JSON object, or cut off at the token limit).
 */
interface AiJsonWriter
{
    /**
     * @param  string  $feature  usage feature key (e.g. `catalog_writer`)
     * @param  string  $system  system prompt
     * @param  string  $prompt  the user turn (facts as data)
     * @param  array<string, mixed>  $schema  JSON schema of the answer (an object)
     * @return array{status: 'ok'|'disabled'|'budget_exceeded'|'unavailable'|'refused'|'empty'|'invalid', data: ?array<string, mixed>}
     */
    public function write(string $organizationId, ?string $userId, string $feature, string $system, string $prompt, array $schema, int $maxTokens = 2000): array;
}
