<?php

namespace App\Modules\Organizations\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Actions\UpdateOrganization;
use App\Modules\Organizations\Domain\AlertSettings;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Organizations\Presentation\Http\Requests\UpdateAlertSettingsRequest;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * R1: Settings → Alerts & reminders (`organizations.settings.alerts`, defaults in
 * AlertSettings). PATCH takes any of the keys; the change is audited as `organization.updated`.
 */
class AlertSettingsController
{
    public function show(TenantContext $tenant): JsonResponse
    {
        return ApiResponse::success(AlertSettings::effective($this->current($tenant)->settings['alerts'] ?? null));
    }

    public function update(UpdateAlertSettingsRequest $request, TenantContext $tenant, UpdateOrganization $update): JsonResponse
    {
        $organization = $this->current($tenant);
        $alerts = AlertSettings::effective(array_replace(AlertSettings::effective($organization->settings['alerts'] ?? null), $request->validated()));
        $organization = $update($organization, ['settings' => ['alerts' => $alerts]]);

        return ApiResponse::success(AlertSettings::effective($organization->settings['alerts'] ?? null));
    }

    private function current(TenantContext $tenant): Organization
    {
        return Organization::query()->findOrFail($tenant->requireOrganization());
    }
}
