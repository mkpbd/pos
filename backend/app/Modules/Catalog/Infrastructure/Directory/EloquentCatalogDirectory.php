<?php

namespace App\Modules\Catalog\Infrastructure\Directory;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Catalog\Infrastructure\Models\Attribute;
use App\Modules\Catalog\Infrastructure\Models\AttributeValue;
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

    public function categoryWithDescendants(string $organizationId, string $categoryId): array
    {
        $ids = [];
        $level = Category::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)->whereKey($categoryId)->pluck('id')->all();

        // The tree is at most four levels deep, so this is at most four small queries.
        while ($level !== []) {
            $ids = [...$ids, ...$level];
            $level = Category::query()->withoutGlobalScope('organization')
                ->where('organization_id', $organizationId)->whereIn('parent_id', $level)->pluck('id')->all();
        }

        return $ids;
    }

    public function categories(string $organizationId): array
    {
        return Category::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)
            ->orderBy('sort_order')->orderBy('name')->orderBy('id')
            ->get(['id', 'parent_id', 'name', 'sort_order', 'is_active'])
            ->map(fn (Category $c) => [
                'id' => $c->id, 'parent_id' => $c->parent_id, 'name' => $c->name,
                'sort_order' => $c->sort_order, 'is_active' => $c->is_active,
            ])->all();
    }

    public function brands(string $organizationId): array
    {
        return Brand::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)
            ->orderBy('name')->orderBy('id')
            ->get(['id', 'name', 'is_active'])
            ->map(fn (Brand $b) => ['id' => $b->id, 'name' => $b->name, 'is_active' => $b->is_active])->all();
    }

    public function attributes(string $organizationId): array
    {
        $values = AttributeValue::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)
            ->orderBy('sort_order')->get(['attribute_id', 'value', 'swatch_hex'])->groupBy('attribute_id');

        return Attribute::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)
            ->orderBy('sort_order')->orderBy('name')->get()
            ->map(fn (Attribute $a) => [
                'id' => $a->id, 'name' => $a->name, 'slug' => $a->slug, 'display' => $a->display,
                'is_filterable' => $a->is_filterable, 'sort_order' => $a->sort_order,
                'values' => ($values[$a->id] ?? collect())
                    ->map(fn (AttributeValue $v) => ['value' => $v->value, 'swatch_hex' => $v->swatch_hex])->values()->all(),
            ])->all();
    }
}
