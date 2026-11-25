<?php

namespace App\Modules\StoredValue\Application\Services;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;

/**
 * The only write path for store credit: serialises on the customer (so two tills never spend
 * the same credit), recomputes the balance from the ledger, refuses to take it below zero
 * and appends the entry — inside the caller's transaction.
 */
class StoreCreditLedger
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Serialises store credit changes of one customer until the transaction ends.
     */
    public function lock(string $customerId): void
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Store credit changes must run inside a transaction.');
        }
        if (DB::getDriverName() === 'pgsql') {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ["store-credit:{$customerId}"]);
        }
    }

    public function balance(string $customerId): string
    {
        return Decimal::round((string) (StoreCreditEntry::query()->where('customer_id', $customerId)->sum('amount') ?: '0'), 2);
    }

    /**
     * Balances and last activity of the given customers in one query (customers without
     * entries are 0.00 / null).
     *
     * @param  list<string>  $customerIds
     * @return array<string, array{balance: string, last_activity_at: ?string}>
     */
    public function balances(array $customerIds): array
    {
        $customerIds = array_values(array_unique($customerIds));
        if ($customerIds === []) {
            return [];
        }
        $rows = StoreCreditEntry::query()
            ->whereIn('customer_id', $customerIds)
            ->groupBy('customer_id')
            ->selectRaw('customer_id, SUM(amount) as balance, MAX(created_at) as last_activity_at')
            ->toBase()
            ->get()
            ->keyBy('customer_id');

        $result = [];
        foreach ($customerIds as $id) {
            $row = $rows[$id] ?? null;
            $result[$id] = [
                'balance' => Decimal::round((string) ($row->balance ?? '0'), 2),
                'last_activity_at' => $row?->last_activity_at === null ? null : Carbon::parse($row->last_activity_at)->toIso8601String(),
            ];
        }

        return $result;
    }

    /**
     * Appends a signed movement (locks the customer first).
     *
     * @param  array{id?: string, type: string, currency: string, method?: ?string, reference?: ?string, reference_type?: ?string, reference_id?: ?string, reference_number?: ?string, receipt_number?: ?string, note?: ?string, store_id?: ?string, created_by?: ?string}  $entry
     *
     * @throws BusinessRuleViolation INSUFFICIENT_STORE_CREDIT
     */
    public function post(string $customerId, string $amount, array $entry): StoreCreditEntry
    {
        $amount = Decimal::round($amount, 2);
        if (Decimal::isZero($amount)) {
            throw new LogicException('Store credit movements cannot be zero.');
        }
        $this->lock($customerId);
        $balance = $this->balance($customerId);
        $after = Decimal::add($balance, $amount, 2);
        if (Decimal::isNegative($after)) {
            throw new BusinessRuleViolation('INSUFFICIENT_STORE_CREDIT', "The customer has {$balance} in store credit; ".Decimal::negate($amount, 2).' is needed.', [
                'balance' => $balance,
                'required' => Decimal::negate($amount, 2),
            ]);
        }

        return StoreCreditEntry::query()->create([
            'id' => $entry['id'] ?? (string) Str::uuid7(),
            'organization_id' => $this->tenant->requireOrganization(),
            'customer_id' => $customerId,
            'type' => $entry['type'],
            'amount' => $amount,
            'balance_after' => $after,
            'currency' => $entry['currency'],
            'method' => $entry['method'] ?? null,
            'reference' => $entry['reference'] ?? null,
            'reference_type' => $entry['reference_type'] ?? null,
            'reference_id' => $entry['reference_id'] ?? null,
            'reference_number' => $entry['reference_number'] ?? null,
            'receipt_number' => $entry['receipt_number'] ?? null,
            'note' => $entry['note'] ?? null,
            'store_id' => $entry['store_id'] ?? null,
            'created_by' => $entry['created_by'] ?? Auth::id(),
            'created_at' => now(),
        ]);
    }
}
