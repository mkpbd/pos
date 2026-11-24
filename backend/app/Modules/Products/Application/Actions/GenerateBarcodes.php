<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductBarcode;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

/**
 * ST1: gives variants an in-store EAN-13 barcode: "20" (GS1 prefix 20–29 is reserved for
 * in-store numbers, never issued to manufacturers) + the organization's 10-digit sequence
 * `barcode_ean13` + the GS1 check digit. Variants that already have a barcode keep it unless
 * `overwrite` (then their barcodes are replaced). A number someone typed in by hand is skipped,
 * so codes stay unique per organization. One audit entry per product.
 */
class GenerateBarcodes
{
    public const MAX_VARIANTS = 500;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  list<string>  $variantIds
     * @return list<array{variant_id: string, barcode: ?string, generated: bool}> in the given order
     */
    public function __invoke(array $variantIds, bool $overwrite = false): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $variantIds = array_values(array_unique($variantIds));

        return DB::transaction(function () use ($organizationId, $variantIds, $overwrite) {
            $variants = ProductVariant::query()->where('organization_id', $organizationId)
                ->whereKey($variantIds)->with('barcodes')->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $missing = array_values(array_diff($variantIds, $variants->keys()->all()));
            if ($missing !== []) {
                throw ValidationException::withMessages(['variant_ids' => ['Some products do not exist: '.implode(', ', $missing).'.']]);
            }

            $results = [];
            $changes = [];
            foreach ($variantIds as $id) {
                /** @var ProductVariant $variant */
                $variant = $variants[$id];
                $current = $variant->barcodes->sortBy('created_at')->pluck('barcode')->values()->all();
                if ($current !== [] && ! $overwrite) {
                    $results[] = ['variant_id' => $id, 'barcode' => $current[0], 'generated' => false];

                    continue;
                }

                if ($current !== []) {
                    $variant->barcodes()->delete();
                }
                $barcode = $this->nextBarcode($organizationId);
                $variant->barcodes()->create(['organization_id' => $organizationId, 'barcode' => $barcode]);
                $results[] = ['variant_id' => $id, 'barcode' => $barcode, 'generated' => true];
                $changes[$variant->product_id][$variant->sku] = ['old' => $current, 'new' => $barcode];
            }

            foreach ($changes as $productId => $bySku) {
                $product = Product::query()->withTrashed()->find($productId);
                $this->audit->record('product.barcodes_generated', $product,
                    old: ['barcodes' => array_map(fn (array $c) => $c['old'], $bySku)],
                    new: ['barcodes' => array_map(fn (array $c) => [$c['new']], $bySku)],
                );
            }

            return $results;
        });
    }

    private function nextBarcode(string $organizationId): string
    {
        // Normally the first number is free; a hand-typed in-store code may sit on the sequence.
        for ($attempt = 0; $attempt < 1000; $attempt++) {
            $digits = $this->sequences->next($organizationId, 'barcode_ean13', '20', 10);
            if (strlen($digits) !== 12) {
                throw new LogicException('The in-store barcode sequence is exhausted.');
            }
            $barcode = $digits.Barcode::gs1CheckDigit($digits);
            $taken = ProductBarcode::query()->where('organization_id', $organizationId)->where('barcode', $barcode)->exists();
            if (! $taken && Barcode::isValid($barcode)) {
                return $barcode;
            }
        }

        throw new LogicException('No free in-store barcode found.');
    }
}
