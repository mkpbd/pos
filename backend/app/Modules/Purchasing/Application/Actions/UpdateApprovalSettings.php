<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Infrastructure\Models\PurchaseApprovalSettings;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Saves the organization's purchase approval limits (SC2). Changes apply to documents
 * submitted afterwards; submitted documents keep the level decided at submission.
 */
class UpdateApprovalSettings
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{auto_approve_limit?: string, manager_limit?: string, require_po_approval?: bool}  $data
     */
    public function __invoke(array $data): PurchaseApprovalSettings
    {
        $organizationId = $this->tenant->requireOrganization();

        return DB::transaction(function () use ($organizationId, $data) {
            $settings = PurchaseApprovalSettings::query()->lockForUpdate()->first()
                ?? new PurchaseApprovalSettings(['organization_id' => $organizationId] + PurchaseApprovalSettings::DEFAULTS);
            $fields = array_keys(PurchaseApprovalSettings::DEFAULTS);
            $before = $settings->exists ? $settings->only($fields) : [];

            $values = array_intersect_key($data, PurchaseApprovalSettings::DEFAULTS);
            foreach (['auto_approve_limit', 'manager_limit'] as $field) {
                if (isset($values[$field])) {
                    $values[$field] = Decimal::round((string) $values[$field], 2);
                }
            }
            if (array_key_exists('require_po_approval', $values)) {
                $values['require_po_approval'] = filter_var($values['require_po_approval'], FILTER_VALIDATE_BOOLEAN);
            }
            $auto = (string) ($values['auto_approve_limit'] ?? $settings->auto_approve_limit);
            $manager = (string) ($values['manager_limit'] ?? $settings->manager_limit);
            if (Decimal::compare($auto, $manager) > 0) {
                throw ValidationException::withMessages(['auto_approve_limit' => ['The auto-approve limit cannot be above the manager limit.']]);
            }

            $settings->fill($values)->save();
            $this->audit->record('purchase_approval_settings.updated', $settings, old: $before, new: $settings->only($fields));

            return $settings;
        });
    }
}
