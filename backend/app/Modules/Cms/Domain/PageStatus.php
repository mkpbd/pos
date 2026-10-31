<?php

namespace App\Modules\Cms\Domain;

enum PageStatus: string
{
    case Draft = 'draft';
    case Published = 'published';
}
