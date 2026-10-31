<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class HomepageBuilderTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    /**
     * An open storefront on $host; its admin stays signed in.
     *
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

    private function image(string $name = 'banner.jpg'): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, 1600, 600)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function banner(string $placement, string $name, array $overrides = []): string
    {
        return $this->postJson('/api/v1/storefront/banners', $overrides + [
            'placement' => $placement,
            'name' => $name,
            'title' => "{$name} title",
            'desktop_media_id' => $this->image(),
        ])->assertCreated()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function section(array $payload): string
    {
        return $this->postJson('/api/v1/storefront/homepage-sections', $payload)->assertCreated()->json('data.id');
    }

    private function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }

    public function test_banners_are_validated_scheduled_and_reordered_per_placement(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $image = $this->image();

        $this->postJson('/api/v1/storefront/banners', ['placement' => 'hero_slider', 'name' => 'Bad', 'desktop_media_id' => $image, 'link_url' => 'javascript:alert(1)', 'button_label' => 'Go'])
            ->assertUnprocessable()->assertJsonValidationErrors('link_url', 'error.details');
        $this->postJson('/api/v1/storefront/banners', ['placement' => 'hero_slider', 'name' => 'No link', 'desktop_media_id' => $image, 'button_label' => 'Go'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'BUTTON_LINK_REQUIRED');
        $this->postJson('/api/v1/storefront/banners', ['placement' => 'popup', 'name' => 'Later', 'desktop_media_id' => $image])
            ->assertUnprocessable()->assertJsonValidationErrors('placement', 'error.details');
        $this->postJson('/api/v1/storefront/banners', ['placement' => 'hero_slider', 'name' => 'Ghost', 'desktop_media_id' => '01900000-0000-7000-8000-000000000000'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'MEDIA_NOT_FOUND');
        $this->postJson('/api/v1/storefront/banners', ['placement' => 'hero_slider', 'name' => 'Backwards', 'desktop_media_id' => $image, 'starts_at' => '2026-11-05T00:00:00+06:00', 'ends_at' => '2026-11-01T00:00:00+06:00'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'SCHEDULE_INVALID');

        Date::setTestNow('2026-11-01T10:00:00+06:00');
        $a = $this->banner('hero_slider', 'Eid', ['link_url' => '/sale', 'button_label' => 'Shop now', 'starts_at' => '2026-11-03T00:00:00+06:00']);
        $b = $this->banner('hero_slider', 'Winter');
        $c = $this->banner('home_promo', 'Tile');

        $this->getJson('/api/v1/storefront/banners?placement=hero_slider')->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $a)
            ->assertJsonPath('data.0.is_live', false)
            ->assertJsonPath('data.1.is_live', true);

        $this->putJson('/api/v1/storefront/banners/order', ['placement' => 'hero_slider', 'ids' => [$b]])->assertUnprocessable()->assertJsonPath('error.code', 'ORDER_MISMATCH');
        $this->putJson('/api/v1/storefront/banners/order', ['placement' => 'hero_slider', 'ids' => [$b, $a]])->assertOk()
            ->assertJsonPath('data.0.id', $b)->assertJsonPath('data.1.id', $a);
        $this->getJson('/api/v1/storefront/banners')->assertJsonCount(3, 'data');
        $this->deleteJson("/api/v1/storefront/banners/{$c}")->assertNoContent();
    }

    public function test_sections_validate_their_config_and_banners_per_type(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $hero = $this->banner('hero_slider', 'Hero');
        $tiles = [$this->banner('home_promo', 'T1'), $this->banner('home_promo', 'T2'), $this->banner('home_promo', 'T3')];

        $types = $this->getJson('/api/v1/storefront/homepage-sections/types')->assertOk()->json('data');
        $this->assertSame([
            'hero_slider', 'banner_grid', 'rich_text', 'features_strip', 'testimonials', 'newsletter',
            'product_carousel', 'product_grid', 'product_tabs', 'category_strip', 'brand_strip', 'hot_deals',
        ], array_column($types, 'type'));

        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'deal_countdown'])->assertUnprocessable()->assertJsonValidationErrors('type', 'error.details');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'hero_slider', 'banner_ids' => [$tiles[0]]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'BANNER_NOT_FOUND');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'hero_slider', 'banner_ids' => []])
            ->assertUnprocessable()->assertJsonValidationErrors('banner_ids', 'error.details');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'banner_grid', 'config' => ['layout' => '3-col-split'], 'banner_ids' => $tiles])
            ->assertUnprocessable()->assertJsonPath('error.code', 'SECTION_ITEMS_INVALID');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'rich_text', 'config' => ['body_html' => '<script>alert(1)</script>']])
            ->assertUnprocessable()->assertJsonPath('error.code', 'CONTENT_EMPTY');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'features_strip', 'config' => ['items' => [['icon' => 'skull', 'title' => 'X']]]])
            ->assertUnprocessable()->assertJsonValidationErrors('config.items.0.icon', 'error.details');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'testimonials', 'config' => ['items' => [['quote' => 'Great', 'name' => 'Rina', 'avatar_media_id' => '01900000-0000-7000-8000-000000000000']]]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'MEDIA_NOT_FOUND');
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'newsletter', 'banner_ids' => [$hero]])
            ->assertUnprocessable()->assertJsonValidationErrors('banner_ids', 'error.details');

        $text = $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'rich_text', 'title' => 'About', 'config' => ['body_html' => '<p onclick="x()">Hello <b>there</b></p>', 'unknown' => 1]])
            ->assertCreated()
            ->assertJsonPath('data.config', ['body_html' => '<p>Hello there</p>', 'alignment' => 'left', 'width' => 'narrow', 'background' => null])
            ->json('data.id');
        $this->patchJson("/api/v1/storefront/homepage-sections/{$text}", ['type' => 'newsletter'])->assertUnprocessable()->assertJsonValidationErrors('type', 'error.details');

        $slider = $this->section(['type' => 'hero_slider', 'banner_ids' => [$hero], 'config' => ['autoplay_seconds' => 0]]);
        $this->getJson("/api/v1/storefront/homepage-sections/{$slider}")->assertOk()
            ->assertJsonPath('data.banner_ids', [$hero])
            ->assertJsonPath('data.config', ['autoplay_seconds' => 0, 'height' => 'large']);

        // A banner shown by a section can be neither deleted nor moved to another placement.
        $this->deleteJson("/api/v1/storefront/banners/{$hero}")->assertUnprocessable()
            ->assertJsonPath('error.code', 'IN_USE')->assertJsonPath('error.details.sections.0.id', $slider);
        $this->patchJson("/api/v1/storefront/banners/{$hero}", ['placement' => 'home_promo'])->assertUnprocessable()->assertJsonPath('error.code', 'BANNER_IN_USE');
    }

    public function test_the_homepage_shows_live_sections_in_order_and_never_an_empty_one(): void
    {
        $this->store('Berry Kids', 'berry.test');
        Date::setTestNow('2026-11-01T10:00:00+06:00');

        $hero = $this->banner('hero_slider', 'Eid', ['kicker' => 'Online', 'link_url' => '/sale', 'button_label' => 'Shop now']);
        $expiring = $this->banner('home_promo', 'Old', ['ends_at' => '2026-11-02T00:00:00+06:00']);
        $expiring2 = $this->banner('home_promo', 'Old 2', ['ends_at' => '2026-11-02T00:00:00+06:00']);

        $slider = $this->section(['type' => 'hero_slider', 'banner_ids' => [$hero]]);
        $grid = $this->section(['type' => 'banner_grid', 'config' => ['layout' => '2-col'], 'banner_ids' => [$expiring, $expiring2]]);
        $features = $this->section(['type' => 'features_strip', 'title' => 'Why us', 'config' => ['items' => [['icon' => 'truck', 'title' => 'Fast delivery', 'text' => 'Dhaka in 24h']]]]);
        $hidden = $this->section(['type' => 'newsletter', 'title' => 'Hidden', 'is_enabled' => false]);
        $later = $this->section(['type' => 'newsletter', 'title' => 'Later', 'starts_at' => '2026-11-05T00:00:00+06:00']);
        $this->asVisitor();

        $home = $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk()->assertJsonPath('data.preview', false);
        $this->assertSame([$slider, $grid, $features], array_column($home->json('data.sections'), 'id'));
        $home->assertJsonPath('data.sections.0.banners.0.kicker', 'Online')
            ->assertJsonPath('data.sections.0.banners.0.button_label', 'Shop now')
            ->assertJsonPath('data.sections.0.banners.0.image.width', 1600)
            ->assertJsonPath('data.sections.2.config.items.0.title', 'Fast delivery')
            ->assertJsonMissingPath('data.sections.0.state');

        // Once both tiles expire, the grid disappears instead of rendering empty.
        Date::setTestNow('2026-11-03T10:00:00+06:00');
        $this->assertSame([$slider, $features], array_column($this->getJson('http://berry.test/api/v1/store/homepage')->json('data.sections'), 'id'));

        Date::setTestNow('2026-11-05T10:00:00+06:00');
        $this->assertSame([$slider, $features, $later], array_column($this->getJson('http://berry.test/api/v1/store/homepage')->json('data.sections'), 'id'));
        $this->assertNotContains($hidden, array_column($this->getJson('http://berry.test/api/v1/store/homepage')->json('data.sections'), 'id'));
    }

    public function test_admin_changes_show_on_the_storefront_and_staff_can_preview(): void
    {
        ['organization' => $org, 'admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        ['admin' => $otherAdmin] = $this->store('Tiny Toes', 'tiny.test');
        $this->actingAsUser($admin);

        $hero = $this->banner('hero_slider', 'Summer', ['title' => 'Summer sale']);
        $slider = $this->section(['type' => 'hero_slider', 'banner_ids' => [$hero]]);
        $news = $this->section(['type' => 'newsletter', 'title' => 'Join us', 'config' => ['image_media_id' => $this->image('n.png')]]);
        $draft = $this->section(['type' => 'features_strip', 'title' => 'Draft', 'is_enabled' => false, 'config' => ['items' => [['icon' => 'gift', 'title' => 'Gifts']]]]);

        // Brief check 1-2: a changed banner is what the storefront shows.
        $this->patchJson("/api/v1/storefront/banners/{$hero}", ['title' => 'Winter sale', 'desktop_media_id' => $newImage = $this->image('winter.jpg')])->assertOk();
        // Brief check 5-6: a new section appears, and reordering moves it.
        $text = $this->section(['type' => 'rich_text', 'config' => ['body_html' => '<h2>New arrivals</h2>']]);
        $this->putJson('/api/v1/storefront/homepage-sections/order', ['ids' => [$text, $slider, $draft, $news]])->assertOk()
            ->assertJsonPath('data.0.id', $text)->assertJsonPath('data.2.state', 'disabled');

        $this->asVisitor();
        $home = $this->getJson('http://berry.test/api/v1/store/homepage');
        $this->assertSame([$text, $slider, $news], array_column($home->json('data.sections'), 'id'));
        $home->assertJsonPath('data.sections.1.banners.0.title', 'Winter sale')
            ->assertJsonPath('data.sections.1.banners.0.image.id', $newImage)
            ->assertJsonPath('data.sections.2.config.image.url', fn ($url) => str_starts_with($url, '/storage/'))
            ->assertJsonMissingPath('data.sections.2.config.image_media_id');

        // The preview parameter means nothing to visitors or to another store's staff.
        $this->assertCount(3, $this->getJson('http://berry.test/api/v1/store/homepage?preview=1')->json('data.sections'));
        $this->actingAsUser($otherAdmin);
        $this->getJson('http://berry.test/api/v1/store/homepage?preview=1')->assertJsonPath('data.preview', false)->assertJsonCount(3, 'data.sections');
        $this->getJson('http://tiny.test/api/v1/store/homepage')->assertJsonCount(0, 'data.sections');

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $preview = $this->getJson('http://berry.test/api/v1/store/homepage?preview=1')->assertOk()->assertJsonPath('data.preview', true);
        $this->assertSame([$text, $slider, $draft, $news], array_column($preview->json('data.sections'), 'id'));
        $this->assertSame(['live', 'live', 'disabled', 'live'], array_column($preview->json('data.sections'), 'state'));
    }

    public function test_duplicate_reorder_delete_and_conditional_requests(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $a = $this->section(['type' => 'features_strip', 'title' => 'Perks', 'config' => ['items' => [['icon' => 'truck', 'title' => 'Delivery']]]]);
        $b = $this->section(['type' => 'newsletter']);

        $copy = $this->postJson("/api/v1/storefront/homepage-sections/{$a}/duplicate")->assertCreated()
            ->assertJsonPath('data.title', 'Perks (copy)')
            ->assertJsonPath('data.is_enabled', false)
            ->assertJsonPath('data.config.items.0.title', 'Delivery')
            ->json('data.id');
        $this->assertSame([$a, $copy, $b], array_column($this->getJson('/api/v1/storefront/homepage-sections')->json('data'), 'id'));

        $this->putJson('/api/v1/storefront/homepage-sections/order', ['ids' => [$b, $a]])->assertUnprocessable()->assertJsonPath('error.code', 'ORDER_MISMATCH');
        $this->deleteJson("/api/v1/storefront/homepage-sections/{$copy}")->assertNoContent();
        $this->asVisitor();

        $etag = $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk()->headers->get('ETag');
        $this->getJson('http://berry.test/api/v1/store/homepage', ['If-None-Match' => $etag])->assertStatus(304);
    }

    public function test_media_used_by_banners_and_sections_cannot_be_deleted(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $bannerImage = $this->image('b.jpg');
        $this->banner('hero_slider', 'Hero', ['desktop_media_id' => $bannerImage]);
        $avatar = $this->image('avatar.png');
        $this->section(['type' => 'testimonials', 'config' => ['items' => [['quote' => 'Lovely clothes', 'name' => 'Rina', 'rating' => 5, 'avatar_media_id' => $avatar]]]]);

        $this->deleteJson("/api/v1/media/{$bannerImage}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/media/{$avatar}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
    }

    public function test_homepage_management_needs_storefront_permissions(): void
    {
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier));
        $this->getJson('/api/v1/storefront/homepage-sections')->assertForbidden();
        $this->getJson('/api/v1/storefront/banners')->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'newsletter'])->assertCreated();
    }
}
