<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductImage;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * Product images live on the "public" disk under products/<organization>/ with a random
 * file name; the client-supplied name is kept only as metadata. Files are written before
 * and removed after the database change, so a failed transaction never leaves a record
 * pointing at a missing file.
 */
class ManageProductImages
{
    public const MAX_IMAGES = 8;

    private const DISK = 'public';

    public function __construct(private readonly AuditTrail $audit) {}

    public function add(Product $product, UploadedFile $file): ProductImage
    {
        if ($product->images()->count() >= self::MAX_IMAGES) {
            throw new BusinessRuleViolation('TOO_MANY_IMAGES', 'A product can have at most '.self::MAX_IMAGES.' images.');
        }

        // Extension from the detected MIME type, never from the client file name.
        $extension = $file->guessExtension() ?? 'bin';
        $path = $file->storeAs("products/{$product->organization_id}", Str::uuid7().'.'.$extension, self::DISK);

        try {
            return DB::transaction(function () use ($product, $file, $path) {
                $image = $product->images()->create([
                    'organization_id' => $product->organization_id,
                    'path' => $path,
                    'original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
                    'mime_type' => (string) $file->getMimeType(),
                    'size' => (int) $file->getSize(),
                    'sort_order' => (int) $product->images()->max('sort_order') + 1,
                ]);
                $this->audit->record('product.image_added', $product, context: ['image_id' => $image->id]);

                return $image;
            });
        } catch (Throwable $e) {
            Storage::disk(self::DISK)->delete($path);
            throw $e;
        }
    }

    public function remove(Product $product, ProductImage $image): void
    {
        DB::transaction(function () use ($product, $image) {
            $image->delete();
            $this->audit->record('product.image_removed', $product, context: ['image_id' => $image->id]);
        });

        Storage::disk(self::DISK)->delete($image->path);
    }
}
