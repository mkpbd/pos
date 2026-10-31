<?php

namespace App\Modules\Inventory\Domain;

/**
 * The business document that caused stock movements (adjustment, transfer, receipt, sale…).
 */
final readonly class StockReference
{
    public function __construct(
        public string $type,
        public string $id,
        public ?string $number = null,
    ) {}
}
