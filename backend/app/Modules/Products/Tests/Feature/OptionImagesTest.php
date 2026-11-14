<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * P1a: photos by colour (PUT /products/{id}/option-images), swatch styles, the product page
 * options payload and the colour chips on cards.
 */
class OptionImagesTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /** @var array<string, mixed> */
    private array $tenant;

    /** @var array<string, mixed> */
    private array $product;

    /** @var list<string> */
    private array $images = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    /**
     * A published dress in Red / Blue / Green / Pink / White / Black / Yellow (S) with three photos;
     * Colour is a swatch attribute.
     */
    private function dress(): void
    {
        $this->tenant = $this->openStore('Berry Kids', 'berry.test');
        $colours = ['Red' => '#ff0000', 'Blue' => '#0000ff', 'Green' => '#00ff00', 'Pink' => '#ffc0cb', 'White' => '#ffffff', 'Black' => '#000000', 'Yellow' => '#ffff00'];
        $this->postJson('/api/v1/attributes', ['name' => 'Colour', 'display' => 'swatch', 'is_filterable' => true,
            'values' => array_map(fn (string $v, string $hex) => ['value' => $v, 'swatch_hex' => $hex], array_keys($colours), $colours)])->assertCreated();
        $this->product = $this->makeProduct($this->tenant['unit']->id, 'Party Dress', array_map(
            fn (string $c) => ['DRESS-'.strtoupper($c), '900.00', ['Colour' => $c, 'Size' => 'S']],
            array_keys($colours),
        ), ['options' => [['name' => 'Colour', 'values' => array_keys($colours)], ['name' => 'Size', 'values' => ['S']]]]);
        foreach (['front', 'back', 'blue'] as $name) {
            $this->postJson("/api/v1/products/{$this->product['id']}/images", ['image' => UploadedFile::fake()->image("{$name}.jpg", 300, 300)])->assertCreated();
        }
        $this->images = array_column($this->getJson("/api/v1/products/{$this->product['id']}")->json('data.images'), 'id');
        $this->publish($this->product['id']);
    }

    private function url(): string
    {
        return "/api/v1/products/{$this->product['id']}/option-images";
    }

    public function test_saves_photos_by_colour_and_styles(): void
    {
        $this->dress();
        [$front, $back, $blue] = $this->images;

        $data = $this->putJson($this->url(), [
            'photo_option' => 'colour',
            'styles' => ['Colour' => 'image', 'size' => 'button'],
            'values' => [['value' => 'red', 'image_ids' => [$back, $front]], ['value' => 'Blue', 'image_ids' => [$blue]]],
        ])->assertOk()->json('data');

        $this->assertSame('Colour', $data['photo_option']);
        $this->assertEquals(['Colour' => 'image', 'Size' => 'button'], $data['option_styles']);
        $this->assertSame(['Blue' => [$blue], 'Red' => [$back, $front]], $data['option_images']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.option_images_saved', 'subject_id' => $this->product['id']]);
        $this->getJson("/api/v1/products/{$this->product['id']}")->assertOk()->assertJsonPath('data.option_images.Red', [$back, $front]);

        // A null style removes it; values not sent lose their photos.
        $data = $this->putJson($this->url(), ['photo_option' => 'Colour', 'styles' => ['Size' => null], 'values' => [['value' => 'Blue', 'image_ids' => [$blue, $front]]]])->assertOk()->json('data');
        $this->assertSame(['Colour' => 'image'], $data['option_styles']);
        $this->assertSame(['Blue' => [$blue, $front]], $data['option_images']);

        // Removing a product image removes it from the colour's photos.
        $this->deleteJson("/api/v1/products/{$this->product['id']}/images/{$front}")->assertOk()->assertJsonPath('data.option_images.Blue', [$blue]);

        // No photo option: every photo goes.
        $this->putJson($this->url(), ['photo_option' => null])->assertOk()->assertJsonPath('data.photo_option', null)->assertJsonPath('data.option_images', []);
    }

    public function test_validation_and_isolation(): void
    {
        $this->dress();
        $other = $this->makeProduct($this->tenant['unit']->id, 'Cap', [['CAP', '100.00']]);
        $this->postJson("/api/v1/products/{$other['id']}/images", ['image' => UploadedFile::fake()->image('cap.jpg', 300, 300)])->assertCreated();
        $capImage = $this->getJson("/api/v1/products/{$other['id']}")->json('data.images.0.id');

        $this->putJson($this->url(), ['photo_option' => 'Material'])->assertUnprocessable()->assertJsonValidationErrors(['photo_option'], 'error.details');
        $this->putJson($this->url(), ['photo_option' => 'Colour', 'styles' => ['Colour' => 'stripes', 'Fit' => 'button']])
            ->assertUnprocessable()->assertJsonValidationErrors(['styles.Colour', 'styles.Fit'], 'error.details');
        $this->putJson($this->url(), ['photo_option' => 'Colour', 'values' => [
            ['value' => 'Purple', 'image_ids' => []],
            ['value' => 'Red', 'image_ids' => [$capImage, $this->images[0], $this->images[0]]],
        ]])->assertUnprocessable()->assertJsonValidationErrors(['values.0.value', 'values.1.image_ids.0', 'values.1.image_ids.2'], 'error.details');

        // Another organization cannot touch the product.
        $foreign = $this->openStore('Other Shop', 'other.test');
        $this->actingAsUser($foreign['admin'])->putJson($this->url(), ['photo_option' => null])->assertNotFound();
    }

    public function test_product_page_and_cards_show_photos_and_chips(): void
    {
        $this->dress();
        [$front, $back, $blue] = $this->images;
        $this->putJson($this->url(), [
            'photo_option' => 'Colour',
            'values' => [['value' => 'Red', 'image_ids' => [$back, $front]], ['value' => 'Blue', 'image_ids' => [$blue]]],
        ])->assertOk();
        $this->asVisitor();

        $page = $this->getJson('http://berry.test/api/v1/store/products/party-dress')->assertOk()->json('data');
        $this->assertSame('Colour', $page['photo_option']);
        $colour = $page['options'][0];
        $this->assertSame(['Colour', 'swatch'], [$colour['name'], $colour['display']]);
        $this->assertSame(['value' => 'Red', 'swatch_hex' => '#ff0000', 'image' => ['id' => $back, 'url' => $colour['values'][0]['image']['url'], 'alt' => 'Party Dress — Red'], 'image_ids' => [$back, $front]], $colour['values'][0]);
        $this->assertSame([$blue], $colour['values'][1]['image_ids']);
        $this->assertSame(['value' => 'Green', 'swatch_hex' => '#00ff00', 'image' => null, 'image_ids' => []], $colour['values'][2]);
        $this->assertSame([], $page['options'][1]['values'][0]['image_ids'], 'Only the photo option has photos.');
        // A variant without its own image shows its colour's first photo.
        $this->assertSame([$back, $blue, null], array_slice(array_column($page['variants'], 'image_id'), 0, 3));

        $card = $this->getJson('http://berry.test/api/v1/store/products')->assertOk()->json('data.0');
        $this->assertSame('Colour', $card['swatches']['option']);
        $this->assertSame(['Red', 'Blue', 'Green', 'Pink', 'White'], array_column($card['swatches']['values'], 'value'));
        $this->assertSame(2, $card['swatches']['more']);
        $this->assertSame(['url' => $colour['values'][0]['image']['url'], 'alt' => 'Party Dress — Red'], $card['swatches']['values'][0]['image']);
        $this->assertNull($card['swatches']['values'][2]['image']);

        // A product style overrides the attribute's display.
        $this->actingAsUser($this->tenant['admin']);
        $this->putJson($this->url(), ['photo_option' => 'Colour', 'styles' => ['Colour' => 'image'], 'values' => [['value' => 'Red', 'image_ids' => [$back]]]])->assertOk();
        $this->asVisitor();
        $this->assertSame('image', $this->getJson('http://berry.test/api/v1/store/products/party-dress')->json('data.options.0.display'));
    }
}
