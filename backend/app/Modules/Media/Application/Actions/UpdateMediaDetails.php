<?php

namespace App\Modules\Media\Application\Actions;

use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\DB;

/**
 * Alt text and (B11) the focal point of a media item — no new file. Only the fields given
 * change; a change is audited with its old and new values.
 */
class UpdateMediaDetails
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array{alt?: ?string, focal_x?: ?int, focal_y?: ?int}  $data  validated
     */
    public function __invoke(Media $media, array $data): Media
    {
        return DB::transaction(function () use ($media, $data) {
            $fields = array_intersect_key($data, array_flip(['alt', 'focal_x', 'focal_y']));
            if (array_key_exists('focal_x', $fields) || array_key_exists('focal_y', $fields)) {
                // Both or neither: a half point means "centre".
                $x = $fields['focal_x'] ?? null;
                $y = $fields['focal_y'] ?? null;
                [$fields['focal_x'], $fields['focal_y']] = $x === null || $y === null ? [null, null] : [(int) $x, (int) $y];
            }

            $old = array_intersect_key($media->only(array_keys($fields)), $fields);
            $media->fill($fields);
            $changed = array_keys($media->getDirty());
            $media->save();

            if ($changed !== []) {
                $this->audit->record('media.updated', $media, array_intersect_key($old, array_flip($changed)), $media->only($changed));
            }

            return $media;
        });
    }
}
