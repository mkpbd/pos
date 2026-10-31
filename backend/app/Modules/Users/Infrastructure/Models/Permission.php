<?php

namespace App\Modules\Users\Infrastructure\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Model;

/**
 * Mirror of the code-declared permission catalog (PermissionRegistry).
 *
 * @property string $name
 * @property string $module
 * @property string $description
 */
#[Table(key: 'name', keyType: 'string', incrementing: false, timestamps: false)]
#[Fillable(['name', 'module', 'description'])]
class Permission extends Model {}
