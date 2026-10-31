<?php

namespace App\Modules\Customers\Application\Actions;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Creates or updates a customer. A blank code on creation gets the next "CUS-000001" number.
 * Which fields a caller may set (credit limit, group, …) is decided by the request's permissions.
 */
class SaveCustomer
{
    private const AUDITED = ['code', 'name', 'phone', 'email', 'customer_group_id', 'credit_limit', 'opening_balance', 'tax_number', 'is_active'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated attributes
     */
    public function __invoke(?Customer $customer, array $attributes): Customer
    {
        $organizationId = $this->tenant->requireOrganization();

        return DB::transaction(function () use ($customer, $attributes, $organizationId) {
            $creating = $customer === null;
            $customer ??= new Customer(['organization_id' => $organizationId]);
            $before = $creating ? [] : $customer->only(self::AUDITED);

            if ($creating && blank($attributes['code'] ?? null)) {
                $attributes['code'] = $this->sequences->next($organizationId, 'customer', 'CUS-');
            }

            $customer->fill($attributes)->save();

            [$old, $new] = Changes::between($before, $customer->only(self::AUDITED));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'customer.created' : 'customer.updated', $customer, $old, $new);
            }

            return $customer;
        });
    }
}
