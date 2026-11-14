<?php

namespace App\Modules\Shared\Application\Support;

use App\Modules\Shared\Application\Contracts\AiTextWriter;

/**
 * Default when the AI module is not installed: nothing is written (`disabled`).
 */
final class NoAiTextWriter implements AiTextWriter
{
    public function write(string $organizationId, ?string $userId, string $feature, string $system, string $prompt, int $maxTokens = 1000): array
    {
        return ['text' => null, 'status' => 'disabled'];
    }
}
