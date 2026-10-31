<?php

namespace App\Modules\Shared\Infrastructure\Http\Queries;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Applies the API list conventions: ?search=, ?sort=(-)column, ?page=, ?per_page= (max 100).
 * Only whitelisted columns can be searched or sorted.
 */
final class ListQuery
{
    public const MAX_PER_PAGE = 100;

    /**
     * @param  list<string>  $sortable
     * @param  list<string>  $searchable
     */
    public static function paginate(
        Builder $query,
        Request $request,
        array $sortable,
        array $searchable = [],
        string $defaultSort = '-created_at',
    ): LengthAwarePaginator {
        $search = trim((string) $request->query('search', ''));
        if ($search !== '' && $searchable !== []) {
            $query->where(function (Builder $q) use ($search, $searchable) {
                foreach ($searchable as $column) {
                    $q->orWhereLike($column, '%'.addcslashes($search, '%_\\').'%');
                }
            });
        }

        $sort = (string) $request->query('sort', $defaultSort);
        $column = ltrim($sort, '-');
        if (! in_array($column, $sortable, true)) {
            throw ValidationException::withMessages(['sort' => ["Sorting by [{$column}] is not supported."]]);
        }
        $query->orderBy($column, str_starts_with($sort, '-') ? 'desc' : 'asc');

        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $request->query('per_page', 25)));

        return $query->paginate($perPage);
    }
}
