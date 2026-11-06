<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Infrastructure\Models\StockReorderRule;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Per-store reorder rules (SC1): bulk upsert by (store, variant) and delete. Rules are only
 * for stock-tracked variants of the organization; whole-unit products take whole quantities.
 */
class ManageReorderRules
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly ProductDirectory $products,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  list<array{variant_id: string, min_qty: string, max_qty?: ?string, is_active?: ?bool}>  $rules
     * @return Collection<int, StockReorderRule> the saved rules in input order
     */
    public function upsert(TenantUser $actor, string $storeId, array $rules): Collection
    {
        $organizationId = $this->tenant->requireOrganization();
        $store = $this->storeAccess->require($actor, $storeId);
        $rules = array_values($rules);
        $variants = $this->products->variants($organizationId, array_column($rules, 'variant_id'));

        $errors = [];
        foreach ($rules as $i => $rule) {
            $variant = $variants[$rule['variant_id']] ?? null;
            if ($variant === null) {
                $errors["rules.{$i}.variant_id"] = ['This product does not exist.'];

                continue;
            }
            if (! $variant['track_stock']) {
                $errors["rules.{$i}.variant_id"] = ["{$variant['product_name']} does not track stock."];
            }
            if (isset($rule['max_qty']) && Decimal::compare($rule['max_qty'], $rule['min_qty']) < 0) {
                $errors["rules.{$i}.max_qty"] = ['The maximum must be at least the minimum.'];
            }
            foreach (['min_qty', 'max_qty'] as $field) {
                if (! $variant['allow_decimal'] && isset($rule[$field]) && ! Decimal::isWhole($rule[$field])) {
                    $errors["rules.{$i}.{$field}"] = ["{$variant['product_name']} is counted in whole units ({$variant['unit_code']})."];
                }
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($organizationId, $store, $rules) {
            $existing = StockReorderRule::query()->where('store_id', $store['id'])
                ->whereIn('variant_id', array_column($rules, 'variant_id'))
                ->lockForUpdate()->get()->keyBy('variant_id');

            $saved = collect();
            foreach ($rules as $rule) {
                $model = $existing->get($rule['variant_id']) ?? new StockReorderRule([
                    'organization_id' => $organizationId,
                    'branch_id' => $store['branch_id'],
                    'store_id' => $store['id'],
                    'variant_id' => $rule['variant_id'],
                ]);
                $model->fill([
                    'min_qty' => Decimal::round($rule['min_qty'], 3),
                    'max_qty' => isset($rule['max_qty']) ? Decimal::round($rule['max_qty'], 3) : null,
                    'is_active' => $rule['is_active'] ?? true,
                ])->save();
                $saved->push($model);
            }

            $this->audit->record('reorder_rules.saved', context: ['store_id' => $store['id'], 'rules' => count($rules)]);

            return $saved;
        });
    }

    public function delete(TenantUser $actor, StockReorderRule $rule): void
    {
        if (! $actor->canAccessBranch($rule->branch_id)) {
            throw new NotFoundHttpException;
        }

        DB::transaction(function () use ($rule) {
            $rule->delete();
            $this->audit->record('reorder_rule.deleted', $rule, old: ['store_id' => $rule->store_id, 'variant_id' => $rule->variant_id, 'min_qty' => $rule->min_qty, 'max_qty' => $rule->max_qty]);
        });
    }
}
