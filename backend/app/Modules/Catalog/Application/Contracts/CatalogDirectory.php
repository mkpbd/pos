<?php

namespace App\Modules\Catalog\Application\Contracts;

/**
 * Read access to catalog reference data for other modules (Products, POS, Reports).
 */
interface CatalogDirectory
{
    /**
     * Field names (category_id, brand_id, unit_id, tax_rate_id) whose given id does not
     * reference an active record of the organization. NULL ids are not checked.
     *
     * @param  array{category_id?: ?string, brand_id?: ?string, unit_id?: ?string, tax_rate_id?: ?string}  $references
     * @return list<string>
     */
    public function invalidReferences(string $organizationId, array $references): array;

    /**
     * Display data for ids, keyed by id.
     *
     * @param  array{categories?: list<string>, brands?: list<string>, units?: list<string>, tax_rates?: list<string>}  $ids
     * @return array{
     *   categories: array<string, array{id: string, name: string}>,
     *   brands: array<string, array{id: string, name: string}>,
     *   units: array<string, array{id: string, name: string, code: string, allow_decimal: bool}>,
     *   tax_rates: array<string, array{id: string, name: string, rate: string}>
     * }
     */
    public function describe(string $organizationId, array $ids): array;
}
