<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * E12b: the store's languages (settings, bootstrap), translations of menus, banners,
 * homepage sections and the announcement (staff round trip and public reads), and the
 * HTML shell / sitemaps in two languages (html lang, canonical, hreflang, og:locale,
 * JSON-LD inLanguage) for an English and a Bangla default.
 */
class StorefrontLanguagesTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private string $shell;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><html lang="en"><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $this->shell, 'app.url' => 'https://admin.example.test']);
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    private function image(): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('banner.jpg', 1600, 600)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    /**
     * Berry Kids with a translated main menu, announcement, hero banner and text sections,
     * and a translated product page.
     *
     * @return array<string, mixed>
     */
    private function shop(string $name = 'Berry Kids', string $host = 'berry.test'): array
    {
        $t = $this->openStore($name, $host);
        $menu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->assertCreated()->json('data.id');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [
            ['label' => 'Home', 'url' => '/', 'translations' => ['bn' => ['label' => 'হোম']]],
            ['label' => 'Shop', 'url' => '/shop', 'children' => [['label' => 'Sale', 'url' => '/sale', 'translations' => ['bn' => ['label' => 'ছাড়']]]]],
        ]])->assertOk();
        $this->putJson('/api/v1/storefront/theme', ['announcement' => [
            'enabled' => true, 'text' => 'Free delivery today', 'translations' => ['bn' => ['text' => 'আজ ফ্রি ডেলিভারি']],
        ]])->assertOk();

        $hero = $this->postJson('/api/v1/storefront/banners', [
            'placement' => 'hero_slider', 'name' => 'Hero', 'kicker' => 'New', 'title' => 'Fresh week', 'subtitle' => 'Every morning',
            'button_label' => 'Shop', 'link_url' => '/shop', 'desktop_media_id' => $this->image(),
            'translations' => ['bn' => ['title' => 'তাজা সপ্তাহ', 'button_label' => 'কিনুন']],
        ])->assertCreated()->json('data');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'hero_slider', 'banner_ids' => [$hero['id']]])->assertCreated();
        $text = $this->postJson('/api/v1/storefront/homepage-sections', [
            'type' => 'rich_text', 'title' => 'Welcome', 'subtitle' => 'Since 2012', 'config' => ['body_html' => '<p>Hello</p>'],
            'translations' => ['bn' => ['title' => 'স্বাগতম', 'body_html' => '<p>নমস্কার</p><script>alert(1)</script>']],
        ])->assertCreated()->json('data');
        $this->postJson('/api/v1/storefront/homepage-sections', [
            'type' => 'newsletter', 'title' => 'Offers', 'config' => ['text' => 'One e-mail a week.', 'button_label' => 'Subscribe'],
            'translations' => ['bn' => ['text' => 'সপ্তাহে একটি ই-মেইল।']],
        ])->assertCreated();

        $shirt = $this->makeProduct($t['unit']->id, 'Polo Shirt', [['SHIRT', '500.00']]);
        $this->publish($shirt['id'], ['slug' => 'polo-shirt', 'short_description' => 'Soft cotton.', 'translations' => ['bn' => ['name' => 'পোলো শার্ট', 'short_description' => 'নরম সুতি।']]]);

        return $t + ['hero' => $hero, 'text' => $text, 'menu' => $menu];
    }

    public function test_language_settings_are_validated_and_published_in_the_bootstrap(): void
    {
        $this->shop();
        $settings = $this->getJson('/api/v1/storefront/settings')->assertOk()->json('data');
        $this->assertSame([true, 'en', false], [$settings['bangla_enabled'], $settings['default_locale'], $settings['bangla_digits']]);

        $this->patchJson('/api/v1/storefront/settings', ['default_locale' => 'fr'])->assertUnprocessable()->assertJsonValidationErrors(['default_locale'], 'error.details');
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => false, 'default_locale' => 'bn'])->assertUnprocessable()->assertJsonValidationErrors(['default_locale'], 'error.details');
        $this->patchJson('/api/v1/storefront/settings', ['bangla_digits' => true])->assertOk()->assertJsonPath('data.bangla_digits', true);
        $this->asVisitor();

        $en = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertHeader('Content-Language', 'en')->json('data');
        $this->assertSame([['en', 'bn'], 'en', true, 'en'], [$en['store']['locales'], $en['store']['default_locale'], $en['store']['bangla_digits'], $en['locale']]);
        $this->assertSame(['Home', 'Shop'], array_column($en['menus']['main']['items'], 'label'));
        $this->assertSame('Free delivery today', $en['theme']['announcement']['text']);

        $bn = $this->getJson('http://berry.test/api/v1/store/bootstrap?lang=bn')->assertOk()->assertHeader('Content-Language', 'bn')->json('data');
        $this->assertSame('bn', $bn['locale']);
        $this->assertSame(['হোম', 'Shop'], array_column($bn['menus']['main']['items'], 'label'), 'Untranslated labels stay in English.');
        $this->assertSame('ছাড়', $bn['menus']['main']['items'][1]['children'][0]['label']);
        $this->assertSame('আজ ফ্রি ডেলিভারি', $bn['theme']['announcement']['text']);
        // The cached English bootstrap is not served to Bangla readers, nor the other way round.
        $this->assertSame('Free delivery today', $this->getJson('http://berry.test/api/v1/store/bootstrap?lang=en')->json('data.theme.announcement.text'));
        $this->assertSame('আজ ফ্রি ডেলিভারি', $this->getJson('http://berry.test/api/v1/store/bootstrap?lang=bn')->json('data.theme.announcement.text'));
    }

    public function test_staff_round_trip_of_menu_banner_section_and_announcement_translations(): void
    {
        $t = $this->shop();

        $menu = $this->getJson("/api/v1/storefront/menus/{$t['menu']}")->assertOk()->json('data.items');
        $this->assertSame(['bn' => ['label' => 'হোম']], $menu[0]['translations']);
        $this->assertSame([], $menu[1]['translations']['bn']);
        $this->putJson("/api/v1/storefront/menus/{$t['menu']}/items", ['items' => [['label' => 'Home', 'url' => '/', 'translations' => ['bn' => ['url' => '/bn']]]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.translations.bn'], 'error.details');
        $this->putJson("/api/v1/storefront/menus/{$t['menu']}/items", ['items' => [['label' => 'Home', 'url' => '/', 'translations' => ['bn' => ['label' => str_repeat('ক', 81)]]]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.translations.bn.label'], 'error.details');

        $this->assertSame(['button_label' => 'কিনুন', 'title' => 'তাজা সপ্তাহ'], $t['hero']['translations']['bn']);
        $banner = $this->patchJson("/api/v1/storefront/banners/{$t['hero']['id']}", ['translations' => ['bn' => ['kicker' => 'নতুন', 'button_label' => '']]])
            ->assertOk()->json('data.translations.bn');
        $this->assertSame(['kicker' => 'নতুন', 'title' => 'তাজা সপ্তাহ'], $banner);
        $this->patchJson("/api/v1/storefront/banners/{$t['hero']['id']}", ['translations' => ['bn' => ['name' => 'x']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');

        // Section texts: sanitized rich text; a type only takes its own texts.
        $this->assertSame(['body_html' => '<p>নমস্কার</p>', 'title' => 'স্বাগতম'], $t['text']['translations']['bn']);
        $this->patchJson("/api/v1/storefront/homepage-sections/{$t['text']['id']}", ['translations' => ['bn' => ['button_label' => 'যান']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');
        $this->patchJson("/api/v1/storefront/homepage-sections/{$t['text']['id']}", ['translations' => ['bn' => ['subtitle' => '২০১২ থেকে']]])
            ->assertOk()->assertJsonPath('data.translations.bn.subtitle', '২০১২ থেকে')->assertJsonPath('data.translations.bn.title', 'স্বাগতম');

        $theme = $this->getJson('/api/v1/storefront/theme')->assertOk()->json('data.settings.announcement');
        $this->assertSame(['bn' => ['text' => 'আজ ফ্রি ডেলিভারি']], $theme['translations']);
        $this->putJson('/api/v1/storefront/theme', ['announcement' => ['enabled' => true, 'text' => 'Hi', 'translations' => ['bn' => ['text' => str_repeat('ক', 201)]]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['announcement.translations.bn.text'], 'error.details');
    }

    public function test_homepage_reads_in_bangla_with_per_field_fallback(): void
    {
        $this->shop();
        $this->asVisitor();

        $bn = collect($this->getJson('http://berry.test/api/v1/store/homepage?lang=bn')->assertOk()->assertHeader('Content-Language', 'bn')->json('data.sections'))->keyBy('type');
        $banner = $bn['hero_slider']['banners'][0];
        $this->assertSame(['New', 'তাজা সপ্তাহ', 'Every morning', 'কিনুন'], [$banner['kicker'], $banner['title'], $banner['subtitle'], $banner['button_label']]);
        $this->assertSame(['স্বাগতম', 'Since 2012', '<p>নমস্কার</p>'], [$bn['rich_text']['title'], $bn['rich_text']['subtitle'], $bn['rich_text']['config']['body_html']]);
        $this->assertSame(['Offers', 'সপ্তাহে একটি ই-মেইল।', 'Subscribe'], [$bn['newsletter']['title'], $bn['newsletter']['config']['text'], $bn['newsletter']['config']['button_label']]);

        $en = collect($this->getJson('http://berry.test/api/v1/store/homepage')->assertOk()->json('data.sections'))->keyBy('type');
        $this->assertSame(['Fresh week', '<p>Hello</p>'], [$en['hero_slider']['banners'][0]['title'], $en['rich_text']['config']['body_html']]);
        $this->assertSame('তাজা সপ্তাহ', $this->getJson('http://berry.test/api/v1/store/homepage?lang=bn')->json('data.sections.0.banners.0.title'));
    }

    public function test_shell_writes_language_canonical_and_hreflang_for_an_english_default(): void
    {
        $this->shop();
        $this->asVisitor();

        $en = $this->get('http://berry.test/product/polo-shirt')->assertOk()->assertHeader('Content-Language', 'en')->getContent();
        $this->assertStringContainsString('<html lang="en">', $en);
        $this->assertStringContainsString('<title>Polo Shirt | Berry Kids</title>', $en);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/product/polo-shirt">', $en);
        $this->assertStringContainsString('<meta property="og:locale" content="en_US">', $en);
        $this->assertStringContainsString('<meta property="og:locale:alternate" content="bn_BD">', $en);
        $this->assertStringContainsString('<link rel="alternate" hreflang="en" href="http://berry.test/product/polo-shirt">', $en);
        $this->assertStringContainsString('<link rel="alternate" hreflang="bn" href="http://berry.test/product/polo-shirt?lang=bn">', $en);
        $this->assertStringContainsString('<link rel="alternate" hreflang="x-default" href="http://berry.test/product/polo-shirt">', $en);

        $bn = $this->get('http://berry.test/product/polo-shirt?lang=bn&utm_source=x')->assertOk()->assertHeader('Content-Language', 'bn')->getContent();
        $this->assertStringContainsString('<html lang="bn">', $bn);
        $this->assertStringContainsString('<title>পোলো শার্ট | Berry Kids</title>', $bn);
        $this->assertStringContainsString('<meta name="description" content="নরম সুতি।">', $bn);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/product/polo-shirt?lang=bn">', $bn);
        $this->assertStringContainsString('<meta property="og:url" content="http://berry.test/product/polo-shirt?lang=bn">', $bn);
        $this->assertStringContainsString('<meta property="og:locale" content="bn_BD">', $bn);
        $this->assertStringContainsString('<meta property="og:locale:alternate" content="en_US">', $bn);
        $this->assertStringContainsString('<link rel="alternate" hreflang="x-default" href="http://berry.test/product/polo-shirt">', $bn);
        $this->assertStringContainsString('"locale":"bn"', $bn, 'The inline bootstrap is in Bangla.');

        // The cookie the switcher writes picks the language when the URL has none; ?lang wins.
        $cookie = $this->withUnencryptedCookie('lang', 'bn')->get('http://berry.test/')->assertOk()->getContent();
        $this->assertStringContainsString('<html lang="bn">', $cookie);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test?lang=bn">', $cookie);
        $this->assertMatchesRegularExpression('#"@type":"WebSite"[^<]*"inLanguage":"bn"#', $cookie);
        $this->assertStringContainsString('<html lang="en">', $this->withUnencryptedCookie('lang', 'bn')->get('http://berry.test/?lang=en')->getContent());

        // Listings keep ?page=N; fixed titles are translated.
        $shop = $this->get('http://berry.test/shop?page=2&lang=bn')->assertOk()->getContent();
        $this->assertStringContainsString('<title>শপ | Berry Kids</title>', $shop);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/shop?page=2&amp;lang=bn">', $shop);
        $this->assertStringContainsString('<link rel="alternate" hreflang="en" href="http://berry.test/shop?page=2">', $shop);

        // Noindex pages list no alternates.
        $this->assertStringNotContainsString('hreflang', $this->get('http://berry.test/cart?lang=bn')->getContent());
    }

    public function test_shell_and_sitemaps_for_a_bangla_default_and_with_bangla_off(): void
    {
        $t = $this->shop();
        $this->patchJson('/api/v1/storefront/settings', ['default_locale' => 'bn'])->assertOk();
        $this->asVisitor();

        $bn = $this->get('http://berry.test/product/polo-shirt')->assertOk()->assertHeader('Content-Language', 'bn')->getContent();
        $this->assertStringContainsString('<html lang="bn">', $bn);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/product/polo-shirt">', $bn);
        $this->assertStringContainsString('<link rel="alternate" hreflang="en" href="http://berry.test/product/polo-shirt?lang=en">', $bn);
        $this->assertStringContainsString('<link rel="alternate" hreflang="bn" href="http://berry.test/product/polo-shirt">', $bn);
        $this->assertStringContainsString('<link rel="alternate" hreflang="x-default" href="http://berry.test/product/polo-shirt">', $bn);
        $en = $this->get('http://berry.test/product/polo-shirt?lang=en')->assertOk()->getContent();
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/product/polo-shirt?lang=en">', $en);
        $this->assertStringContainsString('<title>Polo Shirt | Berry Kids</title>', $en);
        // The API without ?lang reads in the default.
        $this->getJson('http://berry.test/api/v1/store/products/polo-shirt')->assertHeader('Content-Language', 'bn')->assertJsonPath('data.name', 'পোলো শার্ট');

        $sitemap = $this->get('http://berry.test/sitemaps/products-1.xml')->assertOk()->getContent();
        $this->assertStringContainsString('xmlns:xhtml="http://www.w3.org/1999/xhtml"', $sitemap);
        $this->assertStringContainsString('<loc>https://berry.test/product/polo-shirt</loc>', $sitemap);
        $this->assertStringContainsString('<xhtml:link rel="alternate" hreflang="en" href="https://berry.test/product/polo-shirt?lang=en"/>', $sitemap);
        $this->assertStringContainsString('<xhtml:link rel="alternate" hreflang="bn" href="https://berry.test/product/polo-shirt"/>', $sitemap);
        $this->assertStringContainsString('<xhtml:link rel="alternate" hreflang="x-default" href="https://berry.test/product/polo-shirt"/>', $sitemap);

        // Bangla off: English everywhere, no alternates.
        $this->actingAsUser($t['admin']);
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => false])->assertUnprocessable();
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => false, 'default_locale' => 'en'])->assertOk();
        $this->asVisitor();
        $off = $this->withUnencryptedCookie('lang', 'bn')->get('http://berry.test/product/polo-shirt?lang=bn')->assertOk()->assertHeader('Content-Language', 'en')->getContent();
        $this->assertStringContainsString('<html lang="en">', $off);
        $this->assertStringContainsString('<title>Polo Shirt | Berry Kids</title>', $off);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/product/polo-shirt">', $off);
        $this->assertStringNotContainsString('hreflang', $off);
        $this->assertStringNotContainsString('og:locale:alternate', $off);
        $this->assertStringNotContainsString('xhtml:link', $this->get('http://berry.test/sitemaps/pages.xml')->assertOk()->getContent());
        $boot = $this->getJson('http://berry.test/api/v1/store/bootstrap?lang=bn')->assertOk()->json('data');
        $this->assertSame([['en'], 'en', 'en', 'Free delivery today'], [$boot['store']['locales'], $boot['store']['default_locale'], $boot['locale'], $boot['theme']['announcement']['text']]);
        $this->getJson('http://berry.test/api/v1/store/homepage?lang=bn')->assertHeader('Content-Language', 'en')->assertJsonPath('data.sections.0.banners.0.title', 'Fresh week');
    }

    public function test_one_stores_translations_and_language_settings_never_reach_another(): void
    {
        $this->shop();
        $this->asVisitor();
        $other = $this->openStore('Other Shop', 'other.test');
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => false])->assertOk();
        $menu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->assertCreated()->json('data.id');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['label' => 'Home', 'url' => '/']]])->assertOk();
        $this->assertNotNull($other);
        $this->asVisitor();

        $boot = $this->getJson('http://other.test/api/v1/store/bootstrap?lang=bn')->assertOk()->assertHeader('Content-Language', 'en')->json('data');
        $this->assertSame([['en'], 'Home'], [$boot['store']['locales'], $boot['menus']['main']['items'][0]['label']]);
        $this->getJson('http://berry.test/api/v1/store/bootstrap?lang=bn')->assertOk()->assertJsonPath('data.menus.main.items.0.label', 'হোম');
    }
}
