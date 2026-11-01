<?php

namespace App\Modules\Cms\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * E11: blog categories and posts — validation, sanitizing, scheduling, staff preview,
 * public pages and 404s, reference protection and isolation between organizations.
 */
class BlogTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    /**
     * @return array{organization: Organization, admin: User}
     */
    private function store(string $name, string $host): array
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => $name, 'is_enabled' => true])->assertOk();

        return $tenant;
    }

    private function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }

    private function image(string $name = 'cover.jpg'): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, 1200, 630)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function blogPost(string $slug, array $overrides = []): array
    {
        return $this->postJson('/api/v1/cms/blog-posts', $overrides + ['slug' => $slug, 'title' => ucfirst(str_replace('-', ' ', $slug)), 'status' => 'published'])
            ->assertCreated()->json('data');
    }

    public function test_categories_are_validated_reordered_and_deleting_one_uncategorises_its_posts(): void
    {
        $this->store('Berry Kids', 'berry.test');

        $recipes = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->assertCreated()
            ->assertJsonPath('data.slug', 'recipes')->assertJsonPath('data.post_count', 0)->json('data');
        $news = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Store news', 'slug' => 'news', 'description' => 'What is new'])->assertCreated()->json('data');
        $this->assertSame([0, 1], [$recipes['sort_order'] - $recipes['sort_order'], $news['sort_order'] - $recipes['sort_order']]);

        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Copy', 'slug' => 'RECIPES'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');
        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Bad', 'slug' => 'bad slug'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');
        $this->postJson('/api/v1/cms/blog-categories', ['name' => str_repeat('x', 81)])->assertUnprocessable()->assertJsonValidationErrors('name', 'error.details');
        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Long', 'description' => str_repeat('x', 301)])->assertUnprocessable()->assertJsonValidationErrors('description', 'error.details');

        $this->putJson('/api/v1/cms/blog-categories/order', ['ids' => [$news['id']]])->assertUnprocessable()->assertJsonPath('error.code', 'ORDER_MISMATCH');
        $this->putJson('/api/v1/cms/blog-categories/order', ['ids' => [$news['id'], $recipes['id']]])->assertOk()
            ->assertJsonPath('data.0.id', $news['id'])->assertJsonPath('data.1.id', $recipes['id']);
        $this->patchJson("/api/v1/cms/blog-categories/{$news['id']}", ['name' => 'News'])->assertOk()->assertJsonPath('data.name', 'News');

        $post = $this->blogPost('dal-soup', ['category_id' => $recipes['id']]);
        $this->getJson('/api/v1/cms/blog-categories')->assertJsonPath('data.1.post_count', 1)->assertJsonPath('data.1.published_post_count', 1);
        $this->deleteJson("/api/v1/cms/blog-categories/{$recipes['id']}")->assertNoContent();
        $this->getJson("/api/v1/cms/blog-posts/{$post['id']}")->assertOk()->assertJsonPath('data.category', null)->assertJsonPath('data.category_id', null);
        // The slug is free again.
        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes again', 'slug' => 'recipes'])->assertCreated();
        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'blog_category.deleted')->count());
    }

    public function test_posts_are_validated_sanitized_and_listed_with_their_state(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        Date::setTestNow('2026-11-01T10:00:00+06:00');
        $category = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->json('data.id');
        $cover = $this->image();

        $created = $this->postJson('/api/v1/cms/blog-posts', [
            'slug' => 'mango-lassi',
            'title' => 'Mango lassi',
            'category_id' => $category,
            'excerpt' => 'Cool down.',
            'cover_media_id' => $cover,
            'body_html' => '<h2>Steps</h2><p onclick="x()">'.str_repeat('word ', 450).'<script>alert(1)</script></p><a href="javascript:alert(1)">x</a>',
            'seo_title' => 'Mango lassi recipe',
        ])->assertCreated()->json('data');
        $this->assertSame(['mango-lassi', 'draft', 'draft', false, null, 3, $category, $cover], [
            $created['slug'], $created['status'], $created['state'], $created['is_visible'], $created['published_at'], $created['reading_minutes'], $created['category']['id'], $created['cover']['id'],
        ]);
        $this->assertStringNotContainsString('script', $created['body_html']);
        $this->assertStringNotContainsString('onclick', $created['body_html']);
        $this->assertStringNotContainsString('javascript', $created['body_html']);
        $this->assertSame($admin->id, $created['author']['id']);
        $this->assertSame('/blog/mango-lassi?preview=1', $created['preview_url']);

        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'mango-lassi', 'title' => 'Copy'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'categories', 'title' => 'Reserved'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'x', 'title' => 'T', 'seo_title' => str_repeat('s', 71), 'seo_description' => str_repeat('d', 161), 'excerpt' => str_repeat('e', 301)])
            ->assertUnprocessable()->assertJsonValidationErrors(['seo_title', 'seo_description', 'excerpt'], 'error.details');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'ghost', 'title' => 'Ghost', 'category_id' => '01900000-0000-7000-8000-000000000000'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'CATEGORY_NOT_FOUND');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'ghost', 'title' => 'Ghost', 'cover_media_id' => '01900000-0000-7000-8000-000000000000'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'MEDIA_NOT_FOUND');

        // Publish now, schedule (offset kept as the same instant), and an empty draft.
        $this->blogPost('eid-hours', ['published_at' => '2026-11-03T00:00:00+06:00']);
        $now = $this->blogPost('we-are-open');
        $this->assertSame(['published', 1], [$now['state'], $now['reading_minutes']]);
        $this->assertSame('2026-11-01T04:00:00+00:00', $now['published_at']);

        $this->getJson('/api/v1/cms/blog-posts')->assertOk()
            ->assertJsonPath('meta.status_counts', ['all' => 3, 'draft' => 1, 'scheduled' => 1, 'published' => 1])
            ->assertJsonMissingPath('data.0.body_html');
        $this->assertSame(['eid-hours'], array_column($this->getJson('/api/v1/cms/blog-posts?status=scheduled')->json('data'), 'slug'));
        $this->assertSame(['mango-lassi'], array_column($this->getJson('/api/v1/cms/blog-posts?status=draft')->json('data'), 'slug'));
        $this->assertSame(['mango-lassi'], array_column($this->getJson("/api/v1/cms/blog-posts?category_id={$category}")->json('data'), 'slug'));
        $this->assertCount(2, $this->getJson('/api/v1/cms/blog-posts?category_id=none')->json('data'));
        $this->assertSame(['eid-hours'], array_column($this->getJson('/api/v1/cms/blog-posts?search=eid')->json('data'), 'slug'));
        $this->getJson('/api/v1/cms/blog-posts?status=gone')->assertUnprocessable();

        // The cover cannot leave the media library while the post exists.
        $this->deleteJson("/api/v1/media/{$cover}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/cms/blog-posts/{$created['id']}")->assertNoContent();
        $this->deleteJson("/api/v1/media/{$cover}")->assertNoContent();
        $this->getJson("/api/v1/cms/blog-posts/{$created['id']}")->assertNotFound();
        $this->blogPost('mango-lassi');
    }

    public function test_the_public_blog_shows_readable_posts_only_with_categories_neighbours_and_related_posts(): void
    {
        ['admin' => $admin, 'organization' => $organization] = $this->store('Berry Kids', 'berry.test');
        $recipes = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->json('data.id');
        $news = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Store news', 'slug' => 'store-news'])->json('data.id');
        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Empty'])->assertCreated();
        $cover = $this->image();

        Date::setTestNow('2026-10-01T10:00:00+06:00');
        foreach (range(1, 10) as $i) {
            $this->blogPost("recipe-{$i}", ['category_id' => $recipes, 'excerpt' => "Recipe {$i}", 'cover_media_id' => $cover]);
            Date::setTestNow(now()->addDay());
        }
        $this->blogPost('opening', ['category_id' => $news, 'body_html' => '<p>Open <strong>now</strong></p><script>x</script>', 'seo_title' => 'We are open', 'seo_description' => 'Opening hours']);
        $this->blogPost('later', ['category_id' => $news, 'published_at' => now()->addWeek()->toIso8601String()]);
        $this->blogPost('draft-news', ['category_id' => $news, 'status' => 'draft']);
        $this->asVisitor();

        $first = $this->getJson('http://berry.test/api/v1/store/blog')->assertOk()
            ->assertJsonCount(9, 'data')
            ->assertJsonPath('meta.pagination.total', 11)
            ->assertJsonPath('meta.pagination.per_page', 9)
            ->assertJsonPath('meta.category', null)
            ->json('data');
        $this->assertSame('opening', $first[0]['slug']);
        $this->assertSame(['slug', 'title', 'excerpt', 'cover', 'category', 'author', 'published_at', 'reading_minutes'], array_keys($first[1]));
        $this->assertSame(['name' => 'Recipes', 'slug' => 'recipes'], $first[1]['category']);
        $this->assertSame(explode(' ', $admin->name)[0], $first[1]['author']);
        $this->assertSame($cover, $first[1]['cover']['id']);
        $this->getJson('http://berry.test/api/v1/store/blog?page=2')->assertJsonCount(2, 'data');

        $this->getJson('http://berry.test/api/v1/store/blog?category=store-news')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.category.name', 'Store news');
        $this->getJson('http://berry.test/api/v1/store/blog?category=nope')->assertNotFound();

        $this->getJson('http://berry.test/api/v1/store/blog/categories')->assertOk()->assertJsonPath('data', [
            ['name' => 'Recipes', 'slug' => 'recipes', 'description' => null, 'post_count' => 10],
            ['name' => 'Store news', 'slug' => 'store-news', 'description' => null, 'post_count' => 1],
        ]);

        $post = $this->getJson('http://berry.test/api/v1/store/blog/recipe-5')->assertOk()->json('data');
        $this->assertSame(['slug' => 'recipe-4', 'title' => 'Recipe 4'], $post['prev']);
        $this->assertSame(['slug' => 'recipe-6', 'title' => 'Recipe 6'], $post['next']);
        $this->assertSame(['recipe-10', 'recipe-9', 'recipe-8'], array_column($post['related'], 'slug'));
        $this->assertFalse($post['preview']);
        $this->assertArrayNotHasKey('state', $post);

        $opening = $this->getJson('http://berry.test/api/v1/store/blog/OPENING')->assertOk()->json('data');
        $this->assertSame(['<p>Open <strong>now</strong></p>', 'We are open', 'Opening hours', null, []], [$opening['body_html'], $opening['seo_title'], $opening['seo_description'], $opening['next'], $opening['related']]);

        foreach (['later', 'draft-news', 'missing'] as $slug) {
            $this->getJson("http://berry.test/api/v1/store/blog/{$slug}")->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
            $this->getJson("http://berry.test/api/v1/store/blog/{$slug}?preview=1")->assertNotFound();
        }

        // Staff with cms.manage of this store preview drafts and scheduled posts.
        $this->actingAsUser($admin);
        $this->getJson('http://berry.test/api/v1/store/blog/draft-news?preview=1')->assertOk()
            ->assertJsonPath('data.preview', true)->assertJsonPath('data.state', 'draft')->assertHeader('Cache-Control', 'no-store, private');
        $this->getJson('http://berry.test/api/v1/store/blog/later?preview=1')->assertOk()->assertJsonPath('data.state', 'scheduled');
        $this->getJson('http://berry.test/api/v1/store/blog/draft-news')->assertNotFound();
        $cashier = $this->createUserWithRole($organization, SystemRole::Cashier);
        $this->actingAsUser($cashier);
        $this->getJson('http://berry.test/api/v1/store/blog/draft-news?preview=1')->assertNotFound();

        // A scheduled post appears at its time.
        $this->asVisitor();
        Date::setTestNow(now()->addWeek()->addMinute());
        $this->getJson('http://berry.test/api/v1/store/blog/later')->assertOk();
    }

    public function test_blog_management_needs_cms_manage_and_stays_inside_the_organization(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $berryCategory = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->json('data.id');
        $berryPost = $this->blogPost('hello', ['category_id' => $berryCategory])['id'];

        ['organization' => $tiny] = $this->store('Tiny Toes', 'tiny.test');
        $this->getJson('/api/v1/cms/blog-posts')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/cms/blog-categories')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/cms/blog-posts/{$berryPost}")->assertNotFound();
        $this->patchJson("/api/v1/cms/blog-categories/{$berryCategory}", ['name' => 'Mine'])->assertNotFound();
        $this->deleteJson("/api/v1/cms/blog-posts/{$berryPost}")->assertNotFound();
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'other', 'title' => 'Other', 'category_id' => $berryCategory])->assertUnprocessable()->assertJsonPath('error.code', 'CATEGORY_NOT_FOUND');
        // Slugs are unique per organization only.
        $this->blogPost('hello');

        $cashier = $this->createUserWithRole($tiny, SystemRole::Cashier);
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/cms/blog-posts')->assertForbidden();
        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'X'])->assertForbidden();

        $this->asVisitor();
        $this->getJson('http://tiny.test/api/v1/store/blog')->assertJsonCount(1, 'data')->assertJsonPath('data.0.category', null);
        $this->getJson('http://tiny.test/api/v1/store/blog?category=recipes')->assertNotFound();
        $this->getJson('http://berry.test/api/v1/store/blog/hello')->assertOk()->assertJsonPath('data.category.slug', 'recipes');
    }

    public function test_the_shell_serves_blog_pages_with_their_metadata(): void
    {
        $shell = tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title></head><body></body></html>');
        config(['storefront.shell_path' => $shell]);

        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $category = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes', 'description' => 'Cook with us'])->json('data.id');
        $cover = $this->image();
        $this->blogPost('dal-soup', ['category_id' => $category, 'cover_media_id' => $cover, 'seo_title' => 'Dal soup recipe', 'excerpt' => 'Warm and simple']);
        $this->blogPost('secret', ['status' => 'draft']);
        $this->asVisitor();

        $this->assertStringContainsString('<title>Blog | Berry Kids</title>', $this->get('http://berry.test/blog')->assertOk()->getContent());
        $category = $this->get('http://berry.test/blog/category/recipes')->assertOk()->getContent();
        $this->assertStringContainsString('<title>Recipes | Berry Kids</title>', $category);
        $this->assertStringContainsString('<meta name="description" content="Cook with us">', $category);
        $html = $this->get('http://berry.test/blog/dal-soup')->assertOk()->assertHeader('X-Robots-Tag', 'all')->getContent();
        $this->assertStringContainsString('<title>Dal soup recipe | Berry Kids</title>', $html);
        $this->assertStringContainsString('<meta name="description" content="Warm and simple">', $html);
        $this->assertStringContainsString('<meta property="og:type" content="article">', $html);
        $this->assertMatchesRegularExpression('#<meta property="og:image" content="http://berry\.test/storage/[^"]+">#', $html);
        $this->get('http://berry.test/blog/category/nope')->assertNotFound();
        $this->get('http://berry.test/blog/secret')->assertNotFound();
        $this->get('http://berry.test/blog/secret?preview=1')->assertNotFound();

        $this->actingAsUser($admin);
        $this->get('http://berry.test/blog/secret?preview=1')->assertOk()->assertHeader('X-Robots-Tag', 'noindex');

        unlink($shell);
    }
}
