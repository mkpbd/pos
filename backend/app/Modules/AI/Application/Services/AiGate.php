<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Infrastructure\Providers\NullLanguageModel;
use App\Modules\Shared\Application\Contracts\AiFeatures;
use Illuminate\Contracts\Container\Container;

/**
 * May the model be called for this organization? Only when AI is on for the application
 * (`AI_ENABLED`), a provider is configured (otherwise NullLanguageModel is bound) and the
 * organization has not turned it off in its AI settings.
 */
final class AiGate implements AiFeatures
{
    public function __construct(
        private readonly Container $container,
        private readonly AiSettingsService $settings,
    ) {}

    public function appEnabled(): bool
    {
        return (bool) config('ai.enabled');
    }

    public function providerConfigured(): bool
    {
        return ! $this->container->make(LanguageModel::class) instanceof NullLanguageModel;
    }

    public function organizationEnabled(string $organizationId): bool
    {
        return (bool) $this->settings->current($organizationId)->enabled;
    }

    public function enabledFor(?string $organizationId): bool
    {
        return $organizationId !== null && $this->appEnabled() && $this->providerConfigured() && $this->organizationEnabled($organizationId);
    }

    /**
     * @throws AiUnavailable 503 AI_UNAVAILABLE
     */
    public function require(string $organizationId): void
    {
        if (! $this->appEnabled() || ! $this->organizationEnabled($organizationId)) {
            throw AiUnavailable::disabled();
        }
        if (! $this->providerConfigured()) {
            throw new AiUnavailable('not_configured', 'No AI provider is configured.');
        }
    }
}
