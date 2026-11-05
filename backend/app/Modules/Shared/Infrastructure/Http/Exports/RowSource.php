<?php

namespace App\Modules\Shared\Infrastructure\Http\Exports;

use Closure;
use Generator;
use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * The rows of an export and how many there are (counted first, so limits apply before any
 * row is read). Query sources stream in chunks — the list's own filtered, sorted query, read
 * page by page with a primary-key tie-breaker — and each chunk goes through the same
 * presenter as the JSON list, so exported values are exactly what the screen shows.
 */
final class RowSource
{
    /**
     * @param  Closure(): iterable<array<string, mixed>>  $rows
     */
    private function __construct(
        public readonly int $total,
        private readonly Closure $rows,
    ) {}

    /**
     * @param  EloquentBuilder<*>|QueryBuilder  $query  filtered and sorted (ListQuery::apply)
     * @param  Closure(Collection<int, mixed>): iterable<mixed>  $present  a chunk of models → presented rows
     */
    public static function fromQuery(EloquentBuilder|QueryBuilder $query, Closure $present, ?int $chunk = null): self
    {
        $chunk ??= max(1, (int) config('exports.chunk_size', 500));
        $total = ($query instanceof EloquentBuilder ? (clone $query)->toBase() : clone $query)->getCountForPagination();

        $ordered = clone $query;
        if ($ordered instanceof EloquentBuilder && empty($ordered->toBase()->groups)) {
            $key = $ordered->getModel()->getQualifiedKeyName();
            $orders = collect($ordered->toBase()->orders ?? [])->pluck('column')->all();
            if (! in_array($key, $orders, true) && ! in_array($ordered->getModel()->getKeyName(), $orders, true)) {
                $ordered->orderBy($key);
            }
        }

        return new self($total, function () use ($ordered, $present, $chunk, $total): Generator {
            $emitted = 0;
            for ($page = 1; $emitted < $total; $page++) {
                $models = (clone $ordered)->forPage($page, $chunk)->get();
                if ($models->isEmpty()) {
                    return;
                }
                foreach ($present(collect($models->all())) as $row) {
                    if ($emitted >= $total) {
                        return;
                    }
                    $emitted++;
                    yield self::normalize($row);
                }
                if ($models->count() < $chunk) {
                    return;
                }
            }
        });
    }

    /**
     * Rows already computed by the list (statements, reports — bounded by their own period).
     *
     * @param  iterable<mixed>  $rows
     */
    public static function fromRows(iterable $rows): self
    {
        $rows = $rows instanceof Collection ? $rows->values()->all() : (is_array($rows) ? array_values($rows) : iterator_to_array($rows, false));

        return new self(count($rows), function () use ($rows): Generator {
            foreach ($rows as $row) {
                yield self::normalize($row);
            }
        });
    }

    /**
     * @return iterable<array<string, mixed>>
     */
    public function rows(): iterable
    {
        return ($this->rows)();
    }

    /**
     * @return Closure(): iterable<array<string, mixed>>
     */
    public function stream(): Closure
    {
        return $this->rows;
    }

    /**
     * @return array<string, mixed>
     */
    private static function normalize(mixed $row): array
    {
        return match (true) {
            $row instanceof JsonResource => $row->resolve(request()),
            $row instanceof Arrayable => $row->toArray(),
            is_object($row) => (array) $row,
            default => (array) $row,
        };
    }
}
