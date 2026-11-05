<?php

namespace App\Modules\Shared\Infrastructure\Export;

use App\Modules\Shared\Application\Export\ColumnType;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Export\ExportDocument;
use App\Modules\Shared\Application\Export\PdfRenderer;
use Illuminate\Contracts\View\Factory as ViewFactory;

/**
 * Renders an export as an HTML table (Blade view `exports.list`: letterhead, title, filter
 * summary, generated-at and user, header repeated on every page, embedded fonts) and hands
 * it to the PdfRenderer: A4, landscape above six columns, "Page X of Y" footer.
 */
final class PdfExportWriter
{
    public const LANDSCAPE_ABOVE_COLUMNS = 6;

    public function __construct(
        private readonly PdfRenderer $renderer,
        private readonly ViewFactory $views,
    ) {}

    /**
     * @return array{0: string, 1: int} the PDF bytes and the number of data rows
     */
    public function render(ExportDocument $document): array
    {
        [$html, $count] = $this->html($document);
        $landscape = count($document->columns) > self::LANDSCAPE_ABOVE_COLUMNS;

        return [$this->renderer->render($html, $landscape, self::footer()), $count];
    }

    /**
     * @return array{0: string, 1: int}
     */
    public function html(ExportDocument $document): array
    {
        $rows = [];
        foreach ($document->rows() as $row) {
            $rows[] = array_map(fn (ExportColumn $c) => $this->format($c, $c->valueOf($row), $document->timezone), $document->columns);
        }

        $html = $this->views->make('exports.list', [
            'document' => $document,
            'columns' => $document->columns,
            'rows' => $rows,
            'landscape' => count($document->columns) > self::LANDSCAPE_ABOVE_COLUMNS,
            'fontCss' => PdfFonts::css(),
            'generatedAt' => $document->generatedAt->format('d M Y, H:i').' ('.$document->timezone.')',
        ])->render();

        return [$html, count($rows)];
    }

    private function format(ExportColumn $column, mixed $value, string $timezone): string
    {
        switch ($column->type) {
            case ColumnType::Money:
            case ColumnType::Number:
            case ColumnType::Quantity:
                $decimal = ExportValues::decimal($value);
                if ($decimal === null) {
                    return (string) ExportValues::text($value);
                }

                return match ($column->type) {
                    ColumnType::Money => ExportValues::grouped($decimal, 2),
                    ColumnType::Quantity => ExportValues::quantity($decimal),
                    default => str_contains($decimal, '.') ? ExportValues::quantity($decimal) : ExportValues::grouped($decimal, 0),
                };
            case ColumnType::Date:
            case ColumnType::DateTime:
                $instant = ExportValues::instant($value, $timezone);
                if ($instant === null) {
                    return (string) ExportValues::text($value);
                }

                return $instant->format($column->type === ColumnType::Date ? 'd M Y' : 'd M Y, H:i');
            case ColumnType::Status:
                return (string) ExportValues::status($value);
            default:
                return (string) ExportValues::text($value);
        }
    }

    private static function footer(): string
    {
        return '<div style="width:100%;font-size:8px;color:#555;text-align:right;padding:0 10mm;font-family:sans-serif">'
            .'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>';
    }
}
