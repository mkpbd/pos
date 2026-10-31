<?php

namespace App\Modules\Branches\Application\Actions;

use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use Illuminate\Support\Facades\DB;

/**
 * Creates a store in a branch, or updates an existing store.
 */
class SaveStore
{
    private const AUDITED = ['code', 'name', 'type', 'is_active'];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array<string, mixed>  $data  validated attributes
     */
    public function __invoke(Branch $branch, ?Store $store, array $data): Store
    {
        return DB::transaction(function () use ($branch, $store, $data) {
            $creating = $store === null;
            $store ??= new Store(['branch_id' => $branch->id, 'organization_id' => $branch->organization_id]);
            $before = $creating ? [] : $this->snapshot($store);

            if (isset($data['code'])) {
                $data['code'] = mb_strtoupper($data['code']);
            }
            $store->fill($data)->save();

            [$old, $new] = Changes::between($before, $this->snapshot($store));
            if ($new !== []) {
                $this->audit->record($creating ? 'store.created' : 'store.updated', $store, $old, $new);
            }

            return $store;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Store $store): array
    {
        $values = $store->only(self::AUDITED);
        $values['type'] = $store->type?->value;

        return $values;
    }
}
