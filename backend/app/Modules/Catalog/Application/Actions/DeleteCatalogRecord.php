<?php

namespace App\Modules\Catalog\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Infrastructure\Persistence\ReferentialIntegrity;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Hard-deletes unused reference data. Anything still referenced (by products,
 * child categories, derived units, …) is refused by the database's RESTRICT
 * foreign keys and reported as IN_USE.
 */
class DeleteCatalogRecord
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(Model $record, string $auditName, string $label): void
    {
        DB::transaction(function () use ($record, $auditName, $label) {
            $snapshot = array_diff_key($record->attributesToArray(), array_flip(['organization_id', 'created_at', 'updated_at', 'created_by', 'updated_by']));
            ReferentialIntegrity::deleteOrFail($record, $label);
            $this->audit->record($auditName.'.deleted', $record, old: $snapshot);
        });
    }
}
