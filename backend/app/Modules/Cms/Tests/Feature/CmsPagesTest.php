<?php

namespace App\Modules\Cms\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Tests\TestCase;

class CmsPagesTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    /**
     * An organization with an open storefront on $host; its admin is signed in afterwards.
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

    private function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }

    public function test_pages_are_sanitized_unique_and_public_only_once_published(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');

        $page = $this->postJson('/api/v1/cms/pages', [
            'slug' => 'about-us',
            'title' => 'About us',
            'body_html' => '<h2>Hello</h2><p onclick="steal()">We sell <script>alert(1)</script>toys. <a href="javascript:alert(1)">x</a></p><img src="https://tracker.test/p.gif" alt="">',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.is_visible', false)
            ->json('data');
        $this->assertSame('<h2>Hello</h2><p>We sell toys. <a>x</a></p>', $page['body_html']);

        $this->postJson('/api/v1/cms/pages', ['slug' => 'About-Us', 'title' => 'Copy'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');
        $this->postJson('/api/v1/cms/pages', ['slug' => 'about us!', 'title' => 'Bad'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');

        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/pages/about-us')->assertNotFound();

        $this->actingAsUser($admin);
        $this->patchJson("/api/v1/cms/pages/{$page['id']}", ['status' => 'published', 'seo_title' => 'About Berry Kids'])->assertOk()
            ->assertJsonPath('data.is_visible', true);

        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/pages/about-us')->assertOk()
            ->assertJsonPath('data.title', 'About us')
            ->assertJsonPath('data.seo_title', 'About Berry Kids')
            ->assertJsonPath('data.template', 'default')
            ->assertJsonMissingPath('data.id');
    }

    public function test_a_scheduled_page_appears_at_its_publication_time(): void
    {
        $this->store('Berry Kids', 'berry.test');
        Date::setTestNow('2026-11-01T10:00:00+06:00');
        $this->postJson('/api/v1/cms/pages', ['slug' => 'eid', 'title' => 'Eid offers', 'status' => 'published', 'published_at' => '2026-11-03T00:00:00+06:00'])
            ->assertCreated()->assertJsonPath('data.is_visible', false);
        $this->asVisitor();

        $this->getJson('http://berry.test/api/v1/store/pages/eid')->assertNotFound();
        Date::setTestNow('2026-11-03T00:00:00+06:00');
        $this->getJson('http://berry.test/api/v1/store/pages/eid')->assertOk();
    }

    public function test_faq_entries_are_managed_reordered_and_shown_on_faq_pages(): void
    {
        $this->store('Berry Kids', 'berry.test');

        $a = $this->postJson('/api/v1/cms/faq', ['question' => 'Delivery time?', 'answer_html' => '<p>2-3 days</p>', 'group' => 'Shipping'])->assertCreated()->json('data.id');
        $b = $this->postJson('/api/v1/cms/faq', ['question' => 'Returns?', 'answer_html' => '<p>Within 7 days</p><script>x</script>'])->assertCreated()
            ->assertJsonPath('data.answer_html', '<p>Within 7 days</p>')->json('data.id');
        $c = $this->postJson('/api/v1/cms/faq', ['question' => 'Hidden?', 'answer_html' => '<p>No</p>', 'is_active' => false])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/cms/faq', ['question' => 'Empty?', 'answer_html' => '<script>only</script>'])->assertUnprocessable()->assertJsonPath('error.code', 'CONTENT_EMPTY');

        $this->putJson('/api/v1/cms/faq/order', ['ids' => [$a, $b]])->assertUnprocessable()->assertJsonPath('error.code', 'ORDER_MISMATCH');
        $this->putJson('/api/v1/cms/faq/order', ['ids' => [$c, $b, $a]])->assertOk()->assertJsonPath('data.0.id', $c)->assertJsonPath('data.2.id', $a);
        $this->postJson('/api/v1/cms/pages', ['slug' => 'faq', 'title' => 'FAQ', 'template' => 'faq', 'status' => 'published'])->assertCreated();
        $this->asVisitor();

        $expected = [
            ['group' => null, 'items' => [['id' => $b, 'question' => 'Returns?', 'answer_html' => '<p>Within 7 days</p>']]],
            ['group' => 'Shipping', 'items' => [['id' => $a, 'question' => 'Delivery time?', 'answer_html' => '<p>2-3 days</p>']]],
        ];
        $this->getJson('http://berry.test/api/v1/store/faq')->assertOk()->assertJsonPath('data', $expected);
        $this->getJson('http://berry.test/api/v1/store/pages/faq')->assertOk()->assertJsonPath('data.faq', $expected);
    }

    public function test_menus_link_to_published_pages_by_id_and_keep_linked_pages_from_deletion(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $page = $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'About'])->assertCreated()->json('data.id');
        $menu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->json('data.id');

        $this->getJson('/api/v1/storefront/link-targets')->assertOk()->assertJsonPath('data.pages.0', ['id' => $page, 'slug' => 'about', 'title' => 'About', 'status' => 'draft']);

        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['type' => 'page', 'label' => 'About']]])
            ->assertUnprocessable()->assertJsonValidationErrors('items.0.target_id', 'error.details');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['type' => 'page', 'label' => 'Gone', 'target_id' => '01900000-0000-7000-8000-000000000000']]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'PAGE_NOT_FOUND');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [
            ['label' => 'Home', 'url' => '/'],
            ['type' => 'page', 'label' => 'About', 'target_id' => $page, 'url' => '/ignored'],
        ]])->assertOk()->assertJsonPath('data.items.1.target_id', $page)->assertJsonPath('data.items.1.url', null);

        // A draft page is not linked from the storefront.
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonCount(1, 'data.menus.main.items');

        $this->actingAsUser($admin);
        $this->patchJson("/api/v1/cms/pages/{$page}", ['status' => 'published', 'slug' => 'about-berry'])->assertOk();
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.menus.main.items.1.url', '/pages/about-berry');

        $this->actingAsUser($admin);
        $this->deleteJson("/api/v1/cms/pages/{$page}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['label' => 'Home', 'url' => '/']]])->assertOk();
        $this->deleteJson("/api/v1/cms/pages/{$page}")->assertNoContent();
        // The slug is free again once the page is deleted.
        $this->postJson('/api/v1/cms/pages', ['slug' => 'about-berry', 'title' => 'About again'])->assertCreated();
    }

    public function test_content_management_needs_cms_manage_and_stays_inside_the_organization(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $berryPage = $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'Berry about', 'status' => 'published'])->json('data.id');

        ['organization' => $tiny] = $this->store('Tiny Toes', 'tiny.test');
        $this->getJson('/api/v1/cms/pages')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/cms/pages/{$berryPage}")->assertNotFound();
        $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'Tiny about', 'status' => 'published'])->assertCreated();

        $cashier = $this->createUserWithRole($tiny, SystemRole::Cashier);
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/cms/pages')->assertForbidden();
        $this->getJson('/api/v1/cms/faq')->assertForbidden();

        $manager = $this->createUserWithRole($tiny, SystemRole::OnlineStoreManager);
        $this->actingAsUser($manager);
        $this->getJson('/api/v1/cms/pages')->assertOk()->assertJsonCount(1, 'data');

        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/pages/about')->assertJsonPath('data.title', 'Berry about');
        $this->getJson('http://tiny.test/api/v1/store/pages/about')->assertJsonPath('data.title', 'Tiny about');
    }

    public function test_the_shell_serves_published_pages_with_their_metadata(): void
    {
        $shell = tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title></head><body></body></html>');
        config(['storefront.shell_path' => $shell]);

        $this->store('Berry Kids', 'berry.test');
        $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'About', 'status' => 'published', 'seo_description' => 'Our story'])->assertCreated();
        $this->postJson('/api/v1/cms/pages', ['slug' => 'draft', 'title' => 'Draft'])->assertCreated();
        $this->asVisitor();

        $html = $this->get('http://berry.test/pages/about')->assertOk()->assertHeader('X-Robots-Tag', 'all')->getContent();
        $this->assertStringContainsString('<title>About | Berry Kids</title>', $html);
        $this->assertStringContainsString('<meta name="description" content="Our story">', $html);
        $this->get('http://berry.test/pages/draft')->assertNotFound();
        $this->get('http://berry.test/newsletter/confirm?token=x')->assertOk()->assertHeader('X-Robots-Tag', 'noindex');

        unlink($shell);
    }
}
