<?php

namespace App\Modules\Customers\Presentation\Http\Resources;

use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;
use App\Modules\Customers\Application\Contracts\CustomerStoreCredit;
use App\Modules\Customers\Infrastructure\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Customer
 */
class CustomerResource extends JsonResource
{
    private bool $withOnlineAccount = false;

    private ?string $storeCredit = null;

    private bool $storeCreditLoaded = false;

    /**
     * Include `online_account` (null without one): single-customer responses only.
     */
    public function withOnlineAccount(): static
    {
        $this->withOnlineAccount = true;

        return $this;
    }

    /**
     * POS1b: the store credit balance, loaded for a whole page at once (no N+1); without it a
     * single customer's balance is looked up.
     */
    public function withStoreCredit(?string $balance): static
    {
        $this->storeCredit = $balance;
        $this->storeCreditLoaded = true;

        return $this;
    }

    /**
     * Store credit balances of a page of customers, keyed by id (one query).
     *
     * @param  iterable<Customer>  $customers
     * @return array<string, string>
     */
    public static function storeCreditBalances(iterable $customers): array
    {
        $ids = [];
        foreach ($customers as $customer) {
            $ids[] = $customer->id;
        }

        return app(CustomerStoreCredit::class)->balances($ids);
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
            'address' => $this->address,
            'tax_number' => $this->tax_number,
            'group' => $this->whenLoaded('group', fn () => $this->group ? [
                'id' => $this->group->id,
                'name' => $this->group->name,
                'discount_percent' => $this->group->discount_percent,
            ] : null),
            'credit_limit' => $this->credit_limit,
            'opening_balance' => $this->opening_balance,
            'notes' => $this->notes,
            'is_active' => $this->is_active,
            'archived_at' => $this->deleted_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            ...($this->withOnlineAccount ? ['online_account' => app(CustomerOnlineAccounts::class)->forCustomer($this->id)] : []),
            // POS1b: null for users without `store_credit.view`.
            'store_credit_balance' => $this->storeCreditBalance($request),
        ];
    }

    private function storeCreditBalance(Request $request): ?string
    {
        if ($request->user()?->can('store_credit.view') !== true) {
            return null;
        }
        if (! $this->storeCreditLoaded) {
            return app(CustomerStoreCredit::class)->balances([$this->id])[$this->id] ?? '0.00';
        }

        return $this->storeCredit ?? '0.00';
    }
}
