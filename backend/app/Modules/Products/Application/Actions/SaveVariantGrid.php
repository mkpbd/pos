<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Products\Application\Contracts\VariantStock;
use App\Modules\Products\Application\Contracts\VariantWebData;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P1a: saves a product's options and variants from the admin variant grid in one transaction.
 *
 * - A row with an id updates that variant; a row without one is matched to an existing variant
 *   with the same option values (case-insensitive), else creates a variant. Sending the same
 *   payload twice therefore changes nothing the second time.
 * - Existing variants left out are archived, except variants with stock history whose option
 *   values still fit the options: those are kept, deactivated.
 * - Validation and persistence are SaveProduct's (SKU/barcode uniqueness, option rules, audit).
 * - `opening_stock` of variants created by this save is posted through Inventory (reason
 *   "opening", note "Variant grid") in the same transaction; rows that match existing variants
 *   ignore it.
 * - `compare_at_price` (online store) is written only when `$withWebData` (the user may manage
 *   the online catalog); it must be above the selling price.
 * - Without `purchase_price` an existing variant keeps its cost (users who cannot see costs);
 *   a new one gets 0.00.
 */
class SaveVariantGrid
{
    public const NOTE = 'Variant grid';

    public function __construct(
        private readonly SaveProduct $save,
        private readonly VariantStock $stock,
        private readonly VariantWebData $webData,
    ) {}

    /**
     * @param  array{options?: ?list<array{name: string, values: list<string>}>, variants: list<array<string, mixed>>, stock_store_id?: ?string}  $data  validated request data
     */
    public function __invoke(Product $product, array $data, TenantUser $actor, bool $withWebData): Product
    {
        $options = empty($data['options']) ? null : array_map(
            fn (array $o) => ['name' => trim($o['name']), 'values' => array_values(array_map(fn ($v) => trim((string) $v), $o['values']))],
            $data['options'],
        );
        $rows = array_values($data['variants']);

        /** @var Collection<string, ProductVariant> $existing */
        $existing = $product->variants()->with('barcodes')->get()->keyBy('id');
        $byCombination = [];
        foreach ($existing as $variant) {
            $byCombination[self::combination($variant->option_values)] ??= $variant->id;
        }

        // 1. Match rows without an id to existing variants by their option values.
        $used = array_filter(array_column($rows, 'id'));
        $creates = [];
        foreach ($rows as $i => $row) {
            if (! empty($row['id'])) {
                continue;
            }
            $match = $byCombination[self::combination($row['option_values'] ?? [])] ?? null;
            if ($match !== null && ! in_array($match, $used, true)) {
                $rows[$i]['id'] = $match;
                $used[] = $match;
            } else {
                $creates[$i] = true;
            }
        }

        // 2. Rules of the grid itself.
        $errors = [];
        $opening = [];
        foreach ($rows as $i => $row) {
            $quantity = isset($row['opening_stock']) ? (string) $row['opening_stock'] : null;
            if (! isset($creates[$i]) || $quantity === null || Decimal::compare($quantity, '0') <= 0) {
                continue;
            }
            if (! $product->track_stock) {
                $errors["variants.{$i}.opening_stock"] = ['This product does not track stock.'];
            } elseif ($product->track_batches) {
                $errors["variants.{$i}.opening_stock"] = ['Record opening stock of batch-tracked products under Inventory → Adjustments.'];
            } else {
                $opening[$i] = Decimal::round($quantity, 3);
            }
        }
        if ($opening !== [] && empty($data['stock_store_id'])) {
            $errors['stock_store_id'] = ['Choose the store that receives the opening stock.'];
        }
        if ($withWebData) {
            foreach ($rows as $i => $row) {
                if (isset($row['compare_at_price']) && Decimal::compare((string) $row['compare_at_price'], (string) $row['selling_price']) <= 0) {
                    $errors["variants.{$i}.compare_at_price"] = ['The compare-at price must be higher than the selling price.'];
                }
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        // 3. Variants with stock history that the grid left out stay, deactivated.
        $omitted = $existing->filter(fn (ProductVariant $v) => ! in_array($v->id, $used, true));
        $withHistory = $this->stock->withHistory($product->organization_id, $omitted->keys()->values()->all());
        $keep = $omitted->filter(fn (ProductVariant $v) => in_array($v->id, $withHistory, true));
        $present = array_map(fn (array $r) => self::combination($r['option_values'] ?? []), $rows);
        $kept = [];
        foreach ($keep as $variant) {
            $combination = self::combination($variant->option_values);
            if (self::fits($variant->option_values, $options) && ! in_array($combination, $present, true)) {
                $kept[] = [
                    'id' => $variant->id,
                    'sku' => $variant->sku,
                    'name' => $variant->name,
                    'option_values' => $variant->option_values,
                    'purchase_price' => $variant->purchase_price,
                    'selling_price' => $variant->selling_price,
                    'wholesale_price' => $variant->wholesale_price,
                    'reorder_level' => $variant->reorder_level,
                    'barcodes' => $variant->barcodes->pluck('barcode')->all(),
                    'is_active' => false,
                ];
                $present[] = $combination;
            }
        }

        $variants = [];
        foreach ($rows as $row) {
            $current = isset($row['id']) ? $existing->get($row['id']) : null;
            $variants[] = [
                'id' => $row['id'] ?? null,
                'sku' => $row['sku'] ?? null,
                'name' => array_key_exists('name', $row) ? $row['name'] : $current?->name,
                'option_values' => $row['option_values'] ?? [],
                'purchase_price' => $row['purchase_price'] ?? $current?->purchase_price ?? '0.00',
                'selling_price' => $row['selling_price'],
                'wholesale_price' => $row['wholesale_price'] ?? null,
                'reorder_level' => $row['reorder_level'] ?? '0',
                'barcodes' => $row['barcodes'] ?? [],
                'is_active' => $row['is_active'] ?? true,
            ];
        }

        $productData = ProductData::fromArray([
            'name' => $product->name,
            'description' => $product->description,
            'type' => $product->type->value,
            'category_id' => $product->category_id,
            'brand_id' => $product->brand_id,
            'unit_id' => $product->unit_id,
            'tax_rate_id' => $product->tax_rate_id,
            'track_stock' => $product->track_stock,
            'track_batches' => $product->track_batches,
            'track_serials' => $product->track_serials,
            'max_discount_percent' => $product->max_discount_percent,
            'options' => $options,
            'is_active' => $product->is_active,
            'variants' => [...$variants, ...$kept],
        ]);

        return DB::transaction(function () use ($product, $productData, $rows, $opening, $data, $actor, $withWebData) {
            $product = ($this->save)($product, $productData);
            $ids = $product->variants()->pluck('id')->all(); // in sort order = payload order

            if ($opening !== []) {
                $quantities = [];
                $rowOf = [];
                foreach ($opening as $i => $quantity) {
                    $quantities[$ids[$i]] = $quantity;
                    $rowOf[] = $i;
                }
                try {
                    $this->stock->postOpening($actor, (string) $data['stock_store_id'], $quantities, self::NOTE);
                } catch (ValidationException $e) {
                    throw ValidationException::withMessages(self::remap($e->errors(), $rowOf));
                }
            }

            if ($withWebData) {
                $prices = [];
                foreach ($rows as $i => $row) {
                    if (array_key_exists('compare_at_price', $row)) {
                        $prices[$ids[$i]] = $row['compare_at_price'] === null ? null : Decimal::round((string) $row['compare_at_price'], 2);
                    }
                }
                if ($prices !== []) {
                    $this->webData->saveCompareAtPrices($prices);
                }
            }

            return $product;
        });
    }

    /**
     * A variant's option values as a case-insensitive key.
     *
     * @param  array<string, mixed>  $values
     */
    public static function combination(array $values): string
    {
        $normalized = [];
        foreach ($values as $name => $value) {
            $normalized[mb_strtolower(trim((string) $name))] = mb_strtolower(trim((string) $value));
        }
        ksort($normalized);

        return (string) json_encode($normalized);
    }

    /**
     * Whether a variant's option values are a complete combination of the given options.
     *
     * @param  array<string, string>  $values
     * @param  list<array{name: string, values: list<string>}>|null  $options
     */
    private static function fits(array $values, ?array $options): bool
    {
        if ($options === null) {
            return false; // a product without options has exactly one variant
        }
        $given = array_change_key_case($values, CASE_LOWER);
        if (count($given) !== count($options)) {
            return false;
        }
        foreach ($options as $option) {
            $value = $given[mb_strtolower($option['name'])] ?? null;
            if ($value === null || ! in_array(mb_strtolower((string) $value), array_map('mb_strtolower', $option['values']), true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Inventory's errors (`store_id`, `lines.{k}.…`) as grid fields.
     *
     * @param  array<string, list<string>>  $errors
     * @param  list<int>  $rowOf  line index => grid row index
     * @return array<string, list<string>>
     */
    private static function remap(array $errors, array $rowOf): array
    {
        $result = [];
        foreach ($errors as $key => $messages) {
            if ($key === 'store_id') {
                $result['stock_store_id'] = $messages;
            } elseif (preg_match('/^lines\.(\d+)\./', $key, $m) === 1 && isset($rowOf[(int) $m[1]])) {
                $result['variants.'.$rowOf[(int) $m[1]].'.opening_stock'] = $messages;
            } else {
                $result['variants'] = $messages;
            }
        }

        return $result;
    }
}
