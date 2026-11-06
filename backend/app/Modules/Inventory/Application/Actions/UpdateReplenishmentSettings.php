<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Infrastructure\Models\ReplenishmentSettings;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Saves the organization's replenishment settings (SC1): the central source store
 * (nullable) and the coverage / velocity / safety days of reorder suggestions.
 */
class UpdateReplenishmentSettings
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{source_store_id?: ?string, coverage_days?: int, velocity_days?: int, safety_days?: int}  $data
     */
    public function __invoke(array $data): ReplenishmentSettings
    {
        $organizationId = $this->tenant->requireOrganization();

        if (array_key_exists('source_store_id', $data) && $data['source_store_id'] !== null) {
            $store = $this->branches->store($data['source_store_id'], $organizationId);
            if ($store === null) {
                throw ValidationException::withMessages(['source_store_id' => ['The selected store does not exist.']]);
            }
            if (! $store['is_active'] || ! $store['branch_is_active']) {
                throw ValidationException::withMessages(['source_store_id' => ['The selected store is inactive.']]);
            }
        }

        return DB::transaction(function () use ($organizationId, $data) {
            $settings = ReplenishmentSettings::query()->lockForUpdate()->first()
                ?? new ReplenishmentSettings(['organization_id' => $organizationId] + ReplenishmentSettings::DEFAULTS);
            $before = $settings->only(array_keys(ReplenishmentSettings::DEFAULTS));
            $settings->fill(array_intersect_key($data, ReplenishmentSettings::DEFAULTS))->save();

            $this->audit->record('replenishment_settings.updated', $settings, old: $before, new: $settings->only(array_keys(ReplenishmentSettings::DEFAULTS)));

            return $settings;
        });
    }
}
