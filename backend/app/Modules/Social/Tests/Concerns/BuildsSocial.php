<?php

namespace App\Modules\Social\Tests\Concerns;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * P2b: an open store with a two-size shirt (two JPEG photos, a category and brand) and a
 * single-variant cap (one PNG photo), for the Social tests. Use with BuildsOnlineCatalog and
 * InteractsWithTenancy; the store's admin stays signed in.
 */
trait BuildsSocial
{
    use BuildsOnlineCatalog, InteractsWithTenancy;

    /**
     * @return array{tenant: array<string, mixed>, shirt: array<string, mixed>, cap: array<string, mixed>, shirt_images: list<string>, cap_images: list<string>, clothes: string, shirts: string, polo: string}
     */
    protected function socialShop(string $name = 'Berry Kids', string $host = 'berry.test'): array
    {
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        Storage::fake('local');
        $t = $this->openStore($name, $host);
        $org = $t['organization'];
        $clothes = $this->category($org, 'Clothes');
        $shirts = $this->category($org, 'Shirts', $clothes);
        $polo = $this->brand($org, 'Polo');
        $this->listCategory($clothes);
        $this->listCategory($shirts);
        $this->listBrand($polo);

        $shirt = $this->makeProduct($t['unit']->id, 'Polo Shirt', [['SHIRT-M', '450.00', ['Size' => 'M']], ['SHIRT-L', '500.00', ['Size' => 'L']]], [
            'category_id' => $shirts, 'brand_id' => $polo, 'options' => [['name' => 'Size', 'values' => ['M', 'L']]],
        ]);
        $shirtImages = $this->productImages($shirt['id'], ['shirt-front.jpg', 'shirt-back.jpg']);
        $this->publish($shirt['id'], ['slug' => 'polo-shirt', 'description_html' => '<p>Soft &amp; breathable cotton.</p>']);

        $cap = $this->makeProduct($t['unit']->id, 'Sun Cap', [['CAP', '120.00']]);
        $capImages = $this->productImages($cap['id'], ['cap.png']);
        $this->publish($cap['id'], ['slug' => 'sun-cap', 'short_description' => 'A cap for sunny days']);

        $variants = array_column($shirt['variants'], 'id', 'sku');
        $this->stockUp($t, [$variants['SHIRT-M'] => '3', $cap['variants'][0]['id'] => '10']);

        return [
            'tenant' => $t, 'shirt' => $shirt, 'cap' => $cap, 'shirt_images' => $shirtImages, 'cap_images' => $capImages,
            'clothes' => $clothes, 'shirts' => $shirts, 'polo' => $polo,
        ];
    }

    /**
     * Uploads photos (JPEG or PNG by extension) to a product; their ids in order.
     *
     * @param  list<string>  $names
     * @return list<string>
     */
    protected function productImages(string $productId, array $names): array
    {
        $images = [];
        foreach ($names as $name) {
            $images = $this->postJson("/api/v1/products/{$productId}/images", ['image' => UploadedFile::fake()->image($name, 600, 600)])
                ->assertCreated()->json('data.images');
        }

        return array_column($images, 'id');
    }

    /**
     * Connects the sandbox "Demo Page" through the browser flow.
     */
    protected function connectSandbox(): void
    {
        $this->get('/api/v1/social/meta/connect')->assertStatus(302)->assertHeader('Location', '/admin/marketing/social?connected=1');
    }
}
