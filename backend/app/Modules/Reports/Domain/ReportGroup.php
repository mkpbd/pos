<?php

namespace App\Modules\Reports\Domain;

/**
 * Catalog sections of the reports page (and the AI's report tools, Phase 8).
 */
enum ReportGroup: string
{
    case Sales = 'sales';
    case Inventory = 'inventory';
    case Purchasing = 'purchasing';
    case Finance = 'finance';
    case Customers = 'customers';

    public function label(): string
    {
        return match ($this) {
            self::Sales => 'Sales',
            self::Inventory => 'Inventory',
            self::Purchasing => 'Purchasing',
            self::Finance => 'Finance',
            self::Customers => 'Customers',
        };
    }
}
