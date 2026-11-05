<?php

namespace App\Modules\Organizations\Application\Support;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Carbon\CarbonImmutable;

/**
 * "Today" as the current organization sees it. The application clock runs in UTC, so between
 * midnight and the UTC rollover (00:00–06:00 in Asia/Dhaka) the server's date is still
 * yesterday; business dates (invoice, payment, expense days) are checked against this instead.
 */
final class OrganizationDate
{
    public function __construct(
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
    ) {}

    public function timezone(): string
    {
        $organizationId = $this->tenant->organizationId();
        $timezone = $organizationId === null ? null : ($this->organizations->summary($organizationId)['timezone'] ?? null);

        return is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone');
    }

    /** Y-m-d */
    public function today(): string
    {
        return CarbonImmutable::now($this->timezone())->toDateString();
    }
}
