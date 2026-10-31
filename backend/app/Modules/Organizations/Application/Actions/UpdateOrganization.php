<?php

namespace App\Modules\Organizations\Application\Actions;

use App\Modules\Organizations\Domain\Enums\OrganizationStatus;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use Illuminate\Support\Facades\DB;

class UpdateOrganization
{
    private const AUDITED = [
        'name', 'legal_name', 'tax_number', 'email', 'phone', 'address',
        'base_currency', 'timezone', 'tax_mode', 'status', 'settings',
    ];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array<string, mixed>  $changes  validated partial attributes
     */
    public function __invoke(Organization $organization, array $changes): Organization
    {
        return DB::transaction(function () use ($organization, $changes) {
            $before = $this->snapshot($organization);

            if (isset($changes['settings'])) {
                $changes['settings'] = array_replace($organization->settings, $changes['settings']);
            }
            $organization->fill($changes)->save();

            [$old, $new] = Changes::between($before, $this->snapshot($organization));
            if ($new !== []) {
                $action = array_key_exists('status', $new)
                    ? ($organization->status === OrganizationStatus::Suspended ? 'organization.suspended' : 'organization.reactivated')
                    : 'organization.updated';
                $this->audit->record($action, $organization, $old, $new);
            }

            return $organization;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Organization $organization): array
    {
        $values = $organization->only(self::AUDITED);
        $values['tax_mode'] = $organization->tax_mode->value;
        $values['status'] = $organization->status->value;

        return $values;
    }
}
