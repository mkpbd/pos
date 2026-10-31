<?php

namespace App\Modules\Media\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Persistence\ReferentialIntegrity;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Deletes a media item nobody uses: references kept in JSON settings are checked
 * through the tagged MediaReferences implementations, foreign keys by the database.
 * Files are removed only after the row is gone.
 */
class DeleteMedia
{
    public function __construct(
        private readonly AuditTrail $audit,
        private readonly Container $container,
    ) {}

    public function __invoke(Media $media): void
    {
        /** @var iterable<MediaReferences> $references */
        $references = $this->container->tagged(MediaReferences::TAG);
        foreach ($references as $reference) {
            if ($reference->uses($media->id)) {
                throw new BusinessRuleViolation('IN_USE', 'This image is still in use and cannot be deleted.');
            }
        }

        DB::transaction(function () use ($media) {
            ReferentialIntegrity::deleteOrFail($media, 'image');
            $this->audit->record('media.deleted', $media, ['original_name' => $media->original_name]);
        });

        Storage::disk($media->disk)->delete($media->files());
    }
}
