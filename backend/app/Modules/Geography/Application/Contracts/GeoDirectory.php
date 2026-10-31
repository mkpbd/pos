<?php

namespace App\Modules\Geography\Application\Contracts;

/**
 * Bangladesh's divisions and districts (global reference data) for address forms and
 * address validation.
 */
interface GeoDirectory
{
    /**
     * @return list<array{id: int, name: string, name_bn: string}> by English name
     */
    public function divisions(): array;

    /**
     * Districts of one division, or all 64 for null.
     *
     * @return list<array{id: int, division_id: int, name: string, name_bn: string}> by English name
     */
    public function districts(?int $divisionId = null): array;

    public function districtInDivision(int $districtId, int $divisionId): bool;

    /**
     * English names of the given divisions and districts.
     *
     * @param  list<int>  $divisionIds
     * @param  list<int>  $districtIds
     * @return array{divisions: array<int, string>, districts: array<int, string>}
     */
    public function names(array $divisionIds, array $districtIds): array;
}
