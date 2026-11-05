<?php

namespace App\Modules\Shared\Application\Export;

enum ExportFormat: string
{
    case Xlsx = 'xlsx';
    case Pdf = 'pdf';

    public function contentType(): string
    {
        return match ($this) {
            self::Xlsx => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            self::Pdf => 'application/pdf',
        };
    }
}
