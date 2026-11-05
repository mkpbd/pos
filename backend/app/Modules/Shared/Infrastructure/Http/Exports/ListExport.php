<?php

namespace App\Modules\Shared\Infrastructure\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * Definition of one exportable admin list: the filename stem / audit name, the title, the
 * columns (dot paths into the rows the list endpoint presents) and the human-readable
 * summary of the request's filters. Resolved from the container, so definitions may inject
 * directories to turn filter ids into names.
 */
abstract class ListExport
{
    /** Filename stem and audit list name, e.g. "sales" → sales-acme-20261105-1430.xlsx. */
    abstract public function name(): string;

    abstract public function title(): string;

    /**
     * @return list<ExportColumn>
     */
    abstract public function columns(): array;

    /**
     * "Label: value" lines describing the active filters (search included).
     *
     * @return list<string>
     */
    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->all();
    }
}
