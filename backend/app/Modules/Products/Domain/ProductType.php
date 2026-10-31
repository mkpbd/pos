<?php

namespace App\Modules\Products\Domain;

enum ProductType: string
{
    /** Physical goods; may track stock, batches and serial numbers. */
    case Standard = 'standard';

    /** Labour, fees, warranties: never stocked. */
    case Service = 'service';
}
