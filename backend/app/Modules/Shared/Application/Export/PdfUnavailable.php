<?php

namespace App\Modules\Shared\Application\Export;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * PDF rendering is not possible on this server right now (503 PDF_UNAVAILABLE).
 */
final class PdfUnavailable extends BusinessRuleViolation
{
    public function __construct(string $message = 'PDF export is not available right now. Try Excel instead, or ask an administrator to install Chrome for PDF rendering.')
    {
        parent::__construct('PDF_UNAVAILABLE', $message, [], 503);
    }
}
