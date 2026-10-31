<?php

namespace App\Modules\Shared\Infrastructure\Persistence;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Deletes a row and turns a foreign-key violation into a readable business error.
 * The database (ON DELETE RESTRICT) is the source of truth for "is it still used?",
 * so modules need not know who references their rows.
 */
final class ReferentialIntegrity
{
    public static function deleteOrFail(Model $model, string $label): void
    {
        try {
            // Savepoint, so a failed delete does not poison an outer PostgreSQL transaction.
            DB::transaction(fn () => $model->delete());
        } catch (QueryException $e) {
            if (self::isForeignKeyViolation($e)) {
                throw new BusinessRuleViolation('IN_USE', "This {$label} is still in use and cannot be deleted. Deactivate it instead.");
            }
            throw $e;
        }
    }

    private static function isForeignKeyViolation(QueryException $e): bool
    {
        // PostgreSQL: 23503 foreign_key_violation. SQLite/MySQL report the generic 23000.
        return in_array($e->getCode(), ['23503', '23000'], true)
            && (str_contains(strtolower($e->getMessage()), 'foreign key') || $e->getCode() === '23503');
    }
}
