<?php

namespace App\Modules\Catalog\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Create/update for catalog reference data (brands, tax rates, units, categories)
 * with an audit entry such as "brand.created" / "tax_rate.updated".
 */
class SaveCatalogRecord
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @template T of Model
     *
     * @param  T  $record  new or existing model
     * @param  array<string, mixed>  $attributes  validated attributes
     * @param  string  $auditName  e.g. "brand"
     * @param  (callable(T): void)|null  $beforeSave  domain checks run inside the transaction
     * @return T
     */
    public function __invoke(Model $record, array $attributes, string $auditName, ?callable $beforeSave = null): Model
    {
        return DB::transaction(function () use ($record, $attributes, $auditName, $beforeSave) {
            $creating = ! $record->exists;
            $before = $creating ? [] : $this->snapshot($record);

            $record->fill($attributes);
            if ($beforeSave) {
                $beforeSave($record);
            }
            $record->save();

            [$old, $new] = Changes::between($before, $this->snapshot($record));
            if ($new !== [] || $creating) {
                $this->audit->record($auditName.($creating ? '.created' : '.updated'), $record, $old, $new);
            }

            return $record;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Model $record): array
    {
        return array_diff_key($record->attributesToArray(), array_flip(['id', 'organization_id', 'created_at', 'updated_at', 'created_by', 'updated_by']));
    }
}
