<?php

namespace App\Modules\Suppliers\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use Illuminate\Support\Facades\DB;

/**
 * Creates or updates a supplier. A blank code on creation gets the next "SUP-0001" number.
 */
class SaveSupplier
{
    private const AUDITED = ['code', 'name', 'contact_person', 'email', 'phone', 'address', 'tax_number', 'payment_terms_days', 'opening_balance', 'is_active'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated attributes
     */
    public function __invoke(?Supplier $supplier, array $attributes): Supplier
    {
        $organizationId = $this->tenant->requireOrganization();

        return DB::transaction(function () use ($supplier, $attributes, $organizationId) {
            $creating = $supplier === null;
            $supplier ??= new Supplier(['organization_id' => $organizationId]);
            $before = $creating ? [] : $supplier->only(self::AUDITED);

            if ($creating && blank($attributes['code'] ?? null)) {
                $attributes['code'] = $this->sequences->next($organizationId, 'supplier', 'SUP-', 4);
            }

            $supplier->fill($attributes)->save();

            [$old, $new] = Changes::between($before, $supplier->only(self::AUDITED));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'supplier.created' : 'supplier.updated', $supplier, $old, $new);
            }

            return $supplier;
        });
    }
}
