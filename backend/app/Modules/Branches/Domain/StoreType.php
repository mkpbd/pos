<?php

namespace App\Modules\Branches\Domain;

enum StoreType: string
{
    case Store = 'store';
    case Warehouse = 'warehouse';
}
