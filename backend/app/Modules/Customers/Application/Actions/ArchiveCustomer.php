<?php

namespace App\Modules\Customers\Application\Actions;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * Archived customers cannot be selected at the POS but remain on past invoices.
 * Archiving frees their phone number; restoring fails if someone else took it meanwhile.
 */
class ArchiveCustomer
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function archive(Customer $customer): void
    {
        DB::transaction(function () use ($customer) {
            $customer->delete();
            $this->audit->record('customer.archived', $customer, old: ['code' => $customer->code, 'name' => $customer->name]);
        });
    }

    public function restore(Customer $customer): Customer
    {
        return DB::transaction(function () use ($customer) {
            if ($customer->phone !== null && Customer::query()->where('phone', $customer->phone)->exists()) {
                throw new BusinessRuleViolation('PHONE_IN_USE', 'Another customer now uses this phone number. Change it before restoring.');
            }

            $customer->restore();
            $this->audit->record('customer.restored', $customer, new: ['code' => $customer->code, 'name' => $customer->name]);

            return $customer;
        });
    }
}
