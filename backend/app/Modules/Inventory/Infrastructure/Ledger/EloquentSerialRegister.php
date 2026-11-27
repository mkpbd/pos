<?php

namespace App\Modules\Inventory\Infrastructure\Ledger;

use App\Modules\Inventory\Application\Contracts\SerialRegister;
use App\Modules\Inventory\Domain\SerialStatus;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Infrastructure\Models\SerialNumber;
use App\Modules\Inventory\Infrastructure\Models\SerialNumberEvent;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use LogicException;

/**
 * Concurrency: the serial rows of a call are locked FOR UPDATE in lower(serial) order before
 * their status is checked, so the same serial sold at two tills is sold once — the second
 * waits, then finds it no longer in stock. Serials new to the register are inserted with
 * ON CONFLICT DO NOTHING and re-read under the lock, so a concurrent first insert of the same
 * serial is treated like any existing row.
 */
class EloquentSerialRegister implements SerialRegister
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function receive(string $storeId, string $variantId, array $serials, StockReference $reference, string $event = 'received'): void
    {
        if (! in_array($event, ['received', 'adjusted_in'], true)) {
            throw new InvalidArgumentException("Unknown receive event {$event}.");
        }
        $this->bringIn($storeId, $variantId, $serials, $reference, $event);
    }

    public function returnFromCustomer(string $storeId, string $variantId, array $serials, StockReference $reference): void
    {
        $this->bringIn($storeId, $variantId, $serials, $reference, 'returned');
    }

    public function issue(string $storeId, string $variantId, array $serials, SerialStatus $status, StockReference $reference): void
    {
        $event = match ($status) {
            SerialStatus::Sold => 'sold',
            SerialStatus::ReturnedToSupplier => 'returned_to_supplier',
            SerialStatus::WrittenOff => 'written_off',
            default => throw new InvalidArgumentException('Serials can be issued as sold, returned_to_supplier or written_off.'),
        };
        $this->takeOut($storeId, $variantId, $serials, $status, null, $event, $reference);
    }

    public function dispatch(string $fromStoreId, string $variantId, array $serials, StockReference $reference): void
    {
        $this->takeOut($fromStoreId, $variantId, $serials, SerialStatus::InTransit, $fromStoreId, 'transferred_out', $reference);
    }

    public function arrive(string $toStoreId, string $variantId, array $serials, StockReference $reference): void
    {
        $keys = $this->normalize($serials);
        if ($keys === []) {
            return;
        }
        $rows = $this->lock($variantId, $keys);
        $bad = array_values(array_map(fn (string $key) => $rows[$key]->serial ?? $keys[$key], array_filter(
            array_keys($keys),
            fn (string $key) => ! isset($rows[$key]) || $rows[$key]->status !== SerialStatus::InTransit,
        )));
        if ($bad !== []) {
            throw new BusinessRuleViolation('SERIAL_NOT_IN_STOCK', 'Not in transit: '.implode(', ', $bad).'.', ['serials' => $bad]);
        }

        $this->move($rows, [], SerialStatus::InStock, $toStoreId, 'transferred_in', $toStoreId, $reference);
    }

    public function inStock(string $storeId, string $variantId): array
    {
        return SerialNumber::query()
            ->where('organization_id', $this->tenant->requireOrganization())
            ->where('store_id', $storeId)
            ->where('variant_id', $variantId)
            ->where('status', SerialStatus::InStock)
            ->orderByRaw('lower(serial)')
            ->pluck('serial')
            ->all();
    }

    /**
     * New serials and serials that left the business come in stock; in_stock / in_transit ones are refused.
     *
     * @param  list<string>  $serials
     */
    private function bringIn(string $storeId, string $variantId, array $serials, StockReference $reference, string $event): void
    {
        $keys = $this->normalize($serials);
        if ($keys === []) {
            return;
        }
        $rows = $this->lock($variantId, $keys);
        $created = [];
        if ($missing = array_diff_key($keys, $rows->all())) {
            $created = $this->create($variantId, $missing, $storeId, SerialStatus::InStock);
            $rows = $this->lock($variantId, $keys);
        }

        $bad = $rows->reject(fn (SerialNumber $s, string $key) => ($created[$key] ?? null) === $s->id)
            ->filter(fn (SerialNumber $s) => in_array($s->status, [SerialStatus::InStock, SerialStatus::InTransit], true))
            ->pluck('serial')->values()->all();
        if ($bad !== []) {
            throw new BusinessRuleViolation('SERIAL_IN_STOCK', 'Already in stock: '.implode(', ', $bad).'.', ['serials' => $bad]);
        }

        $this->move($rows, $created, SerialStatus::InStock, $storeId, $event, $storeId, $reference);
    }

    /**
     * Serials in stock at the store leave it ($status, kept at $newStoreId). Serials unknown to the
     * register are accepted while the store holds unregistered units (the legacy rule).
     *
     * @param  list<string>  $serials
     */
    private function takeOut(string $storeId, string $variantId, array $serials, SerialStatus $status, ?string $newStoreId, string $event, StockReference $reference): void
    {
        $keys = $this->normalize($serials);
        if ($keys === []) {
            return;
        }
        $rows = $this->lock($variantId, $keys);
        $created = [];
        if ($missing = array_diff_key($keys, $rows->all())) {
            if (Decimal::compare((string) count($missing), $this->unregistered($storeId, $variantId)) > 0) {
                $unknown = array_values($missing);
                throw new BusinessRuleViolation('SERIAL_NOT_IN_STOCK', 'Not in stock here: '.implode(', ', $unknown).'.', ['serials' => $unknown]);
            }
            $created = $this->create($variantId, $missing, $newStoreId, $status);
            $rows = $this->lock($variantId, $keys);
        }

        $bad = $rows->reject(fn (SerialNumber $s, string $key) => ($created[$key] ?? null) === $s->id)
            ->filter(fn (SerialNumber $s) => $s->status !== SerialStatus::InStock || $s->store_id !== $storeId)
            ->pluck('serial')->values()->all();
        if ($bad !== []) {
            throw new BusinessRuleViolation('SERIAL_NOT_IN_STOCK', 'Not in stock here: '.implode(', ', $bad).'.', ['serials' => $bad]);
        }

        $this->move($rows, $created, $status, $newStoreId, $event, $storeId, $reference);
    }

    /** Units on hand at the store that no in_stock serial accounts for (stock from before the register). */
    private function unregistered(string $storeId, string $variantId): string
    {
        $onHand = (string) (StockLevel::query()->where('store_id', $storeId)->where('variant_id', $variantId)->sum('quantity') ?: '0');
        $registered = SerialNumber::query()->where('store_id', $storeId)->where('variant_id', $variantId)
            ->where('status', SerialStatus::InStock)->count();

        return Decimal::sub($onHand, (string) $registered, 3);
    }

    /**
     * Updates the existing rows and appends one event per serial.
     *
     * @param  Collection<string, SerialNumber>  $rows
     * @param  array<string, string>  $created  key → id of rows inserted by this call (already in their new state)
     */
    private function move(Collection $rows, array $created, SerialStatus $status, ?string $newStoreId, string $event, string $eventStoreId, StockReference $reference): void
    {
        $now = now();
        $existing = $rows->reject(fn (SerialNumber $s, string $key) => ($created[$key] ?? null) === $s->id)->pluck('id')->all();
        if ($existing !== []) {
            SerialNumber::query()->whereKey($existing)->update(['status' => $status->value, 'store_id' => $newStoreId, 'updated_at' => $now]);
        }

        $organizationId = $this->tenant->requireOrganization();
        SerialNumberEvent::query()->insert($rows->values()->map(fn (SerialNumber $s) => [
            'id' => (string) Str::uuid7(),
            'organization_id' => $organizationId,
            'serial_number_id' => $s->id,
            'type' => $event,
            'store_id' => $eventStoreId,
            'reference_type' => $reference->type,
            'reference_id' => $reference->id,
            'reference_number' => $reference->number,
            'created_by' => StaffActor::id(),
            'created_at' => $now,
        ])->all());
    }

    /**
     * @param  array<string, string>  $serials  key → serial
     * @return array<string, string> key → id of the row this call inserted
     */
    private function create(string $variantId, array $serials, ?string $storeId, SerialStatus $status): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $ids = array_map(fn () => (string) Str::uuid7(), $serials);
        SerialNumber::query()->insertOrIgnore(array_map(fn (string $key) => [
            'id' => $ids[$key],
            'organization_id' => $organizationId,
            'variant_id' => $variantId,
            'serial' => $serials[$key],
            'store_id' => $storeId,
            'status' => $status->value,
            'updated_at' => now(),
        ], array_keys($serials)));

        return $ids;
    }

    /**
     * @param  array<string, string>  $keys
     * @return Collection<string, SerialNumber> keyed by lower(serial), locked
     */
    private function lock(string $variantId, array $keys): Collection
    {
        return SerialNumber::query()
            ->where('organization_id', $this->tenant->requireOrganization())
            ->where('variant_id', $variantId)
            ->whereIn(DB::raw('lower(serial)'), array_map('strval', array_keys($keys)))
            ->orderByRaw('lower(serial)')
            ->lockForUpdate()
            ->get()
            ->keyBy(fn (SerialNumber $s) => mb_strtolower($s->serial));
    }

    /**
     * @param  list<string>  $serials
     * @return array<string, string> lower(serial) → trimmed serial
     */
    private function normalize(array $serials): array
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Serial numbers can only change inside a database transaction.');
        }

        $keys = [];
        foreach ($serials as $serial) {
            $serial = trim((string) $serial);
            if ($serial === '' || mb_strlen($serial) > 100) {
                throw ValidationException::withMessages(['serials' => ['Serial numbers must be 1 to 100 characters.']]);
            }
            $key = mb_strtolower($serial);
            if (isset($keys[$key])) {
                throw ValidationException::withMessages(['serials' => ["Serial {$serial} is entered twice."]]);
            }
            $keys[$key] = $serial;
        }

        return $keys;
    }
}
