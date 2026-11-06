<?php

namespace App\Modules\Shared\Application\Export;

enum ExportFormat: string
{
    case Xlsx = 'xlsx';
    case Pdf = 'pdf';
    /** Phase 7: UTF-8 with BOM, RFC 4180, formula-injection guard (CsvExportWriter). */
    case Csv = 'csv';

    public function contentType(): string
    {
        return match ($this) {
            self::Xlsx => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            self::Pdf => 'application/pdf',
            self::Csv => 'text/csv; charset=UTF-8',
        };
    }

    public function label(): string
    {
        return match ($this) {
            self::Xlsx => 'Excel',
            self::Pdf => 'PDF',
            self::Csv => 'CSV',
        };
    }
}
