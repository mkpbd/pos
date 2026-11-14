<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * P2b: the share bar and WhatsApp settings (number normalized to E.164 digits, effective button
 * flags in the bootstrap) and the share cards in the HTML shell (X / Twitter cards, og:image:alt,
 * the first image and text of a campaign page).
 */
class ShareAndWhatsAppTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private string $shell;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $this->shell]);
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    public function test_share_and_whatsapp_settings_reach_the_bootstrap(): void
    {
        $this->openStore('Berry Kids', 'berry.test');
        $settings = $this->getJson('/api/v1/storefront/settings')->assertOk()->json('data');
        $this->assertSame([true, null, true, true], [$settings['share_buttons'], $settings['whatsapp_number'], $settings['whatsapp_order_button'], $settings['whatsapp_chat_button']]);

        $store = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.store');
        $this->assertSame([true, null, false, false], [$store['share_buttons'], $store['whatsapp_number'], $store['whatsapp_order_button'], $store['whatsapp_chat_button']], 'No number, no WhatsApp buttons.');

        foreach ([['01712345678', '8801712345678'], ['+880 1712-345678', '8801712345678'], ['8801812345678', '8801812345678'], ['+44 20 7946 0958', '442079460958'], ['0044 20 7946 0958', '442079460958']] as [$input, $stored]) {
            $this->patchJson('/api/v1/storefront/settings', ['whatsapp_number' => $input])->assertOk()->assertJsonPath('data.whatsapp_number', $stored);
        }
        foreach (['12345', '0171234567', '+0123456789', 'call me'] as $bad) {
            $this->patchJson('/api/v1/storefront/settings', ['whatsapp_number' => $bad])->assertStatus(422)->assertJsonValidationErrors('whatsapp_number', 'error.details');
        }
        $this->patchJson('/api/v1/storefront/settings', ['whatsapp_number' => '01712345678', 'whatsapp_chat_button' => false, 'share_buttons' => false])->assertOk();

        $store = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.store');
        $this->assertSame([false, '8801712345678', true, false], [$store['share_buttons'], $store['whatsapp_number'], $store['whatsapp_order_button'], $store['whatsapp_chat_button']]);
        $inline = $this->get('http://berry.test/')->assertOk()->getContent();
        $this->assertStringContainsString('"whatsapp_number":"8801712345678"', $inline);

        // "" clears the number (and the buttons with it); audited.
        $this->patchJson('/api/v1/storefront/settings', ['whatsapp_number' => ''])->assertOk()->assertJsonPath('data.whatsapp_number', null);
        $this->assertFalse($this->getJson('http://berry.test/api/v1/store/bootstrap')->json('data.store.whatsapp_order_button'));
        $this->assertTrue(DB::table('audit_logs')->where('action', 'storefront.settings_updated')->pluck('new_values')->contains(fn ($v) => str_contains((string) $v, 'whatsapp_number')));
    }

    public function test_share_cards_in_the_shell(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $shirt = $this->makeProduct($t['unit']->id, 'Polo Shirt', [['SHIRT', '450.00']]);
        $this->postJson("/api/v1/products/{$shirt['id']}/images", ['image' => UploadedFile::fake()->image('shirt.jpg', 400, 400)])->assertCreated();
        $this->publish($shirt['id'], ['slug' => 'polo-shirt', 'description_html' => '<p>Soft cotton.</p>']);
        $cap = $this->makeProduct($t['unit']->id, 'Cap', [['CAP', '120.00']]);
        $this->publish($cap['id'], ['slug' => 'cap']);

        // A product with a photo: a large image card with alt texts.
        $html = $this->get('http://berry.test/product/polo-shirt')->assertOk()->getContent();
        $this->assertMatchesRegularExpression('#<meta property="og:image" content="http://berry\.test/storage/[^"]+">#', $html);
        $this->assertStringContainsString('<meta property="og:image:alt" content="Polo Shirt">', $html);
        $this->assertStringContainsString('<meta name="twitter:card" content="summary_large_image">', $html);
        $this->assertStringContainsString('<meta name="twitter:title" content="Polo Shirt | Berry Kids">', $html);
        $this->assertStringContainsString('<meta name="twitter:description" content="Soft cotton.">', $html);
        $this->assertMatchesRegularExpression('#<meta name="twitter:image" content="http://berry\.test/storage/[^"]+">#', $html);
        $this->assertStringContainsString('<meta name="twitter:image:alt" content="Polo Shirt">', $html);

        // Without a photo: the small card, no image tags.
        $plain = $this->get('http://berry.test/product/cap')->assertOk()->getContent();
        $this->assertStringContainsString('<meta name="twitter:card" content="summary">', $plain);
        $this->assertStringNotContainsString('twitter:image', $plain);
        $this->assertStringNotContainsString('og:image', $plain);

        // A campaign page: its first image and first text.
        $photo = $this->postJson('/api/v1/media', ['file' => UploadedFile::fake()->image('eid.jpg', 1200, 630)])->assertCreated()->json('data.id');
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid-sale', 'title' => 'Eid sale'])->assertCreated()->json('data.id');
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Eid sale is here', 'level' => 1]],
                ['id' => 'e_text', 'type' => 'text', 'props' => ['html' => '<p>Up to <strong>30% off</strong> &amp; free delivery.</p>']],
                ['id' => 'e_photo', 'type' => 'image', 'props' => ['media_id' => $photo, 'alt' => 'Eid gifts on a table']],
            ]]],
        ]]]])->assertOk();
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();

        $landing = $this->get('http://berry.test/p/eid-sale')->assertOk()->getContent();
        $this->assertStringContainsString('<title>Eid sale | Berry Kids</title>', $landing);
        $this->assertStringContainsString('<meta property="og:description" content="Up to 30% off &amp; free delivery.">', $landing);
        $this->assertStringContainsString('<meta name="description" content="Up to 30% off &amp; free delivery.">', $landing);
        $this->assertMatchesRegularExpression('#<meta property="og:image" content="http://berry\.test/storage/[^"]+">#', $landing);
        $this->assertStringContainsString('<meta property="og:image:alt" content="Eid gifts on a table">', $landing);
        $this->assertStringContainsString('<meta name="twitter:card" content="summary_large_image">', $landing);

        // The home page: the store's own texts, a summary card.
        $home = $this->get('http://berry.test/')->assertOk()->getContent();
        $this->assertStringContainsString('<meta name="twitter:card" content="summary">', $home);
        $this->assertStringContainsString('<meta name="twitter:title" content="Berry Kids">', $home);
    }
}
