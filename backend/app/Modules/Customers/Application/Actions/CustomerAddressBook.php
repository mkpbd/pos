<?php

namespace App\Modules\Customers\Application\Actions;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Customers\Infrastructure\Models\CustomerAddress;
use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A customer's saved addresses (online store). Every operation is scoped to one customer
 * id (the signed-in shopper's), so another customer's address is simply not found.
 *
 * Rules: at most MAX addresses; whenever any exist exactly one is the default shipping
 * address (the first one becomes it, deleting it promotes the most recent remaining one);
 * at most one default billing address (same promotion rules). The district must lie in
 * the division. Phones arrive normalized (01XXXXXXXXX).
 *
 * @phpstan-type AddressView array{id: string, label: ?string, recipient_name: string, phone: string, division: array{id: int, name: string}, district: array{id: int, name: string}, area: string, address_line: string, postcode: ?string, is_default_shipping: bool, is_default_billing: bool}
 */
class CustomerAddressBook
{
    public const MAX = 10;

    public function __construct(private readonly GeoDirectory $geo) {}

    /**
     * @return list<AddressView> default shipping first, then newest first
     */
    public function list(string $customerId): array
    {
        return $this->present($this->query($customerId)
            ->orderByDesc('is_default_shipping')->orderByDesc('created_at')->orderByDesc('id')
            ->get());
    }

    /**
     * One of the customer's addresses, or null (another customer's address is not found).
     *
     * @return AddressView|null
     */
    public function find(string $customerId, string $addressId): ?array
    {
        $address = $this->query($customerId)->whereKey($addressId)->first();

        return $address === null ? null : $this->present(new Collection([$address]))[0];
    }

    /**
     * @param  array{label?: ?string, recipient_name: string, phone: string, division_id: int, district_id: int, area: string, address_line: string, postcode?: ?string, is_default_shipping?: bool, is_default_billing?: bool}  $data
     * @return AddressView
     */
    public function create(string $customerId, array $data): array
    {
        $this->assertDistrict((int) $data['division_id'], (int) $data['district_id']);

        $address = DB::transaction(function () use ($customerId, $data) {
            $this->lockCustomer($customerId);
            $existing = $this->query($customerId)->lockForUpdate()->get();
            if ($existing->count() >= self::MAX) {
                throw new BusinessRuleViolation('ADDRESS_LIMIT_REACHED', 'You can save up to '.self::MAX.' addresses. Delete one to add another.', ['max' => self::MAX]);
            }

            $address = new CustomerAddress(['customer_id' => $customerId]);
            $address->fill($this->attributes($data));
            $address->is_default_shipping = $existing->isEmpty() || (bool) ($data['is_default_shipping'] ?? false);
            $address->is_default_billing = $existing->where('is_default_billing', true)->isEmpty() || (bool) ($data['is_default_billing'] ?? false);
            $address->save();

            $this->clearOtherDefaults($customerId, $address);

            return $address;
        });

        return $this->present(new Collection([$address]))[0];
    }

    /**
     * @param  array<string, mixed>  $data  validated subset of the create fields
     * @return AddressView
     */
    public function update(string $customerId, string $addressId, array $data): array
    {
        $address = DB::transaction(function () use ($customerId, $addressId, $data) {
            $this->lockCustomer($customerId);
            /** @var CustomerAddress $address */
            $address = $this->query($customerId)->lockForUpdate()->findOrFail($addressId);

            $this->assertDistrict((int) ($data['division_id'] ?? $address->division_id), (int) ($data['district_id'] ?? $address->district_id));
            $address->fill($this->attributes($data));
            // The default shipping address can only change by choosing another one.
            if (($data['is_default_shipping'] ?? null) === true) {
                $address->is_default_shipping = true;
            }
            if (array_key_exists('is_default_billing', $data)) {
                $address->is_default_billing = (bool) $data['is_default_billing'];
            }
            $address->save();

            $this->clearOtherDefaults($customerId, $address);

            return $address;
        });

        return $this->present(new Collection([$address]))[0];
    }

    public function delete(string $customerId, string $addressId): void
    {
        DB::transaction(function () use ($customerId, $addressId) {
            $this->lockCustomer($customerId);
            /** @var CustomerAddress $address */
            $address = $this->query($customerId)->lockForUpdate()->findOrFail($addressId);
            $address->delete();

            $latest = fn () => $this->query($customerId)->orderByDesc('created_at')->orderByDesc('id')->first();
            if ($address->is_default_shipping && ($next = $latest()) !== null) {
                $next->forceFill(['is_default_shipping' => true])->save();
            }
            if ($address->is_default_billing && ($next = $latest()) !== null) {
                $next->forceFill(['is_default_billing' => true])->save();
            }
        });
    }

    /**
     * @return Builder<CustomerAddress>
     */
    private function query(string $customerId): Builder
    {
        return CustomerAddress::query()->where('customer_id', $customerId);
    }

    /**
     * Serializes concurrent changes to one customer's address book (count limit, defaults).
     */
    private function lockCustomer(string $customerId): void
    {
        Customer::query()->whereKey($customerId)->lockForUpdate()->firstOrFail();
    }

    private function clearOtherDefaults(string $customerId, CustomerAddress $address): void
    {
        foreach (['is_default_shipping', 'is_default_billing'] as $flag) {
            if ($address->{$flag}) {
                $this->query($customerId)->whereKeyNot($address->id)->where($flag, true)->update([$flag => false]);
            }
        }
    }

    private function assertDistrict(int $divisionId, int $districtId): void
    {
        if (! $this->geo->districtInDivision($districtId, $divisionId)) {
            throw ValidationException::withMessages(['district_id' => ['The district is not in the selected division.']]);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function attributes(array $data): array
    {
        return array_intersect_key($data, array_flip(['label', 'recipient_name', 'phone', 'division_id', 'district_id', 'area', 'address_line', 'postcode']));
    }

    /**
     * @param  Collection<int, CustomerAddress>  $addresses
     * @return list<AddressView>
     */
    private function present(Collection $addresses): array
    {
        $names = $this->geo->names($addresses->pluck('division_id')->all(), $addresses->pluck('district_id')->all());

        return $addresses->map(fn (CustomerAddress $a) => [
            'id' => $a->id,
            'label' => $a->label,
            'recipient_name' => $a->recipient_name,
            'phone' => $a->phone,
            'division' => ['id' => $a->division_id, 'name' => $names['divisions'][$a->division_id] ?? ''],
            'district' => ['id' => $a->district_id, 'name' => $names['districts'][$a->district_id] ?? ''],
            'area' => $a->area,
            'address_line' => $a->address_line,
            'postcode' => $a->postcode,
            'is_default_shipping' => $a->is_default_shipping,
            'is_default_billing' => $a->is_default_billing,
        ])->values()->all();
    }
}
