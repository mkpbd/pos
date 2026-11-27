<?php

namespace App\Modules\Inventory\Domain;

/**
 * ST2d: where one serial-numbered unit is. Only `in_stock` units count as on hand at
 * their store; `in_transit` units keep their source store; the rest have left the business
 * (store null).
 */
enum SerialStatus: string
{
    case InStock = 'in_stock';
    case InTransit = 'in_transit';
    case Sold = 'sold';
    case ReturnedToSupplier = 'returned_to_supplier';
    case WrittenOff = 'written_off';
}
