<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Products\Infrastructure\Models\ProductBarcode;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Resolves a scanned or typed code to a variant: exact barcode first, then SKU
 * (case-insensitive). Used by the POS terminal and purchasing screens.
 */
class FindSellableVariant
{
    public function __invoke(string $code): ProductVariant
    {
        $code = trim($code);

        $variant = ProductBarcode::query()->where('barcode', $code)->with('variant')->first()?->variant
            ?? ProductVariant::query()->where(DB::raw('lower(sku)'), mb_strtolower($code))->first();

        $product = $variant?->product()->withTrashed()->first();
        if ($variant === null || $product === null) {
            throw new NotFoundHttpException;
        }

        if ($product->trashed() || ! $product->is_active || ! $variant->is_active) {
            throw new BusinessRuleViolation('PRODUCT_NOT_SELLABLE', "“{$product->name}” is archived or inactive.", ['product_id' => $product->id]);
        }

        return $variant->setRelation('product', $product);
    }
}
