<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\StocktakeScope;
use App\Modules\Inventory\Domain\StocktakeStatus;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ST1: a new stocktake (draft) of one store. Only one stocktake per store may be open (draft or
 * counting) at a time — checked here and guaranteed by a partial unique index.
 */
class CreateStocktake
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly CatalogDirectory $catalog,
        private readonly ProductDirectory $products,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{store_id: string, scope: string, scope_ids?: ?list<string>, blind?: ?bool, notes?: ?string}  $data
     *
     * @throws BusinessRuleViolation STOCKTAKE_OPEN (409)
     */
    public function __invoke(TenantUser $actor, array $data): Stocktake
    {
        $organizationId = $this->tenant->requireOrganization();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $scope = StocktakeScope::from($data['scope']);
        $ids = $scope === StocktakeScope::All ? null : array_values(array_unique(array_map('strtolower', $data['scope_ids'] ?? [])));

        if ($ids !== null) {
            if ($ids === []) {
                throw ValidationException::withMessages(['scope_ids' => ['Choose at least one '.($scope === StocktakeScope::Categories ? 'category.' : 'product.')]]);
            }
            $known = $scope === StocktakeScope::Categories
                ? array_keys($this->catalog->describe($organizationId, ['categories' => $ids])['categories'])
                : array_keys($this->products->products($organizationId, $ids));
            if (count(array_diff($ids, array_map('strtolower', $known))) > 0) {
                throw ValidationException::withMessages(['scope_ids' => [$scope === StocktakeScope::Categories ? 'A selected category does not exist.' : 'A selected product does not exist.']]);
            }
        }

        try {
            return DB::transaction(function () use ($actor, $organizationId, $store, $scope, $ids, $data) {
                $this->assertNoOpenStocktake($store['id']);

                $stocktake = Stocktake::query()->create([
                    'organization_id' => $organizationId,
                    'branch_id' => $store['branch_id'],
                    'store_id' => $store['id'],
                    'number' => $this->sequences->next($organizationId, 'stocktake', 'ST-'),
                    'status' => StocktakeStatus::Draft,
                    'scope' => $scope,
                    'scope_ids' => $ids,
                    'blind' => (bool) ($data['blind'] ?? false),
                    'notes' => filled($data['notes'] ?? null) ? trim((string) $data['notes']) : null,
                    'created_by' => $actor->getAuthIdentifier(),
                ]);

                $this->audit->record('stocktake.created', $stocktake, new: [
                    'number' => $stocktake->number,
                    'store_id' => $store['id'],
                    'scope' => $scope->value,
                    'scope_ids' => $ids,
                    'blind' => $stocktake->blind,
                ]);

                return $stocktake;
            });
        } catch (UniqueConstraintViolationException) {
            // Another request opened one for this store in the meantime.
            $this->assertNoOpenStocktake($store['id']);

            throw new BusinessRuleViolation('STOCKTAKE_OPEN', 'This store already has an open stocktake.', [], 409);
        }
    }

    private function assertNoOpenStocktake(string $storeId): void
    {
        $open = Stocktake::query()->where('store_id', $storeId)->whereIn('status', [StocktakeStatus::Draft, StocktakeStatus::Counting])->first(['id', 'number']);
        if ($open !== null) {
            throw new BusinessRuleViolation('STOCKTAKE_OPEN', "This store already has an open stocktake ({$open->number}): finish or cancel it first.", [
                'stocktake_id' => $open->id,
                'number' => $open->number,
            ], 409);
        }
    }
}
