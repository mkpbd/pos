<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Validation\ValidationException;

/**
 * Lookups every sales operation needs: organization settings and a usable customer.
 */
class SalesContext
{
    /** @var array<string, mixed>|null */
    private ?array $organization = null;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly CustomerDirectory $customers,
    ) {}

    public function organizationId(): string
    {
        return $this->tenant->requireOrganization();
    }

    /**
     * @return array<string, mixed>
     */
    public function organization(): array
    {
        return $this->organization ??= $this->organizations->summary($this->organizationId()) ?? [];
    }

    public function currency(): string
    {
        return $this->organization()['base_currency'] ?? config('pos.default_currency');
    }

    public function taxMode(): TaxMode
    {
        return TaxMode::tryFrom((string) ($this->organization()['tax_mode'] ?? '')) ?? TaxMode::Exclusive;
    }

    public function invoicePrefix(): string
    {
        return filled($this->organization()['invoice_prefix'] ?? null) ? $this->organization()['invoice_prefix'] : 'INV-';
    }

    /**
     * @return array{id: string, code: string, name: string, phone: ?string, is_active: bool, archived: bool, credit_limit: string, opening_balance: string, group_discount_percent: string}
     *
     * @throws ValidationException
     */
    public function requireActiveCustomer(string $customerId): array
    {
        $customer = $this->customers->find($customerId, $this->organizationId());
        if ($customer === null || $customer['archived']) {
            throw ValidationException::withMessages(['customer_id' => ['The selected customer does not exist.']]);
        }
        if (! $customer['is_active']) {
            throw ValidationException::withMessages(['customer_id' => ["{$customer['name']} is inactive."]]);
        }

        return $customer;
    }
}
