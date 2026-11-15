<?php

namespace App\Modules\Media\Infrastructure\Console;

use App\Modules\Media\Domain\RenditionPlan;
use App\Modules\Media\Infrastructure\Imaging\GdImageProcessor;
use App\Modules\Media\Infrastructure\Jobs\GenerateMediaRenditions;
use App\Modules\Media\Infrastructure\Models\Media;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * B11: brings media uploaded before the upload rules up to them. JPEG, PNG and WebP originals
 * larger than RenditionPlan::MAX_SIDE px are scaled down (new file name, old files deleted,
 * renditions made again); large JPEG/PNG originals without a full-size WebP rendition get
 * their renditions made again. The id, alt text and focal point stay. `--dry-run` only lists.
 */
class OptimizeMediaCommand extends Command
{
    protected $signature = 'media:optimize
        {--dry-run : List what would change without changing anything}
        {--organization= : Only this organization (id)}';

    protected $description = 'Scale down oversized media originals and add missing WebP renditions';

    public function handle(GdImageProcessor $images): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $resized = $rendered = $failed = 0;

        $this->query()->chunkById(100, function ($items) use ($images, $dryRun, &$resized, &$rendered, &$failed) {
            foreach ($items as $media) {
                /** @var Media $media */
                $oversized = RenditionPlan::isOversized($media->width, $media->height);
                $missingWebp = ! $oversized && RenditionPlan::wantsFullSizeWebp($media->mime_type, $media->size)
                    && ! isset($media->renditions[(string) $media->width]);
                if (! $oversized && ! $missingWebp) {
                    continue;
                }

                if ($oversized) {
                    [$w, $h] = RenditionPlan::fitWithin($media->width, $media->height);
                    $this->line(($dryRun ? 'Would resize ' : 'Resizing ')."{$media->id} ({$media->original_name}): {$media->width}×{$media->height} → {$w}×{$h}");
                    if (! $dryRun) {
                        try {
                            $this->resize($media, $images);
                            $resized++;
                        } catch (Throwable $e) {
                            $failed++;
                            $this->warn("  failed: {$e->getMessage()}");
                        }
                    } else {
                        $resized++;
                    }

                    continue;
                }

                $this->line(($dryRun ? 'Would add' : 'Adding')." a full-size WebP copy for {$media->id} ({$media->original_name})");
                if (! $dryRun) {
                    GenerateMediaRenditions::dispatch($media->id);
                }
                $rendered++;
            }
        });

        $verb = $dryRun ? 'would be' : 'were';
        $this->info("{$resized} original(s) {$verb} scaled down, {$rendered} {$verb} given new renditions".($failed > 0 ? ", {$failed} failed" : '').'.');

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * @return Builder<Media>
     */
    private function query(): Builder
    {
        return Media::query()->withoutGlobalScope('organization')
            ->whereIn('mime_type', GdImageProcessor::EDITABLE)
            ->when($this->option('organization'), fn (Builder $q, $org) => $q->where('organization_id', (string) $org));
    }

    private function resize(Media $media, GdImageProcessor $images): void
    {
        $disk = Storage::disk($media->disk);
        $result = $images->shrink((string) $disk->get($media->path), $media->mime_type, $media->width, $media->height);

        $oldFiles = $media->files();
        $path = dirname($media->path).'/'.$media->id.'-'.Str::lower(Str::random(8)).'.'.pathinfo($media->path, PATHINFO_EXTENSION);
        $disk->put($path, $result['bytes']);
        try {
            $media->fill([
                'path' => $path,
                'size' => strlen($result['bytes']),
                'width' => $result['width'],
                'height' => $result['height'],
                'renditions' => [],
            ])->save();
        } catch (Throwable $e) {
            $disk->delete($path);
            throw $e;
        }
        $disk->delete($oldFiles);
        GenerateMediaRenditions::dispatch($media->id);
    }
}
