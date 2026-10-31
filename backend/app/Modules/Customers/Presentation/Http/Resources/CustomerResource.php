<?php

namespace App\Modules\Customers\Presentation\Http\Resources;

use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;
use App\Modules\Customers\Infrastructure\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Customer
 */
class CustomerResource extends JsonResource
{
    private bool $withOnlineAccount = false;

    /**
     * Include `online_account` (null without one): single-customer responses only.
     */
    public function withOnlineAccount(): static
    {
        $this->withOnlineAccount = true;

        return $this;
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
        ];
    }
}
