<?php

namespace App\Modules\Products\Presentation\Http\Resources;

use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductImage;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Product with variants, barcodes and images. Catalog references are embedded from the
 * Catalog module's directory ($catalog). Purchase prices are only included for users
 * allowed to see costs.
 *
 * @mixin Product
 */
class ProductResource extends JsonResource
{
    /**
     * @param  array{categories: array<string, mixed>, brands: array<string, mixed>, units: array<string, mixed>, tax_rates: array<string, mixed>}  $catalog
     */
    public function __construct(
        Product $product,
        private readonly array $catalog,
        private readonly bool $withCost,
        /**
         * P1a: per-variant data of the product page (null in lists): compare-at price, open
         * back-in-stock requests and stock (null without inventory.view).
         *
         * @var array{compare_at: array<string, ?string>, back_in_stock: array<string, int>, stock: array<string, array<string, mixed>>|null}|null
         */
        private readonly ?array $extras = null,
    ) {
        parent::__construct($product);
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'type' => $this->type->value,
            'category' => $this->category_id ? ($this->catalog['categories'][$this->category_id] ?? null) : null,
            'brand' => $this->brand_id ? ($this->catalog['brands'][$this->brand_id] ?? null) : null,
            'unit' => $this->catalog['units'][$this->unit_id] ?? null,
            'tax_rate' => $this->tax_rate_id ? ($this->catalog['tax_rates'][$this->tax_rate_id] ?? null) : null,
            'track_stock' => $this->track_stock,
            'track_batches' => $this->track_batches,
            'track_serials' => $this->track_serials,
            'max_discount_percent' => $this->max_discount_percent,
            'options' => $this->options,
            // P1a: photos by colour and swatch styles.
            'photo_option' => $this->photo_option,
            'option_styles' => (object) ($this->option_styles ?? []),
            'option_images' => $this->whenLoaded('optionImages', fn () => (object) $this->optionImageIds()),
            'is_active' => $this->is_active,
            'archived_at' => $this->deleted_at?->toIso8601String(),
            'variants' => $this->variants->map(fn (ProductVariant $v) => $this->variant($v))->values(),
            'images' => $this->whenLoaded('images', fn () => $this->images->map(fn (ProductImage $i) => [
                'id' => $i->id,
                'url' => $i->url(),
                'original_name' => $i->original_name,
            ])->values()),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function variant(ProductVariant $variant): array
    {
        $data = [
            'id' => $variant->id,
            'sku' => $variant->sku,
            'name' => $variant->name,
            'option_values' => (object) $variant->option_values,
            'purchase_price' => $variant->purchase_price,
            'selling_price' => $variant->selling_price,
            'wholesale_price' => $variant->wholesale_price,
            'reorder_level' => $variant->reorder_level,
            'barcodes' => $variant->barcodes->pluck('barcode')->values(),
            'is_active' => $variant->is_active,
        ];

        if (! $this->withCost) {
            unset($data['purchase_price']);
        }
        if ($this->extras !== null) {
            $data['compare_at_price'] = $this->extras['compare_at'][$variant->id] ?? null;
            $data['back_in_stock_open'] = $this->extras['back_in_stock'][$variant->id] ?? 0;
            $data['stock'] = $this->track_stock ? ($this->extras['stock'][$variant->id] ?? null) : null;
        }

        return $data;
    }

    /**
     * Image ids per value of the photo option (values of other options or no longer defined
     * are left out).
     *
     * @return array<string, list<string>>
     */
    private function optionImageIds(): array
    {
        $option = null;
        foreach ($this->options ?? [] as $o) {
            if ($this->photo_option !== null && mb_strtolower($o['name']) === mb_strtolower($this->photo_option)) {
                $option = $o;
            }
        }
        if ($option === null) {
            return [];
        }
        $values = [];
        foreach ($option['values'] as $value) {
            $values[mb_strtolower((string) $value)] = (string) $value;
        }

        $result = [];
        foreach ($this->optionImages as $row) {
            $value = $values[mb_strtolower($row->option_value)] ?? null;
            if ($value !== null && mb_strtolower($row->option_name) === mb_strtolower($option['name'])) {
                $result[$value][] = $row->image_id;
            }
        }

        return $result;
    }
}
