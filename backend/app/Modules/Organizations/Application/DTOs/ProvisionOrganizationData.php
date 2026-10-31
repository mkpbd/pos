<?php

namespace App\Modules\Organizations\Application\DTOs;

use App\Modules\Organizations\Domain\Enums\TaxMode;

final readonly class ProvisionOrganizationData
{
    public function __construct(
        public string $organizationName,
        public string $adminName,
        public string $adminEmail,
        public string $adminPassword,
        public string $currency,
        public string $timezone,
        public TaxMode $taxMode = TaxMode::Exclusive,
        public string $branchName = 'Main Branch',
        public string $branchCode = 'MAIN',
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            organizationName: $data['organization_name'],
            adminName: $data['name'],
            adminEmail: mb_strtolower($data['email']),
            adminPassword: $data['password'],
            currency: $data['currency'] ?? config('pos.default_currency'),
            timezone: $data['timezone'] ?? config('pos.default_timezone'),
            taxMode: isset($data['tax_mode']) ? TaxMode::from($data['tax_mode']) : TaxMode::Exclusive,
            branchName: $data['branch_name'] ?? 'Main Branch',
        );
    }
}
