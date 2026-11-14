<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\CustomFonts;
use App\Modules\Storefront\Domain\Woff2Font;
use App\Modules\Storefront\Infrastructure\Models\StorefrontFont;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * B10: the organization's own theme fonts. Upload: a WOFF2 file (checked by its header) of at
 * most 500 KB, at most CustomFonts::LIMIT per organization, a unique name and the weights it
 * covers; stored on the media disk at `fonts/<organization>/<id>.woff2` and never changed, so
 * it is cached for good (cloud disks get the cache header). Delete: refused while the live
 * theme or the theme draft uses it (409 FONT_IN_USE). Both audited.
 */
class ManageCustomFonts
{
    public const CACHE_CONTROL = 'public, max-age=31536000, immutable';

    public function __construct(
        private readonly CustomFonts $fonts,
        private readonly AuditTrail $audit,
        private readonly TenantContext $tenant,
    ) {}

    public function upload(UploadedFile $file, string $name, int $weightMin, int $weightMax): StorefrontFont
    {
        $bytes = (string) file_get_contents((string) $file->getRealPath());
        if (! Woff2Font::isValid($bytes)) {
            throw new BusinessRuleViolation('INVALID_FONT', 'The file is not a WOFF2 font. Convert the font to WOFF2 (at most 500 KB) and try again.');
        }
        $name = trim($name);
        $checksum = hash('sha256', $bytes);
        $organizationId = $this->tenant->requireOrganization();
        $disk = (string) config('media.disk');
        $id = (string) Str::uuid7();
        $path = "fonts/{$organizationId}/{$id}.woff2";

        try {
            return $this->store($organizationId, $name, $checksum, $weightMin, $weightMax, $disk, $path, $id, $bytes);
        } catch (Throwable $e) {
            Storage::disk($disk)->delete($path);
            throw $e;
        }
    }

    private function store(string $organizationId, string $name, string $checksum, int $weightMin, int $weightMax, string $disk, string $path, string $id, string $bytes): StorefrontFont
    {
        return DB::transaction(function () use ($organizationId, $name, $checksum, $weightMin, $weightMax, $disk, $path, $id, $bytes) {
            // One upload at a time per organization, so the limit holds.
            if (DB::getDriverName() === 'pgsql') {
                DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['storefront_fonts:'.$organizationId]);
            }
            $duplicate = StorefrontFont::query()->where('checksum', $checksum)->value('id');
            if (is_string($duplicate)) {
                throw new BusinessRuleViolation('FONT_DUPLICATE', 'This font file is already uploaded.', ['font_id' => $duplicate]);
            }
            if (StorefrontFont::query()->count() >= CustomFonts::LIMIT) {
                throw new BusinessRuleViolation('FONT_LIMIT_REACHED', 'A store can have at most '.CustomFonts::LIMIT.' own fonts. Delete one you no longer use first.', ['limit' => CustomFonts::LIMIT]);
            }
            if (StorefrontFont::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->exists()) {
                throw ValidationException::withMessages(['name' => 'You already have a font with this name.']);
            }

            $font = new StorefrontFont([
                'name' => $name,
                'weight_min' => $weightMin,
                'weight_max' => $weightMax,
                'disk' => $disk,
                'path' => $path,
                'size' => strlen($bytes),
                'checksum' => $checksum,
            ]);
            $font->id = $id;
            $font->save();

            Storage::disk($disk)->put($path, $bytes, ['visibility' => 'public', 'CacheControl' => self::CACHE_CONTROL, 'ContentType' => 'font/woff2']);
            $this->audit->record('storefront.font_uploaded', $font, [], ['name' => $font->name, 'size' => $font->size, 'weight_min' => $weightMin, 'weight_max' => $weightMax]);

            return $font;
        });
    }

    public function delete(StorefrontFont $font): void
    {
        $usage = $this->fonts->usage($font->id);
        if ($usage['used_by'] !== []) {
            throw new BusinessRuleViolation('FONT_IN_USE', 'This font is used by your theme. Choose another font in Typography first.', $usage, 409);
        }

        DB::transaction(function () use ($font) {
            $font->delete();
            $this->audit->record('storefront.font_deleted', $font, ['name' => $font->name]);
        });

        try {
            Storage::disk($font->disk)->delete($font->path);
        } catch (Throwable) {
            // The row is gone; a file left behind is harmless.
        }
    }
}
