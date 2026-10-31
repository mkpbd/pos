<?php

namespace App\Modules\Users\Infrastructure\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Model;

/**
 * A user's membership of a branch (branch_user pivot).
 *
 * @property string $branch_id
 * @property string $user_id
 */
#[Table(name: 'branch_user', key: false, incrementing: false, timestamps: false)]
#[Fillable(['branch_id', 'user_id'])]
class BranchMembership extends Model {}
