<?php

namespace App\Modules\Reports\Presentation\Http\Exports;

use App\Modules\Reports\Domain\ColumnType;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Shared\Application\Export\ColumnType as ExportColumnType;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * A report as an X1 list export (`?export=xlsx|pdf|csv` on GET /reports/{key}): the columns
 * the user may see (cost-sensitive ones dropped without `products.view_cost`), the report's
 * filter summary, filename stem `report-<key>` (e.g. report-sales-daily-acme-20261107-1430.csv).
 */
final class ReportExport extends ListExport
{
    /**
     * @param  list<ReportColumn>  $columns
     * @param  list<string>  $filters
     */
    public function __construct(
        private readonly ReportDefinition $definition,
        private readonly array $columns,
        private readonly array $filters,
    ) {}

    public function name(): string
    {
        return 'report-'.Str::slug(str_replace('_', '-', $this->definition->key));
    }

    public function title(): string
    {
        return $this->definition->title;
    }

    public function columns(): array
    {
        return array_map(fn (ReportColumn $c) => new ExportColumn($c->key, $c->label, match ($c->type) {
            ColumnType::Money => ExportColumnType::Money,
            ColumnType::Quantity => ExportColumnType::Quantity,
            ColumnType::Number, ColumnType::Percent => ExportColumnType::Number,
            ColumnType::Date => ExportColumnType::Date,
            ColumnType::DateTime => ExportColumnType::DateTime,
            ColumnType::Text => ExportColumnType::Text,
        }), $this->columns);
    }

    public function filters(Request $request): array
    {
        return $this->filters;
    }
}
