<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Http\Request;

/**
 * Shared vocabulary of the Inventory module's exports: branch, store and product filters by
 * name, the product / variant / SKU columns and user names.
 */
abstract class InventoryListExport extends ListExport
{
    /** @var array<string, ?string> */
    private array $userNames = [];

    public function __construct(
        protected readonly TenantContext $tenant,
        protected readonly BranchDirectory $branches,
        protected readonly ProductDirectory $products,
        protected readonly UserDirectory $users,
    ) {}

    protected function summary(Request $request): FilterSummary
    {
        $org = $this->tenant->requireOrganization();

        return FilterSummary::of($request)
            ->search()
            ->lookup('branch_id', 'Branch', fn (string $id) => $this->branches->profile($id, $org)['name'] ?? null)
            ->lookup('store_id', 'Store', fn (string $id) => $this->branches->store($id, $org)['name'] ?? null)
            ->lookup('variant_id', 'Product', function (string $id) use ($org) {
                $variant = $this->products->variants($org, [$id])[$id] ?? null;

                return $variant === null ? null : trim($variant['product_name'].' '.($variant['variant_name'] ?? ''));
            });
    }

    /**
     * @return list<ExportColumn>
     */
    protected static function productColumns(): array
    {
        return [
            ExportColumn::text('variant.product_name', 'Product'),
            ExportColumn::text('variant.variant_name', 'Variant'),
            ExportColumn::text('variant.sku', 'SKU'),
        ];
    }

    protected function userName(?string $id): ?string
    {
        if ($id === null) {
            return null;
        }
        if (! array_key_exists($id, $this->userNames)) {
            $this->userNames[$id] = $this->users->names($this->tenant->requireOrganization(), [$id])[$id] ?? null;
        }

        return $this->userNames[$id];
    }
}
