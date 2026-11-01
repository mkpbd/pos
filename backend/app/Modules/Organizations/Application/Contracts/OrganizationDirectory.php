<?php

namespace App\Modules\Organizations\Application\Contracts;

/**
 * Read access to organizations for other modules.
 */
interface OrganizationDirectory
{
    public function isActive(string $organizationId): bool;

    /**
     * Profile plus the document settings other modules print (invoice prefix, receipt texts)
     * and the contact details printed on documents (E10a: legal name, tax/BIN number, e-mail,
     * phone, address).
     *
     * @return array{id: string, name: string, slug: string, base_currency: string, timezone: string, tax_mode: string, status: string, invoice_prefix: ?string, receipt_header: ?string, receipt_footer: ?string, legal_name: ?string, tax_number: ?string, email: ?string, phone: ?string, address: ?string}|null
     */
    public function summary(string $organizationId): ?array;
}
