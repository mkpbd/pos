<?php

namespace Database\Seeders;

use App\Modules\OnlineCatalog\Application\Actions\ManageSizeGuides;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\SizeGuide;
use App\Modules\Products\Application\Actions\ManageProductImages;
use App\Modules\Products\Application\Actions\SaveOptionImages;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * P1a: photos per colour, option swatch styles and size guides (with Bangla) for the demo
 * stores whose data file (database/seeders/demo-themes/<store>.php) has `option_photos` or
 * `size_guides` — Classic Shop and Little Sprouts. DemoThemesSeeder applies it to every new
 * demo store; run it on its own to upgrade demo stores created before P1a:
 *
 *   php artisan db:seed --class=DemoVariantsSeeder
 *
 * Idempotent: a store that already has any of its size guides is skipped. Development only.
 * Reuses the stores' product photos; a value without its own photo (Little Sprouts' mint
 * night light) gets a colour-tinted copy of the product photo (GD), or no photo without GD.
 */
class DemoVariantsSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo store seeder must not run in production.');
        }

        foreach (DemoThemesSeeder::STORES as $key) {
            /** @var array<string, mixed> $data */
            $data = require DemoThemesSeeder::path("{$key}.php");
            if (! isset($data['option_photos']) && ! isset($data['size_guides'])) {
                continue;
            }
            $organizationId = StorefrontDomain::query()->withoutGlobalScopes()->where('host', $data['host'])->value('organization_id');
            if ($organizationId === null) {
                $this->command?->line("  {$data['name']}: not seeded yet, skipped.");

                continue;
            }

            app(TenantContext::class)->runAs($organizationId, function () use ($key, $data) {
                $names = array_column($data['size_guides'] ?? [], 'name');
                if ($names !== [] && SizeGuide::query()->whereIn('name', $names)->exists()) {
                    $this->command?->line("  {$data['name']}: already has its size guides, skipped.");

                    return;
                }
                DB::transaction(fn () => self::apply($key, $data));
                $this->command?->info("  {$data['name']}: photos by colour and size guides added.");
            });
        }
    }

    /**
     * Adds the store's P1a demo data (inside its tenant context, after its catalog exists).
     *
     * @param  array<string, mixed>  $data  the store's data file
     */
    public static function apply(string $key, array $data): void
    {
        foreach ($data['option_photos'] ?? [] as $slug => $config) {
            self::optionPhotos($key, $slug, $config);
        }

        $manage = app(ManageSizeGuides::class);
        foreach ($data['size_guides'] ?? [] as $guide) {
            $manage->save(null, self::sizeGuide($guide));
        }
    }

    /**
     * @param  array{option: string, style?: string, values: array<string, list<string|array{tint: string, colour: array{0: int, 1: int, 2: int}, name: string}>>}  $config
     */
    private static function optionPhotos(string $key, string $slug, array $config): void
    {
        $productId = ProductListing::query()->where('slug', $slug)->value('product_id');
        $product = $productId === null ? null : Product::query()->find($productId);
        if ($product === null) {
            return;
        }

        $values = [];
        foreach ($config['values'] as $value => $files) {
            $ids = [];
            foreach ($files as $file) {
                $id = is_array($file) ? self::tinted($key, $product, $file) : self::imageId($product, $file);
                if ($id !== null) {
                    $ids[] = $id;
                }
            }
            $values[] = ['value' => (string) $value, 'image_ids' => $ids];
        }

        app(SaveOptionImages::class)($product, [
            'photo_option' => $config['option'],
            'styles' => isset($config['style']) ? [$config['option'] => $config['style']] : [],
            'values' => $values,
        ]);
    }

    private static function imageId(Product $product, string $file): ?string
    {
        return $product->images()->where('original_name', $file)->value('id');
    }

    /**
     * A colour-tinted copy of one of the store's photos, added to the product once.
     *
     * @param  array{tint: string, colour: array{0: int, 1: int, 2: int}, name: string}  $spec
     */
    private static function tinted(string $key, Product $product, array $spec): ?string
    {
        if (($existing = self::imageId($product, $spec['name'])) !== null) {
            return $existing;
        }
        $source = DemoThemesSeeder::path("images/{$key}/{$spec['tint']}");
        if (! function_exists('imagecreatefromjpeg') || ! is_file($source)) {
            return null;
        }

        $image = imagecreatefromjpeg($source);
        if ($image === false) {
            return null;
        }
        imagefilter($image, IMG_FILTER_COLORIZE, ...$spec['colour']);
        $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'demo-'.Str::random(12).'.jpg';
        imagejpeg($image, $path, 85);
        imagedestroy($image);

        try {
            return app(ManageProductImages::class)->add($product, new UploadedFile($path, $spec['name'], 'image/jpeg', null, true))->id;
        } finally {
            @unlink($path);
        }
    }

    /**
     * The data file's guide as ManageSizeGuides input: column ids are the data keys, rows get
     * ids r1, r2, …; Bangla cells are listed per column in row order.
     *
     * @param  array<string, mixed>  $guide
     * @return array<string, mixed>
     */
    private static function sizeGuide(array $guide): array
    {
        $rows = [];
        foreach ($guide['rows'] as $i => $cells) {
            $rows[] = ['id' => 'r'.($i + 1), 'cells' => $cells];
        }
        $bn = $guide['bn'] ?? [];
        $cells = [];
        foreach ($bn['cells'] ?? [] as $column => $texts) {
            foreach ($texts as $i => $text) {
                $cells['r'.($i + 1)][$column] = $text;
            }
        }

        return [
            'name' => $guide['name'],
            'title' => $guide['title'],
            'intro' => $guide['intro'] ?? null,
            'note' => $guide['note'] ?? null,
            'image_media_id' => null,
            'columns' => array_map(fn (string $id, string $label) => ['id' => $id, 'label' => $label], array_keys($guide['columns']), $guide['columns']),
            'rows' => $rows,
            'category_ids' => array_values(array_filter(array_map(
                fn (string $slug) => CategoryListing::query()->where('slug', $slug)->value('category_id'),
                $guide['categories'] ?? [],
            ))),
            'translations' => ['bn' => [
                'title' => $bn['title'] ?? null,
                'intro' => $bn['intro'] ?? null,
                'note' => $bn['note'] ?? null,
                'columns' => $bn['columns'] ?? [],
                'cells' => $cells,
            ]],
        ];
    }
}
