<?php

namespace App\Modules\Catalog\Infrastructure\Directory;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use Illuminate\Database\Eloquent\Model;

class EloquentCatalogDirectory implements CatalogDirectory
{
    /** @var array<string, class-string<Model>> */
    private const MODELS = [
        'category_id' => Category::class,
        'brand_id' => Brand::class,
        'unit_id' => Unit::class,
        'tax_rate_id' => TaxRate::class,
    ];

    public function invalidReferences(string $organizationId, array $references): array
    {
        $invalid = [];
        foreach (self::MODELS as $field => $model) {
            $id = $references[$field] ?? null;
            if ($id === null) {
                continue;
            }

            $ok = $model::query()->withoutGlobalScope('organization')
                ->where('organization_id', $organizationId)
                ->whereKey($id)
                ->where('is_active', true)
                ->exists();

            if (! $ok) {
                $invalid[] = $field;
            }
        }

        return $invalid;
    }

    public function describe(string $organizationId, array $ids): array
    {
        $fetch = fn (string $model, ?array $keys, array $columns) => $keys
            ? $model::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)
                ->whereKey(array_values(array_unique($keys)))->get($columns)->keyBy('id')
            : collect();

        return [
            'categories' => $fetch(Category::class, $ids['categories'] ?? null, ['id', 'name'])
                ->map(fn (Category $c) => ['id' => $c->id, 'name' => $c->name])->all(),
            'brands' => $fetch(Brand::class, $ids['brands'] ?? null, ['id', 'name'])
                ->map(fn (Brand $b) => ['id' => $b->id, 'name' => $b->name])->all(),
            'units' => $fetch(Unit::class, $ids['units'] ?? null, ['id', 'name', 'code', 'allow_decimal'])
                ->map(fn (Unit $u) => ['id' => $u->id, 'name' => $u->name, 'code' => $u->code, 'allow_decimal' => $u->allow_decimal])->all(),
            'tax_rates' => $fetch(TaxRate::class, $ids['tax_rates'] ?? null, ['id', 'name', 'rate'])
                ->map(fn (TaxRate $t) => ['id' => $t->id, 'name' => $t->name, 'rate' => $t->rate])->all(),
        ];
    }
}
