<?php

namespace App\Modules\Imports\Domain;

/**
 * What a row does (dry run) or did (run).
 */
enum RowAction: string
{
    case Create = 'create';
    case Update = 'update';
    case Skip = 'skip';
    case Error = 'error';
}
