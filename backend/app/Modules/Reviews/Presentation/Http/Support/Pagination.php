<?php

namespace App\Modules\Reviews\Presentation\Http\Support;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * The envelope's `meta.pagination` for a page presented in one batch.
 */
final class Pagination
{
    /**
     * @return array{current_page: int, per_page: int, total: int, last_page: int}
     */
    public static function meta(LengthAwarePaginator $page): array
    {
        return [
            'current_page' => $page->currentPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'last_page' => $page->lastPage(),
        ];
    }
}
