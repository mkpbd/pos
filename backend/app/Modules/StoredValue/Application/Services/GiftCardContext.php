<?php

namespace App\Modules\StoredValue\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use DateTimeInterface;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Lookups every gift card operation needs: the organization (currency, timezone), an optional
 * customer and the expiry a new card gets.
 */
class GiftCardContext
{
    /** @var array<string, mixed>|null */
    private ?array $organization = null;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly CustomerDirectory $customers,
        private readonly GiftCardBook $book,
    ) {}

    public function organizationId(): string
    {
        return $this->tenant->requireOrganization();
    }

    public function currency(): string
    {
        return $this->organization()['base_currency'] ?? config('pos.default_currency');
    }

    /**
     * The card's customer: none, or an active customer of the organization.
     *
     * @return array{id: string, name: string}|null
     *
     * @throws ValidationException customer_id
     */
    public function customer(?string $customerId): ?array
    {
        if (blank($customerId)) {
            return null;
        }
        $customer = $this->customers->find($customerId, $this->organizationId());
        if ($customer === null || $customer['archived']) {
            throw ValidationException::withMessages(['customer_id' => ['The selected customer does not exist.']]);
        }
        if (! $customer['is_active']) {
            throw ValidationException::withMessages(['customer_id' => ["{$customer['name']} is inactive."]]);
        }

        return ['id' => $customer['id'], 'name' => $customer['name']];
    }

    /**
     * `never_expires: true` → null; `expires_at` (a date: the end of that day in the
     * organization's timezone, or a date-time); otherwise 12 months from now.
     *
     * @param  array{expires_at?: ?string, never_expires?: bool}  $data
     *
     * @throws ValidationException expires_at
     */
    public function expiry(array $data): ?DateTimeInterface
    {
        if ((bool) ($data['never_expires'] ?? false)) {
            return null;
        }
        if (blank($data['expires_at'] ?? null)) {
            return $this->book->defaultExpiry();
        }

        $value = (string) $data['expires_at'];
        $timezone = (string) ($this->organization()['timezone'] ?? config('app.timezone'));
        $expiresAt = preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1
            ? Carbon::parse($value, $timezone)->endOfDay()
            : Carbon::parse($value);
        if ($expiresAt->isPast()) {
            throw ValidationException::withMessages(['expires_at' => ['The expiry date must be in the future.']]);
        }

        return $expiresAt->utc();
    }

    /**
     * @return array<string, mixed>
     */
    private function organization(): array
    {
        return $this->organization ??= $this->organizations->summary($this->organizationId()) ?? [];
    }
}
