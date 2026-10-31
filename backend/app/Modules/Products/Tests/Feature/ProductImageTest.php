<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\Catalog\Tests\Concerns\CreatesCatalog;
use App\Modules\Products\Application\Actions\ManageProductImages;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProductImageTest extends TestCase
{
    use CreatesCatalog, InteractsWithTenancy, RefreshDatabase;

    private function product(): array
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $id = $this->actingAsUser($admin)->postJson('/api/v1/products', [
            'name' => 'Juice', 'type' => 'standard', 'unit_id' => $catalog['unit']->id,
            'variants' => [['purchase_price' => '1', 'selling_price' => '2']],
        ])->json('data.id');

        return [$id, $org];
    }

    public function test_upload_stores_under_random_name_and_delete_removes_file(): void
    {
        Storage::fake('public');
        [$id, $org] = $this->product();

        $image = $this->postJson("/api/v1/products/{$id}/images", ['image' => UploadedFile::fake()->image('../../evil name.png', 400, 400)])
            ->assertCreated()
            ->json('data.images.0');

        $this->assertStringStartsWith("/storage/products/{$org->id}/", $image['url']);
        $this->assertStringEndsWith('.png', $image['url']);
        $this->assertStringNotContainsString('evil', $image['url']);
        $path = substr($image['url'], strlen('/storage/'));
        Storage::disk('public')->assertExists($path);

        $this->deleteJson("/api/v1/products/{$id}/images/{$image['id']}")->assertOk()->assertJsonCount(0, 'data.images');
        Storage::disk('public')->assertMissing($path);
    }

    public function test_only_raster_images_within_limits_are_accepted(): void
    {
        Storage::fake('public');
        [$id] = $this->product();

        $svg = UploadedFile::fake()->createWithContent('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        $this->postJson("/api/v1/products/{$id}/images", ['image' => $svg])->assertStatus(422);
        $this->postJson("/api/v1/products/{$id}/images", ['image' => UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf')])->assertStatus(422);
        $this->postJson("/api/v1/products/{$id}/images", ['image' => UploadedFile::fake()->image('big.jpg')->size(3000)])->assertStatus(422);

        for ($i = 0; $i < ManageProductImages::MAX_IMAGES; $i++) {
            $this->postJson("/api/v1/products/{$id}/images", ['image' => UploadedFile::fake()->image("p{$i}.jpg")])->assertCreated();
        }
        $this->postJson("/api/v1/products/{$id}/images", ['image' => UploadedFile::fake()->image('one-too-many.jpg')])
            ->assertStatus(422)->assertJsonPath('error.code', 'TOO_MANY_IMAGES');
    }
}
