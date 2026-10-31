<?php

namespace App\Modules\Loyalty\Application\Services;

use App\Modules\Loyalty\Infrastructure\Models\LoyaltyAccount;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltyTransaction;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The only write path for points: locks the customer's account, moves its balance and
 * appends the transaction, inside the caller's transaction.
 */
class PointsLedger
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * @param  array{type: string, source_type: string, source_id?: ?string, source_number?: ?string, sale_id?: ?string, value?: ?string, notes?: ?string}  $entry
     */
    public function post(string $customerId, int $points, array $entry): LoyaltyTransaction
    {
        $account = $this->lockedAccount($customerId);
        $account->balance += $points;
        if ($entry['type'] === 'earn') {
            $account->lifetime_earned += $points;
        } elseif ($entry['type'] === 'redeem') {
            $account->lifetime_redeemed += -$points;
        }
        $account->save();

        return LoyaltyTransaction::query()->create([
            'organization_id' => $account->organization_id,
            'customer_id' => $customerId,
            'type' => $entry['type'],
            'points' => $points,
            'balance_after' => $account->balance,
            'value' => $entry['value'] ?? null,
            'sale_id' => $entry['sale_id'] ?? null,
            'source_type' => $entry['source_type'],
            'source_id' => $entry['source_id'] ?? null,
            'source_number' => $entry['source_number'] ?? null,
            'notes' => $entry['notes'] ?? null,
            'created_by' => Auth::id(),
            'created_at' => now(),
        ]);
    }

    public function balance(string $customerId): int
    {
        return (int) (LoyaltyAccount::query()->where('customer_id', $customerId)->value('balance') ?? 0);
    }

    private function lockedAccount(string $customerId): LoyaltyAccount
    {
        DB::table('loyalty_accounts')->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'organization_id' => $this->tenant->requireOrganization(),
            'customer_id' => $customerId,
            'balance' => 0,
            'lifetime_earned' => 0,
            'lifetime_redeemed' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return LoyaltyAccount::query()->where('customer_id', $customerId)->lockForUpdate()->firstOrFail();
    }
}
