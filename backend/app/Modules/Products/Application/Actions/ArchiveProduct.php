<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\DB;

/**
 * Archiving (soft delete) hides a product from the catalogue and the POS while keeping
 * it for historical documents. Its SKUs and barcodes stay reserved so that restoring
 * it is always possible.
 */
class ArchiveProduct
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function archive(Product $product): void
    {
        DB::transaction(function () use ($product) {
            $product->delete();
            $this->audit->record('product.archived', $product, old: ['name' => $product->name]);
        });
    }

    public function restore(Product $product): Product
    {
        return DB::transaction(function () use ($product) {
            $product->restore();
            $this->audit->record('product.restored', $product, new: ['name' => $product->name]);

            return $product;
        });
    }
}
