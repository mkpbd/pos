<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * E11 on the storefront: blog menu links (resolution, link targets, IN_USE), the homepage
 * blog_posts section and the popup banner.
 */
class BlogLinksAndPopupTest extends TestCase
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

    private function image(string $name = 'popup.jpg'): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, 800, 600)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function blogPost(string $slug, array $overrides = []): string
    {
        return $this->postJson('/api/v1/cms/blog-posts', $overrides + ['slug' => $slug, 'title' => ucfirst($slug), 'status' => 'published'])->assertCreated()->json('data.id');
    }

    public function test_menus_link_to_the_blog_its_categories_and_readable_posts(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $category = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->json('data.id');
        $post = $this->blogPost('dal-soup', ['category_id' => $category]);
        $draft = $this->blogPost('coming-soon', ['status' => 'draft']);
        $menu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->json('data.id');

        $targets = $this->getJson('/api/v1/storefront/link-targets')->assertOk()->json('data');
        $this->assertSame([['id' => $category, 'name' => 'Recipes', 'slug' => 'recipes']], $targets['blog_categories']);
        $this->assertSame([
            ['id' => $draft, 'slug' => 'coming-soon', 'title' => 'Coming-soon', 'status' => 'draft', 'state' => 'draft', 'is_visible' => false],
            ['id' => $post, 'slug' => 'dal-soup', 'title' => 'Dal-soup', 'status' => 'published', 'state' => 'published', 'is_visible' => true],
        ], $targets['blog_posts']);

        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['type' => 'blog_category', 'label' => 'Recipes']]])
            ->assertUnprocessable()->assertJsonValidationErrors('items.0.target_id', 'error.details');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['type' => 'blog_post', 'label' => 'Gone', 'target_id' => '01900000-0000-7000-8000-000000000000']]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'BLOG_POST_NOT_FOUND');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['type' => 'blog_category', 'label' => 'Gone', 'target_id' => '01900000-0000-7000-8000-000000000000']]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'BLOG_CATEGORY_NOT_FOUND');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [
            ['type' => 'blog', 'label' => 'Blog', 'url' => '/ignored', 'target_id' => $post, 'children' => [
                ['type' => 'blog_category', 'label' => 'Recipes', 'target_id' => $category],
                ['type' => 'blog_post', 'label' => 'Dal soup', 'target_id' => $post],
                ['type' => 'blog_post', 'label' => 'Soon', 'target_id' => $draft],
            ]],
        ]])->assertOk()->assertJsonPath('data.items.0.url', null)->assertJsonPath('data.items.0.target_id', null);

        $this->asVisitor();
        $items = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.menus.main.items');
        $this->assertSame('/blog', $items[0]['url']);
        $this->assertSame(['/blog/category/recipes', '/blog/dal-soup'], array_column($items[0]['children'], 'url'));

        // Renames follow; published drafts appear; references block deletion.
        $this->actingAsUser($admin);
        $this->patchJson("/api/v1/cms/blog-categories/{$category}", ['slug' => 'cooking'])->assertOk();
        $this->patchJson("/api/v1/cms/blog-posts/{$draft}", ['status' => 'published'])->assertOk();
        $this->asVisitor();
        $this->assertSame(['/blog/category/cooking', '/blog/dal-soup', '/blog/coming-soon'], array_column($this->getJson('http://berry.test/api/v1/store/bootstrap')->json('data.menus.main.items.0.children'), 'url'));

        $this->actingAsUser($admin);
        $this->deleteJson("/api/v1/cms/blog-categories/{$category}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/cms/blog-posts/{$post}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['type' => 'blog', 'label' => 'Blog']]])->assertOk();
        $this->deleteJson("/api/v1/cms/blog-posts/{$post}")->assertNoContent();
        $this->deleteJson("/api/v1/cms/blog-categories/{$category}")->assertNoContent();
    }

    public function test_the_homepage_blog_posts_section_shows_the_newest_posts_and_hides_when_empty(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $recipes = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->json('data.id');
        $news = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'News'])->json('data.id');

        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'blog_posts', 'config' => ['limit' => 2]])->assertUnprocessable()->assertJsonValidationErrors('config.limit', 'error.details');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'blog_posts', 'config' => ['view_all_url' => 'javascript:alert(1)']])->assertUnprocessable()->assertJsonValidationErrors('config.view_all_url', 'error.details');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'blog_posts', 'config' => ['category_id' => '01900000-0000-7000-8000-000000000000']])
            ->assertUnprocessable()->assertJsonPath('error.code', 'BLOG_CATEGORY_NOT_FOUND');
        $all = $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'blog_posts', 'title' => 'From the blog'])->assertCreated()
            ->assertJsonPath('data.config', ['category_id' => null, 'limit' => 3, 'view_all_url' => '/blog'])->json('data.id');
        $onlyNews = $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'blog_posts', 'title' => 'News', 'config' => ['category_id' => $news, 'limit' => 4]])->assertCreated()->json('data.id');

        // Empty: hidden for visitors, `empty` in the staff preview.
        $this->getJson('http://berry.test/api/v1/store/homepage?preview=1')->assertOk()->assertJsonPath('data.sections.0.state', 'empty')->assertJsonPath('data.sections.1.state', 'empty');
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk()->assertJsonCount(0, 'data.sections');

        $this->actingAsUser($admin);
        Date::setTestNow('2026-10-01T10:00:00+06:00');
        foreach (['one', 'two', 'three', 'four'] as $slug) {
            $this->blogPost($slug, ['category_id' => $recipes, 'excerpt' => "About {$slug}"]);
            Date::setTestNow(now()->addHour());
        }
        $this->blogPost('scheduled', ['published_at' => now()->addDay()->toIso8601String()]);
        $this->blogPost('draft', ['status' => 'draft']);
        $this->asVisitor();

        $sections = $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk()->json('data.sections');
        $this->assertSame([$all], array_column($sections, 'id'));
        $this->assertSame(['four', 'three', 'two'], array_column($sections[0]['posts'], 'slug'));
        $this->assertSame(['name' => 'Recipes', 'slug' => 'recipes'], $sections[0]['posts'][0]['category']);
        $this->assertSame('/blog', $sections[0]['config']['view_all_url']);

        $this->actingAsUser($admin);
        $this->blogPost('opening', ['category_id' => $news]);
        $this->asVisitor();
        $sections = $this->getJson('http://berry.test/api/v1/store/homepage')->json('data.sections');
        $this->assertSame([$all, $onlyNews], array_column($sections, 'id'));
        $this->assertSame(['opening'], array_column($sections[1]['posts'], 'slug'));

        // The section keeps its category from being deleted.
        $this->actingAsUser($admin);
        $this->deleteJson("/api/v1/cms/blog-categories/{$news}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/storefront/homepage-sections/{$onlyNews}")->assertNoContent();
        $this->deleteJson("/api/v1/cms/blog-categories/{$news}")->assertNoContent();
    }

    public function test_one_live_popup_is_shown_by_sort_order_and_schedule(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $image = $this->image();

        $this->postJson('/api/v1/storefront/banners', ['placement' => 'popup', 'name' => 'Bad', 'desktop_media_id' => $image, 'popup_delay_seconds' => 61])
            ->assertUnprocessable()->assertJsonValidationErrors('popup_delay_seconds', 'error.details');
        $this->postJson('/api/v1/storefront/banners', ['placement' => 'popup', 'name' => 'Bad', 'desktop_media_id' => $image, 'popup_frequency' => 'always'])
            ->assertUnprocessable()->assertJsonValidationErrors('popup_frequency', 'error.details');

        $off = $this->postJson('/api/v1/storefront/banners', ['placement' => 'popup', 'name' => 'Off', 'title' => 'Off', 'desktop_media_id' => $image, 'is_active' => false])
            ->assertCreated()->assertJsonPath('data.popup_delay_seconds', 5)->assertJsonPath('data.popup_frequency', 'once_per_day')->json('data.id');
        $later = $this->postJson('/api/v1/storefront/banners', ['placement' => 'popup', 'name' => 'Later', 'desktop_media_id' => $image, 'starts_at' => now()->addDay()->toIso8601String()])->assertCreated()->json('data.id');
        $live = $this->postJson('/api/v1/storefront/banners', [
            'placement' => 'popup', 'name' => 'Free delivery', 'title' => 'Free delivery over 3000', 'subtitle' => 'This week',
            'desktop_media_id' => $image, 'link_url' => '/shop', 'button_label' => 'Shop now',
            'popup_delay_seconds' => 0, 'popup_frequency' => 'once_per_session',
        ])->assertCreated()->json('data.id');
        $second = $this->postJson('/api/v1/storefront/banners', ['placement' => 'popup', 'name' => 'Second', 'desktop_media_id' => $image])->assertCreated()->json('data.id');
        // Other placements never keep popup settings.
        $this->postJson('/api/v1/storefront/banners', ['placement' => 'hero_slider', 'name' => 'Hero', 'desktop_media_id' => $image, 'popup_delay_seconds' => 9])
            ->assertCreated()->assertJsonPath('data.popup_delay_seconds', null)->assertJsonPath('data.popup_frequency', null);

        $this->asVisitor();
        $popup = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.popup');
        $this->assertSame([$live, 'Free delivery over 3000', 'This week', '/shop', 'Shop now', 0, 'once_per_session', $image, null], [
            $popup['id'], $popup['title'], $popup['subtitle'], $popup['link_url'], $popup['button_label'], $popup['delay_seconds'], $popup['frequency'], $popup['image']['id'], $popup['mobile_image'],
        ]);
        $this->assertNotNull($popup['updated_at']);

        // The first live one in sort order wins; inactive and scheduled ones never show.
        $this->actingAsUser($admin);
        $this->putJson('/api/v1/storefront/banners/order', ['placement' => 'popup', 'ids' => [$off, $later, $second, $live]])->assertOk();
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.popup.id', $second)->assertJsonPath('data.popup.delay_seconds', 5)->assertJsonPath('data.popup.frequency', 'once_per_day');

        Date::setTestNow(now()->addDays(2));
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.popup.id', $later);

        $this->actingAsUser($admin);
        foreach ([$later, $second, $live] as $id) {
            $this->patchJson("/api/v1/storefront/banners/{$id}", ['is_active' => false])->assertOk();
        }
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.popup', null);
    }
}
