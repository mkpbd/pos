<?php

namespace App\Modules\Shared\Application\Support;

use App\Modules\Shared\Application\Contracts\AiFeatures;

/**
 * Default when the AI module is not installed: AI is never available.
 */
final class NoAiFeatures implements AiFeatures
{
    public function enabledFor(?string $organizationId): bool
    {
        return false;
    }
}
