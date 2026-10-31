<?php

namespace App\Modules\Customers\Application\Actions;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The customer record behind an online store account (CustomerAccounts module).
 *
 * Registration always creates a NEW customer (code from the customer sequence); it never
 * attaches to an existing POS customer with the same phone or e-mail (account takeover
 * risk, ADR-018). The phone is copied onto the customer only while no other live customer
 * of the organization uses it (phones identify customers at the till), so a shopper never
 * learns whether a number is already known to the store.
 */
class OnlineCustomerProfiles
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SaveCustomer $save,
    ) {}

    /**
     * @return string the new customer's id
     */
    public function register(string $name, string $email, ?string $phone): string
    {
        return DB::transaction(fn () => ($this->save)(null, [
            'name' => $name,
            'email' => $email,
            'phone' => $this->phoneIfFree($phone, null),
        ])->id);
    }

    /**
     * @return array{id: string, name: string, email: ?string, phone: ?string}|null
     */
    public function find(string $customerId): ?array
    {
        $customer = Customer::query()->find($customerId);

        return $customer === null ? null : ['id' => $customer->id, 'name' => $customer->name, 'email' => $customer->email, 'phone' => $customer->phone];
    }

    /**
     * Whether the customer may use the online store (exists, not archived, active).
     */
    public function isUsable(string $customerId): bool
    {
        return Customer::query()->whereKey($customerId)->where('is_active', true)->exists();
    }

    public function update(string $customerId, string $name, ?string $phone): void
    {
        DB::transaction(function () use ($customerId, $name, $phone) {
            /** @var Customer $customer */
            $customer = Customer::query()->lockForUpdate()->findOrFail($customerId);
            ($this->save)($customer, ['name' => $name, 'phone' => $this->phoneIfFree($phone, $customerId)]);
        });
    }

    private function phoneIfFree(?string $phone, ?string $customerId): ?string
    {
        if ($phone === null || $phone === '') {
            return null;
        }

        $taken = Customer::query()
            ->where('organization_id', $this->tenant->requireOrganization())
            ->where('phone', $phone)
            ->when($customerId !== null, fn ($q) => $q->whereKeyNot($customerId))
            ->exists();

        return $taken ? null : $phone;
    }
}
