<?php

namespace App\Modules\Shared\Infrastructure\Persistence\Concerns;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

/**
 * Fills created_by / updated_by with the authenticated user's id.
 *
 * @mixin Model
 */
trait TracksAuthor
{
    public static function bootTracksAuthor(): void
    {
        static::creating(function (Model $model) {
            $userId = Auth::id();
            $model->created_by ??= $userId;
            $model->updated_by ??= $userId;
        });

        static::updating(function (Model $model) {
            if ($userId = Auth::id()) {
                $model->updated_by = $userId;
            }
        });
    }
}
