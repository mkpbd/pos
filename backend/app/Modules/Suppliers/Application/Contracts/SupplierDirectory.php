<?php

namespace App\Modules\Suppliers\Application\Contracts;

interface SupplierDirectory
{
    /**
     * @return array{id: string, code: string, name: string, is_active: bool, archived: bool, opening_balance: string, payment_terms_days: int}|null
     */
    public function find(string $supplierId, string $organizationId): ?array;

    /**
     * @param  list<string>  $supplierIds
     * @return array<string, array{id: string, code: string, name: string}>
     */
    public function summaries(string $organizationId, array $supplierIds): array;
}
