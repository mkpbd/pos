<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Actions\UpdateReplenishmentSettings;
use App\Modules\Inventory\Application\Contracts\ReplenishmentData;
use App\Modules\Inventory\Presentation\Http\Requests\UpdateReplenishmentSettingsRequest;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * The organization's replenishment settings (SC1).
 */
class ReplenishmentSettingsController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly ReplenishmentData $replenishment,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * Replenishment settings
     *
     * Defaults until saved: no source store, 14 coverage, 30 velocity and 3 safety days.
     */
    public function show(): JsonResponse
    {
        return ApiResponse::success($this->present());
    }

    public function update(UpdateReplenishmentSettingsRequest $request, UpdateReplenishmentSettings $update): JsonResponse
    {
        $update($request->validated());

        return ApiResponse::success($this->present());
    }

    /**
     * @return array<string, mixed>
     */
    private function present(): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $settings = $this->replenishment->settings($organizationId);
        $source = $settings['source_store_id'] === null ? null
            : ($this->branches->storeSummaries($organizationId, [$settings['source_store_id']])[$settings['source_store_id']] ?? null);

        return ['source_store' => $source] + $settings;
    }
}
