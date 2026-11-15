<?php

namespace App\Modules\Media\Application\Actions;

use App\Modules\Media\Domain\ImageEdit;
use App\Modules\Media\Infrastructure\Imaging\GdImageProcessor;
use App\Modules\Media\Infrastructure\Jobs\GenerateMediaRenditions;
use App\Modules\Media\Infrastructure\MediaUsage;
use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * B11: the picture editor's save. The edit runs on the stored original with GD.
 *
 * - `copy` (the default) adds a new media item next to the original (`edited_from_id`), with
 *   the original's alt text; identical bytes already in the library are returned instead.
 * - `replace` swaps the file under the same id, so every place using the picture shows the
 *   edited one. The new file gets a new name (no stale browser or CDN copies), renditions are
 *   made again, and the old files are deleted after commit. A picture in use is replaced only
 *   when the caller confirms (`IN_USE` with the places otherwise).
 *
 * The focal point given is in percent of the edited picture; without one, the original's is
 * kept when the picture's shape did not change and dropped otherwise.
 */
class EditMedia
{
    public function __construct(
        private readonly AuditTrail $audit,
        private readonly GdImageProcessor $images,
        private readonly MediaUsage $usage,
    ) {}

    /**
     * @param  array{x: int, y: int}|null  $focal
     * @return array{media: Media, created: bool}
     */
    public function __invoke(Media $media, ImageEdit $edit, string $mode, bool $confirmReplace, ?array $focal): array
    {
        $edit = $edit->forSource($media->width, $media->height);
        if (! $edit->changesPixels()) {
            throw new BusinessRuleViolation('NO_CHANGES', 'Nothing was changed in the picture.');
        }
        if ($mode === 'replace' && ! $confirmReplace) {
            $places = $this->usage->places($media->id);
            if ($places !== []) {
                throw new BusinessRuleViolation('IN_USE', 'This picture is used in your store. Confirm to replace it everywhere, or save a new copy.', ['places' => $places]);
            }
        }

        $disk = Storage::disk($media->disk);
        $source = $disk->get($media->path);
        if (! is_string($source)) {
            throw new BusinessRuleViolation('INVALID_IMAGE', 'The original file of this picture is missing.');
        }
        $result = $this->images->edit($source, $media->mime_type, $media->width, $media->height, $edit);
        $focal ??= $edit->changesGeometry() ? null : $media->focal();

        return $mode === 'replace'
            ? $this->replace($media, $edit, $result, $focal)
            : $this->copy($media, $edit, $result, $focal);
    }

    /**
     * @param  array{bytes: string, width: int, height: int}  $result
     * @param  array{x: int, y: int}|null  $focal
     * @return array{media: Media, created: bool}
     */
    private function copy(Media $media, ImageEdit $edit, array $result, ?array $focal): array
    {
        $checksum = hash('sha256', $result['bytes']);
        $existing = Media::query()->where('checksum', $checksum)->first();
        if ($existing !== null) {
            return ['media' => $existing, 'created' => false];
        }

        $id = (string) Str::uuid7();
        $path = dirname($media->path).'/'.$id.'.'.pathinfo($media->path, PATHINFO_EXTENSION);
        Storage::disk($media->disk)->put($path, $result['bytes']);

        try {
            $copy = DB::transaction(function () use ($media, $edit, $result, $focal, $id, $path, $checksum) {
                $copy = new Media([
                    'disk' => $media->disk,
                    'path' => $path,
                    'original_name' => $this->editedName($media->original_name),
                    'mime_type' => $media->mime_type,
                    'size' => strlen($result['bytes']),
                    'width' => $result['width'],
                    'height' => $result['height'],
                    'alt' => $media->alt,
                    'checksum' => $checksum,
                    'focal_x' => $focal['x'] ?? null,
                    'focal_y' => $focal['y'] ?? null,
                    'edited_from_id' => $media->id,
                ]);
                $copy->id = $id;
                $copy->save();

                $this->audit->record('media.edited', $copy, new: ['mode' => 'copy', 'edited_from_id' => $media->id] + $edit->toArray());
                GenerateMediaRenditions::dispatch($copy->id)->afterCommit();

                return $copy;
            });
        } catch (Throwable $e) {
            Storage::disk($media->disk)->delete($path);
            throw $e;
        }

        return ['media' => $copy, 'created' => true];
    }

    /**
     * @param  array{bytes: string, width: int, height: int}  $result
     * @param  array{x: int, y: int}|null  $focal
     * @return array{media: Media, created: bool}
     */
    private function replace(Media $media, ImageEdit $edit, array $result, ?array $focal): array
    {
        $checksum = hash('sha256', $result['bytes']);
        if (Media::query()->where('checksum', $checksum)->whereKeyNot($media->id)->exists()) {
            throw new BusinessRuleViolation('DUPLICATE_IMAGE', 'The edited picture is identical to another picture in the library.');
        }

        $oldFiles = $media->files();
        $path = dirname($media->path).'/'.$media->id.'-'.Str::lower(Str::random(8)).'.'.pathinfo($media->path, PATHINFO_EXTENSION);
        Storage::disk($media->disk)->put($path, $result['bytes']);

        try {
            DB::transaction(function () use ($media, $edit, $result, $focal, $path, $checksum) {
                $old = ['width' => $media->width, 'height' => $media->height, 'size' => $media->size];
                $media->fill([
                    'path' => $path,
                    'size' => strlen($result['bytes']),
                    'width' => $result['width'],
                    'height' => $result['height'],
                    'checksum' => $checksum,
                    'renditions' => [],
                    'focal_x' => $focal['x'] ?? null,
                    'focal_y' => $focal['y'] ?? null,
                ])->save();

                $this->audit->record('media.edited', $media, $old, ['mode' => 'replace', 'width' => $media->width, 'height' => $media->height, 'size' => $media->size] + $edit->toArray());
                GenerateMediaRenditions::dispatch($media->id)->afterCommit();
            });
        } catch (Throwable $e) {
            Storage::disk($media->disk)->delete($path);
            throw $e;
        }

        Storage::disk($media->disk)->delete($oldFiles);

        return ['media' => $media->refresh(), 'created' => false];
    }

    private function editedName(string $name): string
    {
        $extension = pathinfo($name, PATHINFO_EXTENSION);
        $base = $extension === '' ? $name : substr($name, 0, -strlen($extension) - 1);
        $suffix = ' (edited)'.($extension === '' ? '' : '.'.$extension);

        return mb_substr($base, 0, 255 - mb_strlen($suffix)).$suffix;
    }
}
