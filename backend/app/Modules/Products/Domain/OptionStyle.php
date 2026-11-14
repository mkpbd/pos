<?php

namespace App\Modules\Products\Domain;

/**
 * P1a: how the online store draws the values of a product option. Without a product's own
 * choice the option's attribute display applies (swatch → color, button/text → button).
 */
enum OptionStyle: string
{
    /** Round colour chips (the attribute value's swatch colour). */
    case Color = 'color';
    /** The first photo of each value, cropped square. */
    case Image = 'image';
    case Button = 'button';
}
