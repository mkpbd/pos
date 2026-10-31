<?php

namespace App\Modules\Payments\Domain;

enum SessionStatus: string
{
    case Open = 'open';
    case Closed = 'closed';
}
