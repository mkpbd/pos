<?php

namespace App\Modules\Products\Application\Queries;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Products\Application\Contracts\LabelSources;
use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Collection;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ST1: what a price / shelf label prints for each variant — name, variant, SKU, the barcode and
 * how to draw it (EAN-13, EAN-8, UPC-A when the digits and check digit fit, else Code 128; no
 * barcode: Code 128 of the SKU), selling price, unit — and how many labels: the received quantity
 * of a goods receipt line (with its batch and expiry), the ordered quantity of a purchase order
 * line, 1 otherwise (decimal-unit goods such as kg get one label per line).
 */
final class LabelData
{
    public const MAX_LABELS = 2000;

    public function __construct(
        private readonly LabelSources $sources,
        private readonly CatalogDirectory $catalog,
        private readonly OrganizationDirectory $organizations,
    ) {}

    /**
     * @param  array{variant_ids?: list<string>, goods_receipt_id?: string, purchase_order_id?: string, category_id?: string}  $source
     * @return array{shop: array{name: string, currency: string}, labels: list<array<string, mixed>>}
     */
    public function __invoke(TenantUser $user, string $organizationId, array $source): array
    {
        $lines = match (true) {
            isset($source['goods_receipt_id']) => $this->sources->goodsReceiptLines($user, $organizationId, $source['goods_receipt_id'])
                ?? throw new NotFoundHttpException('Goods receipt not found.'),
            isset($source['purchase_order_id']) => $this->sources->purchaseOrderLines($user, $organizationId, $source['purchase_order_id'])
                ?? throw new NotFoundHttpException('Purchase order not found.'),
            isset($source['category_id']) => $this->categoryLines($organizationId, $source['category_id']),
            default => array_map(fn (string $id) => ['variant_id' => $id, 'quantity' => null, 'batch_number' => null, 'expires_on' => null], array_values(array_unique($source['variant_ids'] ?? []))),
        };
        if (count($lines) > self::MAX_LABELS) {
            throw new BusinessRuleViolation('LABELS_TOO_MANY', 'At most '.self::MAX_LABELS.' products can be labelled at once.', ['max' => self::MAX_LABELS]);
        }

        $variants = $this->variants($organizationId, array_values(array_unique(array_column($lines, 'variant_id'))));
        $units = $this->catalog->describe($organizationId, ['units' => $variants->pluck('product.unit_id')->filter()->unique()->values()->all()])['units'];
        $summary = $this->organizations->summary($organizationId);
        $currency = $summary['base_currency'] ?? (string) config('pos.default_currency', 'BDT');

        $labels = [];
        foreach ($lines as $line) {
            /** @var ProductVariant|null $variant */
            $variant = $variants->get($line['variant_id']);
            if ($variant === null) {
                continue; // another organization's id, or a variant deleted since
            }
            $unit = $units[$variant->product->unit_id] ?? null;
            $barcode = $variant->barcodes->sortBy(['created_at', 'id'])->first()?->barcode;
            $labels[] = [
                'variant_id' => $variant->id,
                'product_name' => $variant->product->name,
                'variant_name' => self::variantName($variant),
                'sku' => $variant->sku,
                'barcode' => $barcode,
                'barcode_format' => self::format($barcode),
                'price' => (string) $variant->selling_price,
                'currency' => $currency,
                'unit' => $unit['code'] ?? null,
                'quantity' => self::quantity($line['quantity'], (bool) ($unit['allow_decimal'] ?? false)),
                'batch_number' => $line['batch_number'],
                'expires_on' => $line['expires_on'],
            ];
        }

        return ['shop' => ['name' => $summary['name'] ?? '', 'currency' => $currency], 'labels' => $labels];
    }

    /**
     * ean13 | ean8 | upca when the code is all digits of that length with a valid GS1 check
     * digit, else code128 (also when there is no barcode: the SKU is printed as Code 128).
     */
    public static function format(?string $barcode): string
    {
        if ($barcode === null || ! ctype_digit($barcode)) {
            return 'code128';
        }
        $valid = Barcode::gs1CheckDigit(substr($barcode, 0, -1)) === (int) substr($barcode, -1);

        return match (true) {
            ! $valid => 'code128',
            strlen($barcode) === 13 => 'ean13',
            strlen($barcode) === 8 => 'ean8',
            strlen($barcode) === 12 => 'upca',
            default => 'code128',
        };
    }

    private static function quantity(?string $quantity, bool $allowDecimal): int
    {
        if ($quantity === null || $allowDecimal || ! Decimal::isWhole($quantity) || Decimal::compare($quantity, '1') < 0) {
            return 1;
        }

        return (int) Decimal::round($quantity, 0);
    }

    private static function variantName(ProductVariant $variant): ?string
    {
        if ($variant->name !== null && $variant->name !== '') {
            return $variant->name;
        }
        $values = array_values($variant->option_values ?: []);

        return $values === [] ? null : implode(' / ', $values);
    }

    /**
     * @return list<array{variant_id: string, quantity: null, batch_number: null, expires_on: null}>
     */
    private function categoryLines(string $organizationId, string $categoryId): array
    {
        $categories = $this->catalog->categoryWithDescendants($organizationId, $categoryId);
        if ($categories === []) {
            throw new NotFoundHttpException('Category not found.');
        }

        return ProductVariant::query()->where('product_variants.organization_id', $organizationId)
            ->where('product_variants.is_active', true)
            ->whereHas('product', fn ($q) => $q->whereIn('category_id', $categories)->where('is_active', true))
            ->join('products', 'products.id', '=', 'product_variants.product_id')
            ->orderBy('products.name')->orderBy('product_variants.sort_order')
            ->limit(self::MAX_LABELS + 1)
            ->pluck('product_variants.id')
            ->map(fn (string $id) => ['variant_id' => $id, 'quantity' => null, 'batch_number' => null, 'expires_on' => null])
            ->all();
    }

    /**
     * Live variants of the organization (archived products included: their stock may still
     * need a label), keyed by id.
     *
     * @param  list<string>  $ids
     * @return Collection<string, ProductVariant>
     */
    private function variants(string $organizationId, array $ids): Collection
    {
        $ids = array_values(array_filter($ids, fn ($id) => is_string($id) && preg_match('/^[0-9a-f-]{36}$/i', $id) === 1));
        if ($ids === []) {
            return collect();
        }

        return ProductVariant::query()->where('organization_id', $organizationId)->whereKey($ids)
            ->with(['barcodes', 'product' => fn ($q) => $q->withTrashed()])
            ->get()->keyBy('id');
    }
}
