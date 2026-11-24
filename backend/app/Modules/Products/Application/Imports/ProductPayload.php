<?php

namespace App\Modules\Products\Application\Imports;

use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductVariant;

/**
 * ST1: an existing product as the full definition SaveProduct expects (ProductData::fromArray),
 * so an import can change a few fields and save the product through the one write path — all
 * its variants are kept (SaveProduct archives variants left out), with their barcodes.
 */
final class ProductPayload
{
    /**
     * @return array<string, mixed>
     */
    public static function of(Product $product): array
    {
        $product->loadMissing('variants.barcodes');

        return [
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
            'options' => $product->options,
            'is_active' => $product->is_active,
            'variants' => $product->variants->map(fn (ProductVariant $v) => self::variant($v))->values()->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function variant(ProductVariant $variant): array
    {
        return [
            'id' => $variant->id,
            'sku' => $variant->sku,
            'name' => $variant->name,
            'option_values' => $variant->option_values ?: [],
            'purchase_price' => $variant->purchase_price,
            'selling_price' => $variant->selling_price,
            'wholesale_price' => $variant->wholesale_price,
            'reorder_level' => $variant->reorder_level,
            'barcodes' => $variant->barcodes->pluck('barcode')->values()->all(),
            'is_active' => $variant->is_active,
        ];
    }
}
