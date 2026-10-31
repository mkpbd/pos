<?php

namespace App\Modules\Shared\Infrastructure\Persistence\Concerns;

use App\Modules\Shared\Application\Support\StaffActor;
use Illuminate\Database\Eloquent\Model;

/**
 * Fills created_by / updated_by with the acting staff user's id (never a shopper's).
 *
 * @mixin Model
 */
trait TracksAuthor
{
    public static function bootTracksAuthor(): void
    {
        static::creating(function (Model $model) {
            $userId = StaffActor::id();
            $model->created_by ??= $userId;
            $model->updated_by ??= $userId;
        });

        static::updating(function (Model $model) {
            if ($userId = StaffActor::id()) {
                $model->updated_by = $userId;
            }
        });
    }
}
