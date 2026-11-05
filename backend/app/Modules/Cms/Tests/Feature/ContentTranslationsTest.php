<?php

namespace App\Modules\Cms\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * E12b: Bangla translations of content pages, FAQ entries, blog categories and posts —
 * staff round trip (validation, partial updates, sanitizing) and public reads in en / bn
 * with per-field fallback, the shell's localized meta and isolation between stores.
 */
class ContentTranslationsTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private string $shell;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><html lang="en"><head><title>Storefront</title></head><body></body></html>');
        config(['storefront.shell_path' => $this->shell]);
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    private function store(string $name, string $host): void
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => $name, 'is_enabled' => true])->assertOk();
    }

    private function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }

    public function test_pages_and_faq_round_trip_and_read_in_bangla(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $page = $this->postJson('/api/v1/cms/pages', [
            'slug' => 'faq', 'title' => 'Questions', 'template' => 'faq', 'status' => 'published', 'body_html' => '<p>Ask us.</p>',
            'seo_description' => 'Answers to common questions.',
            'translations' => ['bn' => ['title' => 'প্রশ্নোত্তর', 'body_html' => '<p>জিজ্ঞাসা করুন</p><img src="https://evil.test/x.png">', 'seo_title' => ' ']],
        ])->assertCreated()->json('data');
        $this->assertSame(['bn' => ['body_html' => '<p>জিজ্ঞাসা করুন</p>', 'title' => 'প্রশ্নোত্তর']], $page['translations']);

        $this->postJson('/api/v1/cms/pages', ['slug' => 'x', 'title' => 'X', 'translations' => ['bn' => ['slug' => 'এক্স']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');
        $this->postJson('/api/v1/cms/pages', ['slug' => 'x', 'title' => 'X', 'translations' => ['bn' => ['title' => str_repeat('ক', 161)]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn.title'], 'error.details');
        // Partial update keeps the other fields.
        $this->patchJson("/api/v1/cms/pages/{$page['id']}", ['translations' => ['bn' => ['seo_description' => 'সাধারণ প্রশ্নের উত্তর']]])
            ->assertOk()->assertJsonPath('data.translations.bn.title', 'প্রশ্নোত্তর')->assertJsonPath('data.translations.bn.seo_description', 'সাধারণ প্রশ্নের উত্তর');

        $faq = $this->postJson('/api/v1/cms/faq', [
            'question' => 'Where do you deliver?', 'answer_html' => '<p>Dhaka.</p>',
            'translations' => ['bn' => ['question' => 'কোথায় ডেলিভারি দেন?']],
        ])->assertCreated()->json('data');
        $this->postJson('/api/v1/cms/faq', ['question' => 'Fees?', 'answer_html' => '<p>None.</p>', 'translations' => ['bn' => ['group' => 'x']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');
        $this->patchJson("/api/v1/cms/faq/{$faq['id']}", ['translations' => ['bn' => ['answer_html' => '<p>ঢাকা।</p><script>x()</script>']]])
            ->assertOk()->assertJsonPath('data.translations.bn', ['answer_html' => '<p>ঢাকা।</p>', 'question' => 'কোথায় ডেলিভারি দেন?']);
        $this->postJson('/api/v1/cms/faq', ['question' => 'Returns?', 'answer_html' => '<p>7 days.</p>'])->assertCreated();
        $this->asVisitor();

        $bn = $this->getJson('http://berry.test/api/v1/store/pages/faq?lang=bn')->assertOk()->assertHeader('Content-Language', 'bn')->json('data');
        $this->assertSame(['প্রশ্নোত্তর', '<p>জিজ্ঞাসা করুন</p>', null, 'সাধারণ প্রশ্নের উত্তর'], [$bn['title'], $bn['body_html'], $bn['seo_title'], $bn['seo_description']]);
        $this->assertArrayNotHasKey('translations', $bn);
        $items = $bn['faq'][0]['items'];
        $this->assertSame([['কোথায় ডেলিভারি দেন?', '<p>ঢাকা।</p>'], ['Returns?', '<p>7 days.</p>']], array_map(fn (array $i) => [$i['question'], $i['answer_html']], $items));
        $this->assertSame('Where do you deliver?', $this->getJson('http://berry.test/api/v1/store/faq')->json('data.0.items.0.question'));
        $this->assertSame('কোথায় ডেলিভারি দেন?', $this->getJson('http://berry.test/api/v1/store/faq?lang=bn')->json('data.0.items.0.question'));
        $this->assertSame('Questions', $this->getJson('http://berry.test/api/v1/store/pages/faq')->json('data.title'));

        $html = $this->get('http://berry.test/pages/faq?lang=bn')->assertOk()->getContent();
        $this->assertStringContainsString('<title>প্রশ্নোত্তর | Berry Kids</title>', $html);
        $this->assertStringContainsString('<meta name="description" content="সাধারণ প্রশ্নের উত্তর">', $html);
        $this->assertStringContainsString('"name":"হোম"', $html, 'Breadcrumbs in Bangla.');
    }

    public function test_blog_round_trip_and_read_in_bangla(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $category = $this->postJson('/api/v1/cms/blog-categories', [
            'name' => 'Recipes', 'slug' => 'recipes', 'description' => 'Simple dishes.',
            'translations' => ['bn' => ['name' => 'রেসিপি']],
        ])->assertCreated()->json('data');
        $this->assertSame(['bn' => ['name' => 'রেসিপি']], $category['translations']);
        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'News', 'slug' => 'news', 'translations' => ['bn' => ['slug' => 'খবর']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');

        $post = $this->postJson('/api/v1/cms/blog-posts', [
            'slug' => 'mango-lassi', 'title' => 'Mango lassi', 'excerpt' => 'Five minutes.', 'body_html' => '<p>Blend.</p>',
            'category_id' => $category['id'], 'status' => 'published', 'seo_title' => 'Lassi recipe',
            'translations' => ['bn' => ['title' => 'ম্যাঙ্গো লাচ্ছি', 'body_html' => '<p>ব্লেন্ড করুন</p><iframe src="x"></iframe>']],
        ])->assertCreated()->json('data');
        $this->assertSame(['body_html' => '<p>ব্লেন্ড করুন</p>', 'title' => 'ম্যাঙ্গো লাচ্ছি'], $post['translations']['bn']);
        $this->patchJson("/api/v1/cms/blog-posts/{$post['id']}", ['translations' => ['bn' => ['seo_title' => str_repeat('ক', 71)]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn.seo_title'], 'error.details');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'older', 'title' => 'Older post', 'status' => 'published', 'category_id' => $category['id'],
            'published_at' => now()->subDay()->toIso8601String()])->assertCreated();
        $this->asVisitor();

        $list = $this->getJson('http://berry.test/api/v1/store/blog?lang=bn&category=recipes')->assertOk();
        $this->assertSame(['ম্যাঙ্গো লাচ্ছি', 'Older post'], array_column($list->json('data'), 'title'));
        $this->assertSame(['Five minutes.', 'রেসিপি'], [$list->json('data.0.excerpt'), $list->json('data.0.category.name')]);
        $this->assertSame(['রেসিপি', 'Simple dishes.'], [$list->json('meta.category.name'), $list->json('meta.category.description')]);
        $this->assertSame('রেসিপি', $this->getJson('http://berry.test/api/v1/store/blog/categories?lang=bn')->json('data.0.name'));

        $show = $this->getJson('http://berry.test/api/v1/store/blog/mango-lassi?lang=bn')->assertOk()->json('data');
        $this->assertSame(['ম্যাঙ্গো লাচ্ছি', '<p>ব্লেন্ড করুন</p>', 'Lassi recipe'], [$show['title'], $show['body_html'], $show['seo_title']]);
        $this->assertSame('Older post', $show['prev']['title']);
        $this->assertSame('ম্যাঙ্গো লাচ্ছি', $this->getJson('http://berry.test/api/v1/store/blog/older?lang=bn')->json('data.next.title'));
        $this->assertSame('Mango lassi', $this->getJson('http://berry.test/api/v1/store/blog/mango-lassi')->json('data.title'));

        $html = $this->get('http://berry.test/blog/mango-lassi?lang=bn')->assertOk()->getContent();
        $this->assertStringContainsString('<title>Lassi recipe | Berry Kids</title>', $html);
        $this->assertMatchesRegularExpression('#"@type":"BlogPosting","headline":"ম্যাঙ্গো লাচ্ছি".*"inLanguage":"bn"#u', $html);
        $this->assertStringContainsString('<title>রেসিপি | Berry Kids</title>', $this->get('http://berry.test/blog/category/recipes?lang=bn')->getContent());
        $this->assertStringContainsString('<title>ব্লগ | Berry Kids</title>', $this->get('http://berry.test/blog?lang=bn')->getContent());

        // Another store with the same slugs knows nothing of these translations.
        $this->store('Other Shop', 'other.test');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'mango-lassi', 'title' => 'Other lassi', 'status' => 'published'])->assertCreated();
        $this->asVisitor();
        $this->getJson('http://other.test/api/v1/store/blog/mango-lassi?lang=bn')->assertOk()->assertJsonPath('data.title', 'Other lassi');
    }
}
