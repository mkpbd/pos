<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * Whether the optional AI module may call a language model for an organization (application
 * switch, organization switch and a configured provider). Bound to a "never" implementation
 * by default; the AI module (Phase 8) binds the real one. Used by the session bootstrap
 * (`ai_enabled`) so the SPA can show AI actions.
 */
interface AiFeatures
{
    public function enabledFor(?string $organizationId): bool;
}
