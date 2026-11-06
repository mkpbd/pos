<?php

namespace App\Modules\AI\Presentation\Http\Controllers;

use App\Modules\AI\Application\Services\AiGate;
use App\Modules\AI\Application\Services\AiSettingsService;
use App\Modules\AI\Application\Services\UsageMeter;
use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Infrastructure\Models\AiSetting;
use App\Modules\AI\Presentation\Http\Requests\UpdateAiSettingsRequest;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * AI settings and usage of the organization (Phase 8, `ai.manage`). The provider credentials
 * stay in the server configuration and are never returned.
 */
class AiSettingsController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AiSettingsService $settings,
        private readonly AiGate $gate,
    ) {}

    /**
     * AI settings
     *
     * `enabled` (the organization switch), `app_enabled` (AI_ENABLED), `provider_configured`,
     * `effective_enabled`, `provider`, `model`, `monthly_token_budget` (override or null),
     * `default_monthly_token_budget`, `effective_monthly_token_budget` (0 = unlimited),
     * `data_sharing_level` and the levels available.
     */
    public function show(LanguageModel $model): JsonResponse
    {
        $organizationId = $this->tenant->requireOrganization();

        return ApiResponse::success($this->present($this->settings->current($organizationId), $organizationId, $model));
    }

    /**
     * Update AI settings
     *
     * `enabled` (boolean), `monthly_token_budget` (integer ≥ 0, 0 = unlimited; null = the
     * application default), `data_sharing_level` (`aggregates`). Audited.
     */
    public function update(UpdateAiSettingsRequest $request, LanguageModel $model): JsonResponse
    {
        $organizationId = $this->tenant->requireOrganization();
        /** @var TenantUser $user */
        $user = $request->user();
        $setting = $this->settings->update($user, $organizationId, $request->validated());

        return ApiResponse::success($this->present($setting, $organizationId, $model));
    }

    /**
     * AI usage
     *
     * `month` (Y-m, default the current month in the organization's timezone): tokens used,
     * budget, remaining, requests and failures, by feature.
     */
    public function usage(Request $request, UsageMeter $meter): JsonResponse
    {
        $data = $request->validate(['month' => ['sometimes', 'date_format:Y-m']]);

        return ApiResponse::success($meter->month($this->tenant->requireOrganization(), $data['month'] ?? null));
    }

    /**
     * @return array<string, mixed>
     */
    private function present(AiSetting $setting, string $organizationId, LanguageModel $model): array
    {
        $configured = $this->gate->providerConfigured();
        $budget = $this->settings->budget($organizationId);

        return [
            'enabled' => (bool) $setting->enabled,
            'app_enabled' => $this->gate->appEnabled(),
            'provider_configured' => $configured,
            'effective_enabled' => $this->gate->enabledFor($organizationId),
            'provider' => $configured ? (string) config('ai.provider') : null,
            'model' => $configured ? $model->model() : null,
            'monthly_token_budget' => $setting->monthly_token_budget,
            'default_monthly_token_budget' => max(0, (int) config('ai.monthly_token_budget')),
            'effective_monthly_token_budget' => $budget['budget'],
            'data_sharing_level' => $setting->data_sharing_level,
            'data_sharing_levels' => [[
                'value' => 'aggregates',
                'label' => 'Aggregates only',
                'description' => 'The AI receives totals, top lists and segment counts from your reports — never customer contact details or full ledgers.',
            ]],
            'updated_at' => $setting->updated_at?->toIso8601String(),
        ];
    }
}
