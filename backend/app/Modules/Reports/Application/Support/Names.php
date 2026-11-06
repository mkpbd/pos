<?php

namespace App\Modules\Reports\Application\Support;

use Illuminate\Support\Facades\DB;

/**
 * Display names for the ids in aggregated rows (one query per kind, organization-scoped,
 * read-only): branches, stores, products, categories, brands, users, suppliers, customers.
 */
final class Names
{
    private const TABLES = [
        'branch' => ['branches', 'name'],
        'store' => ['stores', 'name'],
        'product' => ['products', 'name'],
        'category' => ['categories', 'name'],
        'brand' => ['brands', 'name'],
        'user' => ['users', 'name'],
        'supplier' => ['suppliers', 'name'],
        'customer' => ['customers', 'name'],
    ];

    /**
     * @param  iterable<mixed>  $ids
     * @return array<string, string> id => name
     */
    public static function of(string $kind, string $organizationId, iterable $ids): array
    {
        $ids = array_values(array_unique(array_filter(is_array($ids) ? $ids : iterator_to_array($ids, false), fn ($id) => is_string($id) && $id !== '')));
        if ($ids === []) {
            return [];
        }
        [$table, $column] = self::TABLES[$kind];
        $names = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $names += DB::table($table)->where('organization_id', $organizationId)->whereIn('id', $chunk)->pluck($column, 'id')->all();
        }

        return array_map('strval', $names);
    }

    public static function one(string $kind, string $organizationId, ?string $id): ?string
    {
        return $id === null ? null : (self::of($kind, $organizationId, [$id])[$id] ?? null);
    }
}
