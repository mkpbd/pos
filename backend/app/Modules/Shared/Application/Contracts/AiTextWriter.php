<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * P2b: one short text written by the optional AI module for another module (social captions),
 * without tools. Gated (AI on for the application and the organization, a provider configured)
 * and metered (monthly token budget, one usage row per call) like every AI feature. Never throws
 * for AI being off, the provider failing or the budget being used up: `text` is null and
 * `status` says why. Bound to a "never" implementation by default; the AI module binds the
 * real one.
 */
interface AiTextWriter
{
    /**
     * @param  string  $feature  usage feature key (e.g. `social_captions`)
     * @param  string  $system  system prompt
     * @param  string  $prompt  the user turn (facts as data)
     * @return array{text: ?string, status: 'ok'|'disabled'|'unavailable'|'budget_exceeded'|'refused'|'empty'}
     */
    public function write(string $organizationId, ?string $userId, string $feature, string $system, string $prompt, int $maxTokens = 1000): array;
}
