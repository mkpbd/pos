<?php

namespace App\Modules\Shared\Infrastructure\Persistence;

use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;

/**
 * G1c: runs a query once per chunk of a long `IN (…)` list and concatenates the rows.
 *
 * PostgreSQL's wire protocol allows at most 65 535 bound parameters per statement, so a
 * `whereIn` over every variant / product / customer of a large organization fails
 * ("number of parameters must be between 0 and 65535"). Chunks of {@see self::SIZE} stay
 * far below the limit; the query must not order, group, limit or aggregate across chunks.
 */
final class WhereInChunks
{
    public const SIZE = 10_000;

    /**
     * @template TQuery of Builder|EloquentBuilder
     *
     * @param  TQuery  $query
     * @param  iterable<mixed>  $values
     * @param  list<string>|string  $columns
     * @return Collection<int, mixed>
     */
    public static function get(Builder|EloquentBuilder $query, string $column, iterable $values, array|string $columns = ['*']): Collection
    {
        $values = array_values(array_unique(is_array($values) ? $values : iterator_to_array($values, false)));
        if ($values === []) {
            return self::wrap($query, []);
        }
        if (count($values) <= self::SIZE) {
            return self::wrap($query, $query->whereIn($column, $values)->get($columns)->all());
        }

        $rows = [];
        foreach (array_chunk($values, self::SIZE) as $chunk) {
            array_push($rows, ...(clone $query)->whereIn($column, $chunk)->get($columns)->all());
        }

        return self::wrap($query, $rows);
    }

    /**
     * @param  list<mixed>  $rows
     * @return Collection<int, mixed>
     */
    private static function wrap(Builder|EloquentBuilder $query, array $rows): Collection
    {
        return $query instanceof EloquentBuilder ? $query->getModel()->newCollection($rows) : collect($rows);
    }
}
