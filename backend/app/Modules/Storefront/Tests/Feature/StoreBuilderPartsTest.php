<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B4: the store builder's header, footer, shop / product zones and CMS page designs — create
 * (blank, from the current design, from the CMS page), publish, the bootstrap / content page
 * payloads with draft previews, the data elements (countdown, discount, promoted product,
 * menu, FAQ list), custom HTML and its permission, products per row, tenant isolation.
 */
class StoreBuilderPartsTest extends TestCase
{
    use BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const STORE = 'http://berry.test/api/v1/store';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Date::setTestNow('2026-11-12T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    private function create(string $kind, string $key, string $title, string $from = 'blank'): string
    {
        return $this->postJson(self::DOCS, ['kind' => $kind, 'key' => $key, 'title' => $title, 'from' => $from])->assertCreated()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function saveDraft(string $id, array $content): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => $content]);
    }

    private function publishDoc(string $id): void
    {
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function el(string $id, string $type, array $props = [], array $extra = []): array
    {
        return ['id' => $id, 'type' => $type, 'props' => $props] + $extra;
    }

    /**
     * A one-section document holding the elements.
     *
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private function doc(array $elements): array
    {
        return ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]];
    }

    /**
     * @param  list<array<string, mixed>>  $items
     */
    private function menu(string $location, string $name, array $items): string
    {
        $id = $this->postJson('/api/v1/storefront/menus', ['name' => $name, 'location' => $location])->assertCreated()->json('data.id');
        $this->putJson("/api/v1/storefront/menus/{$id}/items", ['items' => $items])->assertOk();

        return $id;
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function cmsPage(string $slug, string $title, array $attributes = []): array
    {
        return $this->postJson('/api/v1/cms/pages', $attributes + ['slug' => $slug, 'title' => $title, 'status' => 'published'])->assertCreated()->json('data');
    }

    private function asVisitorNow(): void
    {
        $this->app['auth']->forgetGuards();
    }

    /**
     * The element ids of a render payload or document, in order.
     *
     * @param  array<string, mixed>  $payload
     * @return list<string>
     */
    private function elementIds(array $payload): array
    {
        $ids = [];
        foreach ($payload['sections'] as $section) {
            foreach ($section['columns'] as $column) {
                foreach ($column['elements'] as $element) {
                    $ids[] = $element['id'];
                }
            }
        }

        return $ids;
    }

    /**
     * Rendered elements by id.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, array<string, mixed>>
     */
    private function elements(array $payload): array
    {
        $result = [];
        foreach ($payload['sections'] as $section) {
            foreach ($section['columns'] as $column) {
                foreach ($column['elements'] as $element) {
                    $result[$element['id']] = $element;
                }
            }
        }

        return $result;
    }

    public function test_header_and_footer_start_from_the_current_design_and_go_live_in_the_bootstrap(): void
    {
        $main = $this->menu('main', 'Main', [['label' => 'Shop', 'url' => '/shop', 'children' => [['label' => 'Tea', 'url' => '/tea']]]]);
        $help = $this->menu('footer_1', 'Help', [['label' => 'Delivery', 'url' => '/delivery']]);
        $this->putJson('/api/v1/storefront/theme', ['footer' => ['about' => "Fresh food\nsince <2010>"]])->assertOk();

        $this->asVisitorNow();
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.builder.header', null)->assertJsonPath('data.builder.footer', null);
        $this->actingAsUser($this->t['admin']);

        $header = $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Header', 'from' => 'current'])->assertCreated()
            ->assertJsonPath('data.kind', 'header')
            ->assertJsonPath('data.path', null)
            ->assertJsonPath('data.preview_url', 'http://berry.test/?preview=draft')
            ->assertJsonPath('data.cms_page', null)
            ->json('data');
        $row = $header['content']['sections'][0]['columns'];
        $this->assertSame(['logo', 'search_box', 'language_switch', 'account_link', 'wishlist_link', 'cart_icon'], array_map(fn (array $c) => $c['elements'][0]['type'], $row));
        $this->assertSame(100, array_sum(array_map(fn (array $c) => $c['width']['base'], $row)));
        $this->assertSame(['menu_id' => $main, 'layout' => 'horizontal', 'show_children' => 'dropdown'], $header['content']['sections'][1]['columns'][0]['elements'][0]['props']);

        $footer = $this->postJson(self::DOCS, ['kind' => 'footer', 'key' => 'footer', 'title' => 'Footer', 'from' => 'current'])->assertCreated()->json('data');
        $columns = $footer['content']['sections'][0]['columns'];
        $this->assertCount(3, $columns);
        $this->assertSame(['logo', 'text', 'payment_icons'], array_column($columns[0]['elements'], 'type'));
        $this->assertSame('<p>Fresh food<br />since &lt;2010&gt;</p>', $columns[0]['elements'][1]['props']['html']);
        $this->assertSame(['heading', 'menu'], array_column($columns[1]['elements'], 'type'));
        $this->assertSame(['Help', $help, 'none'], [$columns[1]['elements'][0]['props']['text'], $columns[1]['elements'][1]['props']['menu_id'], $columns[1]['elements'][1]['props']['show_children']]);
        $this->assertSame(['heading', 'contact_block', 'social_icons'], array_column($columns[2]['elements'], 'type'));
        $this->assertEqualsWithDelta(100, array_sum(array_map(fn (array $c) => $c['width']['base'], $columns)), 0.001);
        $this->assertSame('copyright', $footer['content']['sections'][1]['columns'][0]['elements'][0]['type']);

        // One per key; `from` must fit the kind; keys must fit the kind.
        $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Again'])->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');
        foreach ([
            ['kind' => 'zone', 'key' => 'zone:listing.top', 'title' => 'Zone', 'from' => 'current'],
            ['kind' => 'header', 'key' => 'header', 'title' => 'Header', 'from' => 'homepage'],
            ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'cms'],
            ['kind' => 'footer', 'key' => 'header', 'title' => 'Mixed'],
            ['kind' => 'zone', 'key' => 'zone:cart.top', 'title' => 'Cart'],
            ['kind' => 'page', 'key' => 'cms:about', 'title' => 'About'],
        ] as $payload) {
            $this->postJson(self::DOCS, $payload)->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED');
        }
        $list = array_column($this->getJson(self::DOCS)->assertOk()->json('data'), null, 'key');
        $this->assertSame(['footer', 'header'], array_keys($list));
        $this->assertSame([null, null], [$list['header']['path'], $list['footer']['path']]);
        $this->assertSame('http://berry.test/?preview=draft', $list['footer']['preview_url']);

        // Published: the bootstrap carries the header (cache refreshed), its menu as bootstrap serves menus.
        $this->publishDoc($header['id']);
        $this->asVisitorNow();
        $bootstrap = $this->getJson(self::STORE.'/bootstrap')->assertOk()
            ->assertJsonPath('data.builder.header.document.key', 'header')
            ->assertJsonPath('data.builder.header.document.source', 'published')
            ->assertJsonPath('data.builder.footer', null)
            ->json('data');
        $menuElement = $header['content']['sections'][1]['columns'][0]['elements'][0]['id'];
        $this->assertSame(['name' => 'Main', 'items' => $bootstrap['menus']['main']['items']], $bootstrap['builder']['header']['data'][$menuElement]);
        $this->assertSame('Tea', $bootstrap['builder']['header']['data'][$menuElement]['items'][0]['children'][0]['label']);
        $this->assertSame(['logo', 'search_box', 'language_switch', 'account_link', 'wishlist_link', 'cart_icon', 'menu'], array_column($this->elements($bootstrap['builder']['header']), 'type'));
        // An inactive menu disappears from the published header.
        $this->actingAsUser($this->t['admin']);
        $this->patchJson("/api/v1/storefront/menus/{$main}", ['is_active' => false])->assertOk();
        $this->asVisitorNow();
        $this->assertNotContains($menuElement, $this->elementIds($this->getJson(self::STORE.'/bootstrap')->json('data.builder.header')));

        // The unpublished footer: drafts for staff previews only.
        $this->getJson(self::STORE.'/bootstrap?preview=draft')->assertOk()->assertJsonPath('data.builder.footer', null);
        $this->actingAsUser($this->t['admin']);
        $preview = $this->getJson(self::STORE.'/bootstrap?preview=draft')->assertOk()->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.builder.footer.document.source', 'draft')
            ->assertJsonPath('data.builder.header.document.source', 'draft')
            ->json('data.builder.header');
        $this->assertSame('inactive', $preview['data'][$menuElement]['state']);
        $this->getJson('/api/v1/storefront/builder/canvas-context')->assertOk()->assertJsonPath('data.bootstrap.builder.footer.document.source', 'draft');

        // Deleting the header: back to the theme's header.
        $this->deleteJson(self::DOCS."/{$header['id']}")->assertNoContent();
        $this->asVisitorNow();
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.builder.header', null);
    }

    public function test_zones_hold_page_elements_and_are_served_with_the_bootstrap(): void
    {
        $top = $this->create('zone', 'zone:listing.top', 'Listing top');
        $this->create('zone', 'zone:listing.bottom', 'Listing bottom');
        $product = $this->create('zone', 'zone:product.after', 'Product page');
        $this->postJson(self::DOCS, ['kind' => 'zone', 'key' => 'zone:listing.top', 'title' => 'Twice'])->assertStatus(409);

        // Previews: listing zones on /shop, the product zone on a live product (none yet).
        $list = array_column($this->getJson(self::DOCS)->assertOk()->json('data'), null, 'key');
        $this->assertSame(['zone', null, 'http://berry.test/shop?preview=draft'], [$list['zone:listing.top']['kind'], $list['zone:listing.top']['path'], $list['zone:listing.top']['preview_url']]);
        $this->assertSame('http://berry.test/shop?preview=draft', $list['zone:listing.bottom']['preview_url']);
        $this->assertSame([null, null], [$list['zone:product.after']['path'], $list['zone:product.after']['preview_url']]);
        $jam = $this->makeProduct($this->t['unit']->id, 'Mango Jam', [['JAM', '250.00']]);
        $this->publish($jam['id']);
        $slug = $this->getJson(self::STORE.'/products')->assertOk()->json('data.0.slug');
        $this->getJson(self::DOCS."/{$product}")->assertOk()->assertJsonPath('data.preview_url', "http://berry.test/product/{$slug}?preview=draft");

        // Header parts are not page elements.
        $this->saveDraft($top, $this->doc([$this->el('e_logo', 'logo', ['height' => 40, 'link' => ['url' => '/']])]))
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'DOCUMENT_INVALID')
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.columns.0.elements.0.type')
            ->assertJsonPath('error.details.errors.0.node_id', 'e_logo')
            ->assertJsonPath('error.details.errors.0.code', 'ELEMENT_NOT_ALLOWED');

        $this->saveDraft($top, $this->doc([
            $this->el('e_cta', 'cta', [
                'title' => 'Free delivery this week',
                'primary' => ['label' => 'Shop now', 'link' => ['url' => '/shop']],
                'secondary' => ['label' => 'Learn more', 'link' => ['url' => '/pages/delivery']],
            ], ['translations' => ['bn' => ['title' => 'এই সপ্তাহে ফ্রি ডেলিভারি', 'primary.label' => 'কিনুন']]]),
            $this->el('e_icon', 'icon', ['name' => 'truck', 'label' => 'Delivery']),
            $this->el('e_video', 'video', ['url' => 'https://youtu.be/dQw4w9WgXcQ', 'title' => 'How we deliver']),
        ]))->assertOk();
        $this->publishDoc($top);

        $this->asVisitorNow();
        $builder = $this->getJson(self::STORE.'/bootstrap')->assertOk()->json('data.builder');
        $this->assertSame(['listing.top', 'listing.bottom', 'product.after'], array_keys($builder['zones']));
        $this->assertSame([null, null], [$builder['zones']['listing.bottom'], $builder['zones']['product.after']]);
        $elements = $this->elements($builder['zones']['listing.top']);
        $this->assertSame(['Free delivery this week', 'Shop now', 'Learn more'], [$elements['e_cta']['props']['title'], $elements['e_cta']['props']['primary']['label'], $elements['e_cta']['props']['secondary']['label']]);
        $this->assertSame(['youtube', 'dQw4w9WgXcQ'], [$elements['e_video']['props']['provider'], $elements['e_video']['props']['video_id']]);
        $this->assertArrayNotHasKey('translations', $elements['e_cta']);

        $bn = $this->elements($this->getJson(self::STORE.'/bootstrap?lang=bn')->assertOk()->json('data.builder.zones')['listing.top']);
        $this->assertSame(['এই সপ্তাহে ফ্রি ডেলিভারি', 'কিনুন', 'Learn more'], [$bn['e_cta']['props']['title'], $bn['e_cta']['props']['primary']['label'], $bn['e_cta']['props']['secondary']['label']]);
    }

    public function test_cms_pages_are_designed_from_their_content_and_served_with_the_page(): void
    {
        $about = $this->cmsPage('about-us', 'About us', [
            'body_html' => '<p>We are <strong>Berry</strong>.</p>',
            'seo_title' => 'About Berry Kids',
            'translations' => ['bn' => ['title' => 'আমাদের সম্পর্কে', 'body_html' => '<p>আমরা বেরি।</p>']],
        ]);
        $faq = $this->cmsPage('faq', 'FAQ', ['template' => 'faq', 'body_html' => '<p>Answers.</p>']);
        $contact = $this->cmsPage('contact', 'Contact', ['template' => 'contact']);
        $this->postJson('/api/v1/cms/faq', ['group' => 'Delivery', 'question' => 'How fast?', 'answer_html' => '<p>Same day.</p>'])->assertCreated();

        $doc = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => "cms:{$about['id']}", 'title' => 'About us', 'from' => 'cms'])->assertCreated()
            ->assertJsonPath('data.path', '/pages/about-us')
            ->assertJsonPath('data.preview_url', 'http://berry.test/pages/about-us?preview=draft')
            ->assertJsonPath('data.cms_page', ['id' => $about['id'], 'title' => 'About us', 'slug' => 'about-us', 'status' => 'published', 'template' => 'default'])
            ->json('data');
        $elements = $doc['content']['sections'][0]['columns'][0]['elements'];
        $this->assertSame('boxed', $doc['content']['sections'][0]['props']['layout']);
        $this->assertSame(['heading', 'text'], array_column($elements, 'type'));
        $this->assertSame(['text' => 'About us', 'level' => 1, 'link' => null], $elements[0]['props']);
        $this->assertSame(['bn' => ['text' => 'আমাদের সম্পর্কে']], $elements[0]['translations']);
        $this->assertSame('<p>We are <strong>Berry</strong>.</p>', $elements[1]['props']['html']);
        $this->assertSame(['bn' => ['html' => '<p>আমরা বেরি।</p>']], $elements[1]['translations']);

        $faqDoc = $this->create('page', "cms:{$faq['id']}", 'FAQ', 'cms');
        $this->assertSame(['heading', 'text', 'faq_list'], array_column($this->getJson(self::DOCS."/{$faqDoc}")->json('data.content.sections.0.columns.0.elements'), 'type'));
        $contactDoc = $this->create('page', "cms:{$contact['id']}", 'Contact', 'cms');
        $this->assertSame(['heading', 'contact_form'], array_column($this->getJson(self::DOCS."/{$contactDoc}")->json('data.content.sections.0.columns.0.elements'), 'type'));

        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => "cms:{$about['id']}", 'title' => 'Again'])->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'cms:01a1c9d9-0000-7000-8000-000000000999', 'title' => 'Ghost'])->assertUnprocessable()->assertJsonPath('error.code', 'CMS_PAGE_NOT_FOUND');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:about', 'title' => 'About', 'from' => 'cms'])->assertUnprocessable();
        // FAQ list and contact form belong to content pages only.
        $home = $this->create('page', 'home', 'Home');
        $this->saveDraft($home, $this->doc([$this->el('e_faq', 'faq_list')]))->assertUnprocessable()->assertJsonPath('error.details.errors.0.code', 'ELEMENT_NOT_ALLOWED');

        $list = array_column($this->getJson(self::DOCS)->assertOk()->json('data'), null, 'key');
        $this->assertSame('faq', $list["cms:{$faq['id']}"]['cms_page']['template']);
        $this->assertNull($list['home']['cms_page']);

        // Not published yet: the page shows its CMS body.
        $this->asVisitorNow();
        $this->getJson(self::STORE.'/pages/about-us')->assertOk()->assertJsonPath('data.builder', null)->assertJsonPath('data.body_html', '<p>We are <strong>Berry</strong>.</p>');

        $this->actingAsUser($this->t['admin']);
        $this->publishDoc($doc['id']);
        $this->publishDoc($faqDoc);
        $this->asVisitorNow();
        $page = $this->getJson(self::STORE.'/pages/about-us')->assertOk()
            ->assertJsonPath('data.title', 'About us')
            ->assertJsonPath('data.seo_title', 'About Berry Kids')
            ->assertJsonPath('data.builder.document.key', "cms:{$about['id']}")
            ->assertJsonPath('data.builder.document.source', 'published')
            ->json('data.builder');
        $this->assertSame('About us', $this->elements($page)[$elements[0]['id']]['props']['text']);
        $this->getJson(self::STORE.'/pages/about-us?lang=bn')->assertOk()
            ->assertJsonPath('data.builder.sections.0.columns.0.elements.0.props.text', 'আমাদের সম্পর্কে');

        $faqPage = $this->getJson(self::STORE.'/pages/faq')->assertOk()->json('data');
        $faqElement = $this->getJson(self::STORE.'/pages/faq')->json('data.builder.sections.0.columns.0.elements.2.id');
        $this->assertSame(['groups' => $faqPage['faq']], $faqPage['builder']['data'][$faqElement]);
        $this->assertSame('How fast?', $faqPage['builder']['data'][$faqElement]['groups'][0]['items'][0]['question']);

        // Draft preview for staff; anyone else gets the published design.
        $this->actingAsUser($this->t['admin']);
        $this->saveDraft($doc['id'], $this->doc([$this->el('e_new', 'heading', ['text' => 'Our story', 'level' => 1])]))->assertOk();
        $this->getJson(self::STORE.'/pages/about-us?preview=draft')->assertOk()->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.builder.document.source', 'draft')
            ->assertJsonPath('data.builder.sections.0.columns.0.elements.0.props.text', 'Our story');
        $this->asVisitorNow();
        $this->getJson(self::STORE.'/pages/about-us?preview=draft')->assertOk()->assertJsonPath('data.builder.document.source', 'published');

        // Back to the classic page.
        $this->actingAsUser($this->t['admin']);
        $this->deleteJson(self::DOCS."/{$doc['id']}")->assertNoContent();
        $this->asVisitorNow();
        $this->getJson(self::STORE.'/pages/about-us')->assertOk()->assertJsonPath('data.builder', null);
    }

    public function test_a_long_cms_body_is_split_into_several_text_elements(): void
    {
        $paragraphs = array_map(fn (int $i) => '<p>'.str_repeat("Paragraph {$i}. ", 70).'</p>', range(1, 30));
        $body = implode('', $paragraphs);
        $this->assertGreaterThan(20000, mb_strlen($body));
        $page = $this->cmsPage('story', 'Story', ['body_html' => $body]);
        $stored = $this->getJson("/api/v1/cms/pages/{$page['id']}")->json('data.body_html');

        $id = $this->create('page', "cms:{$page['id']}", 'Story', 'cms');
        $texts = array_values(array_filter($this->getJson(self::DOCS."/{$id}")->json('data.content.sections.0.columns.0.elements'), fn (array $e) => $e['type'] === 'text'));
        $this->assertGreaterThan(1, count($texts));
        foreach ($texts as $text) {
            $this->assertLessThanOrEqual(20000, mb_strlen($text['props']['html']));
        }
        $this->assertSame(preg_replace('/\s+/', '', $stored), preg_replace('/\s+/', '', implode('', array_map(fn (array $t) => $t['props']['html'], $texts))));
    }

    public function test_custom_html_is_sanitized_and_adding_or_changing_it_needs_its_permission(): void
    {
        $org = $this->t['organization'];
        $home = $this->create('page', 'home', 'Home');
        $dirty = '<p class="x" id="y" onclick="steal()" style="color:red">Hi <script>alert(1)</script><a href="javascript:alert(1)">x</a></p><iframe src="https://evil.test"></iframe><style>p{}</style><link rel="stylesheet" href="https://evil.test/a.css">';
        $saved = $this->saveDraft($home, $this->doc([
            $this->el('e_title', 'heading', ['text' => 'Welcome']),
            $this->el('e_html', 'custom_html', ['html' => $dirty]),
        ]))->assertOk()->json('data.content.sections.0.columns.0.elements.1.props.html');
        foreach (['script', 'onclick', 'class=', 'id=', 'style', 'iframe', 'javascript:', '<link'] as $needle) {
            $this->assertStringNotContainsString($needle, $saved, $needle);
        }
        $this->assertStringContainsString('Hi', $saved);
        $this->saveDraft($home, $this->doc([$this->el('e_bad', 'custom_html', ['html' => '<script>alert(1)</script><iframe src="https://x.test"></iframe>'])]))
            ->assertUnprocessable()->assertJsonPath('error.details.errors.0.path', 'sections.0.columns.0.elements.0.props.html');

        $this->assertTrue($this->t['admin']->fresh()->can('storefront.custom_html'));
        $manager = $this->createUserWithRole($org, SystemRole::OnlineStoreManager);
        $this->assertFalse($manager->can('storefront.custom_html'));
        $this->actingAsUser($manager);

        $title = $this->el('e_title', 'heading', ['text' => 'Welcome']);
        $html = $this->el('e_html', 'custom_html', ['html' => $saved]);
        // Changing its HTML or adding one: 403 naming the node.
        $this->saveDraft($home, $this->doc([$title, $this->el('e_html', 'custom_html', ['html' => '<p>Changed</p>'])]))
            ->assertForbidden()
            ->assertJsonPath('error.code', 'CUSTOM_HTML_FORBIDDEN')
            ->assertJsonPath('error.details.errors.0.node_id', 'e_html')
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.columns.0.elements.1.props.html')
            ->assertJsonPath('error.details.errors.0.code', 'CUSTOM_HTML_FORBIDDEN');
        $this->saveDraft($home, $this->doc([$title, $html, $this->el('e_more', 'custom_html', ['html' => '<p>More</p>'])]))
            ->assertForbidden()->assertJsonPath('error.details.errors.0.node_id', 'e_more')->assertJsonPath('error.details.errors.0.path', 'sections.0.columns.0.elements.2');
        // Moving, hiding, restyling it and editing other nodes is fine; so is deleting it.
        $this->saveDraft($home, $this->doc([
            $html + ['hidden' => true, 'style' => ['base' => ['spacing' => ['margin' => ['top' => '8px']]]]],
            $this->el('e_title', 'heading', ['text' => 'Welcome back']),
        ]))->assertOk();
        // The same HTML written differently is unchanged once sanitized.
        $this->saveDraft($home, $this->doc([$this->el('e_html', 'custom_html', ['html' => $dirty])]))->assertOk();
        $this->saveDraft($home, $this->doc([$title]))->assertOk();
        $this->assertSame(['e_title'], $this->elementIds($this->getJson(self::DOCS."/{$home}")->json('data.content')));
    }

    public function test_data_elements_show_promotions_products_and_drop_what_is_not_running(): void
    {
        $org = $this->t['organization'];
        $mango = $this->makeProduct($this->t['unit']->id, 'Mango Jam', [['JAM', '250.00']]);
        $this->publish($mango['id']);
        $tea = $this->makeProduct($this->t['unit']->id, 'Hidden Tea', [['TEA', '90.00']]);
        $flash = $this->makePromotion($org, ['name' => 'Jam flash sale', 'type' => 'percent', 'value' => '20', 'scope' => 'products', 'target_ids' => [$mango['id']], 'show_countdown' => true, 'ends_at' => '2026-11-15T10:00:00+06:00']);
        $welcome = $this->makePromotion($org, ['name' => 'Welcome', 'type' => 'percent', 'value' => '10', 'trigger' => 'coupon', 'min_subtotal' => '500', 'ends_at' => '2026-11-20T00:00:00+06:00']);
        $this->makeCoupon($org, $welcome, 'WELCOME10');
        $paused = $this->makePromotion($org, ['name' => 'Paused', 'type' => 'fixed', 'value' => '50', 'is_active' => false]);
        $freeShipping = $this->makePromotion($org, ['name' => 'Free delivery', 'type' => 'free_shipping']);

        $home = $this->create('page', 'home', 'Home');
        // Ids that are not of the right kind are refused like missing ones.
        $this->saveDraft($home, $this->doc([
            $this->el('e_flash', 'countdown', ['source' => 'promotion', 'promotion_id' => $welcome->id]),
            $this->el('e_ship', 'discount', ['promotion_id' => $freeShipping->id]),
            $this->el('e_ghost', 'promo_card', ['product_id' => '01a1c9d9-0000-7000-8000-000000000999']),
        ]))->assertUnprocessable()->assertJsonPath('error.details.errors.*.code', ['PROMOTION_NOT_FOUND', 'DISCOUNT_NOT_FOUND', 'PRODUCT_NOT_FOUND']);

        $this->saveDraft($home, $this->doc([
            $this->el('e_soon', 'countdown', ['source' => 'date', 'ends_at' => '2026-11-12T12:00:00+06:00', 'title' => 'Ends soon']),
            $this->el('e_over', 'countdown', ['source' => 'date', 'ends_at' => '2026-11-01T00:00:00+06:00']),
            $this->el('e_over_text', 'countdown', ['source' => 'date', 'ends_at' => '2026-11-01T00:00:00+06:00', 'expired_text' => 'See you next time']),
            $this->el('e_flash', 'countdown', ['source' => 'promotion', 'promotion_id' => $flash->id]),
            $this->el('e_code', 'discount', ['promotion_id' => $welcome->id, 'title' => 'Welcome gift']),
            $this->el('e_no_code', 'discount', ['promotion_id' => $welcome->id, 'show_code' => false]),
            $this->el('e_paused', 'discount', ['promotion_id' => $paused->id]),
            $this->el('e_jam', 'promo_card', ['product_id' => $mango['id'], 'badge' => 'Hot']),
            $this->el('e_tea', 'promo_card', ['product_id' => $tea['id']]),
        ]))->assertOk();
        $this->publishDoc($home);

        $this->asVisitorNow();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertSame(['e_soon', 'e_over_text', 'e_flash', 'e_code', 'e_no_code', 'e_jam'], $this->elementIds($page));
        $this->assertSame(['ends_at' => '2026-11-12T12:00:00+06:00', 'title' => 'Ends soon', 'promotion' => null], $page['data']['e_soon']);
        $this->assertSame(['ends_at' => '2026-11-01T00:00:00+06:00', 'title' => null, 'promotion' => null], $page['data']['e_over_text']);
        $this->assertSame(['ends_at' => $flash->ends_at->toIso8601String(), 'title' => 'Jam flash sale', 'promotion' => ['id' => $flash->id, 'name' => 'Jam flash sale']], $page['data']['e_flash']);
        $this->assertSame(['name' => 'Welcome', 'kind' => 'percent', 'value' => '10.00', 'coupon_code' => 'WELCOME10', 'min_subtotal' => '500.00', 'ends_at' => $welcome->ends_at->toIso8601String()], $page['data']['e_code']);
        $this->assertNull($page['data']['e_no_code']['coupon_code']);
        $card = $this->getJson(self::STORE.'/products')->assertOk()->json('data.0');
        $this->assertSame($card, $page['data']['e_jam']);
        $this->assertSame('Mango Jam', $page['data']['e_jam']['name']);

        // The draft keeps everything, saying why visitors would not see it.
        $this->actingAsUser($this->t['admin']);
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame('expired', $draft['data']['e_over']['state']);
        $this->assertSame('inactive', $draft['data']['e_paused']['state']);
        $this->assertArrayNotHasKey('state', $draft['data']['e_code']);
        $this->assertArrayNotHasKey('e_tea', $draft['data']);
        $this->assertSame('empty', $this->elements($draft)['e_tea']['state']);

        // The cached page changes when the countdown runs out, without a write.
        $this->asVisitorNow();
        Date::setTestNow('2026-11-12T12:30:00+06:00');
        $this->assertNotContains('e_soon', $this->elementIds($this->getJson(self::STORE.'/builder/pages/home')->json('data')));
        // …and when the coupon promotion is switched off (a write that refreshes the storefront).
        $this->actingAsUser($this->t['admin']);
        $this->patchJson("/api/v1/promotions/{$welcome->id}", ['is_active' => false])->assertOk();
        $this->asVisitorNow();
        $this->assertSame(['e_over_text', 'e_flash', 'e_jam'], $this->elementIds($this->getJson(self::STORE.'/builder/pages/home')->json('data')));
    }

    public function test_the_canvas_resolver_resolves_b4_data_elements_one_by_one(): void
    {
        $org = $this->t['organization'];
        $mango = $this->makeProduct($this->t['unit']->id, 'Mango Jam', [['JAM', '250.00']]);
        $this->publish($mango['id']);
        $tea = $this->makeProduct($this->t['unit']->id, 'Hidden Tea', [['TEA', '90.00']]);
        $flash = $this->makePromotion($org, ['name' => 'Jam flash sale', 'type' => 'percent', 'value' => '20', 'scope' => 'products', 'target_ids' => [$mango['id']], 'show_countdown' => true, 'ends_at' => '2026-11-15T10:00:00+06:00']);
        $paused = $this->makePromotion($org, ['name' => 'Paused', 'type' => 'fixed', 'value' => '50', 'is_active' => false]);
        $main = $this->menu('main', 'Main', [['label' => 'Shop', 'url' => '/shop']]);
        $help = $this->menu('footer_1', 'Help', [['label' => 'Delivery', 'url' => '/delivery']]);
        $this->postJson('/api/v1/cms/faq', ['question' => 'How fast?', 'answer_html' => '<p>Same day.</p>'])->assertCreated();

        $other = $this->openStore('Mango Mart', 'mango.test');
        $otherProduct = $this->makeProduct($other['unit']->id, 'Other Jam', [['OJ', '10.00']]);
        $this->publish($otherProduct['id']);
        $otherMenu = $this->menu('main', 'Other', [['label' => 'Theirs', 'url' => '/x']]);
        $otherPromotion = $this->makePromotion($other['organization'], ['name' => 'Theirs', 'type' => 'percent', 'value' => '5']);
        $this->actingAsUser($this->t['admin']);

        $response = $this->postJson('/api/v1/storefront/builder/resolve', ['elements' => [
            ['id' => 'e_flash', 'type' => 'countdown', 'props' => ['source' => 'promotion', 'promotion_id' => $flash->id], 'translations' => []],
            ['id' => 'e_over', 'type' => 'countdown', 'props' => ['source' => 'date', 'ends_at' => '2026-11-01T00:00:00+06:00']],
            ['id' => 'e_bad_date', 'type' => 'countdown', 'props' => ['source' => 'date', 'ends_at' => 'tomorrow']],
            ['id' => 'e_paused', 'type' => 'discount', 'props' => ['promotion_id' => $paused->id, 'show_code' => false]],
            ['id' => 'e_theirs', 'type' => 'discount', 'props' => ['promotion_id' => $otherPromotion->id]],
            ['id' => 'e_jam', 'type' => 'promo_card', 'props' => ['product_id' => $mango['id']]],
            ['id' => 'e_tea', 'type' => 'promo_card', 'props' => ['product_id' => $tea['id']]],
            ['id' => 'e_their_jam', 'type' => 'promo_card', 'props' => ['product_id' => $otherProduct['id']]],
            ['id' => 'e_main', 'type' => 'menu', 'props' => ['menu_id' => $main, 'show_children' => 'mega']],
            ['id' => 'e_help', 'type' => 'menu', 'props' => ['menu_id' => $help, 'layout' => 'vertical', 'show_children' => 'list']],
            ['id' => 'e_their_menu', 'type' => 'menu', 'props' => ['menu_id' => $otherMenu]],
            ['id' => 'e_faq', 'type' => 'faq_list', 'props' => ['title' => 'Questions'], 'translations' => ['bn' => ['title' => 'প্রশ্ন']]],
            ['id' => 'e_contact', 'type' => 'contact_form', 'props' => []],
            ['id' => 'e_logo', 'type' => 'logo', 'props' => []],
        ]])->assertOk()->json('data');

        $this->assertSame(['ends_at' => $flash->ends_at->toIso8601String(), 'title' => 'Jam flash sale', 'promotion' => ['id' => $flash->id, 'name' => 'Jam flash sale']], $response['data']['e_flash']);
        $this->assertSame(['ends_at' => '2026-11-01T00:00:00+06:00', 'title' => null, 'promotion' => null, 'state' => 'expired'], $response['data']['e_over']);
        $this->assertSame(['name' => 'Paused', 'kind' => 'fixed', 'value' => '50.00', 'coupon_code' => null, 'min_subtotal' => null, 'ends_at' => null, 'state' => 'inactive'], $response['data']['e_paused']);
        $this->assertSame('Mango Jam', $response['data']['e_jam']['name']);
        $this->assertSame(['name' => 'Main', 'items' => $this->getJson(self::STORE.'/bootstrap')->json('data.menus.main.items')], $response['data']['e_main']);
        $this->assertSame('Delivery', $response['data']['e_help']['items'][0]['label']);
        $this->assertSame('How fast?', $response['data']['e_faq']['groups'][0]['items'][0]['question']);
        $this->assertArrayNotHasKey('e_contact', $response['data']);
        $this->assertArrayNotHasKey('e_contact', $response['errors']);

        $this->assertSame(['e_bad_date', 'e_theirs', 'e_tea', 'e_their_jam', 'e_their_menu', 'e_logo'], array_keys($response['errors']));
        $this->assertSame('props.ends_at', $response['errors']['e_bad_date'][0]['path']);
        $this->assertSame(['DISCOUNT_NOT_FOUND', [$otherPromotion->id]], [$response['errors']['e_theirs'][0]['code'], $response['errors']['e_theirs'][0]['ids']]);
        $this->assertSame(['props.product_id', 'PRODUCT_UNAVAILABLE'], [$response['errors']['e_tea'][0]['path'], $response['errors']['e_tea'][0]['code']]);
        $this->assertSame('PRODUCT_NOT_FOUND', $response['errors']['e_their_jam'][0]['code']);
        $this->assertSame('MENU_NOT_FOUND', $response['errors']['e_their_menu'][0]['code']);
        $this->assertSame('type', $response['errors']['e_logo'][0]['path']);
        foreach (['e_theirs', 'e_tea', 'e_their_jam', 'e_their_menu', 'e_logo', 'e_bad_date'] as $id) {
            $this->assertArrayNotHasKey($id, $response['data']);
        }

        // Bangla.
        $bn = $this->postJson('/api/v1/storefront/builder/resolve', ['locale' => 'bn', 'elements' => [
            ['id' => 'e_flash', 'type' => 'countdown', 'props' => ['source' => 'promotion', 'promotion_id' => $flash->id, 'title' => 'Hurry'], 'translations' => ['bn' => ['title' => 'তাড়াতাড়ি']]],
        ]])->assertOk()->json('data.data.e_flash');
        $this->assertSame('তাড়াতাড়ি', $bn['title']);
    }

    public function test_products_per_row_are_validated_and_survive_presets(): void
    {
        $this->assertSame(['desktop' => 3, 'tablet' => 3, 'mobile' => 2], $this->getJson('/api/v1/storefront/theme')->assertOk()->json('data.settings.layout.listing_columns'));
        foreach ([
            ['desktop' => 6], ['desktop' => 2], ['tablet' => 1], ['tablet' => 5], ['mobile' => 3], ['mobile' => 0], ['desktop' => 4.5], ['desktop' => 'four'],
        ] as $columns) {
            $this->putJson('/api/v1/storefront/theme', ['layout' => ['listing_columns' => $columns]])->assertUnprocessable();
        }
        $this->putJson('/api/v1/storefront/theme', ['layout' => ['listing_columns' => ['desktop' => 5, 'mobile' => 1]]])->assertOk()
            ->assertJsonPath('data.settings.layout.listing_columns', ['desktop' => 5, 'tablet' => 3, 'mobile' => 1]);
        $this->asVisitorNow();
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.theme.layout.listing_columns', ['desktop' => 5, 'tablet' => 3, 'mobile' => 1]);

        // Theme draft flow: saved with the draft, kept when a preset is applied, live on publish.
        $this->actingAsUser($this->t['admin']);
        $draft = $this->getJson('/api/v1/storefront/theme/draft')->assertOk()->json('data');
        $settings = $draft['settings'];
        $settings['layout']['listing_columns'] = ['desktop' => 4, 'tablet' => 2, 'mobile' => 2];
        $this->putJson('/api/v1/storefront/theme/draft', ['revision' => $draft['draft_revision'], 'settings' => $settings])->assertOk();
        $this->putJson('/api/v1/storefront/theme/draft', ['revision' => $draft['draft_revision'] + 1, 'settings' => ['layout' => ['listing_columns' => ['tablet' => 6]]]])->assertUnprocessable();
        $this->postJson('/api/v1/storefront/theme/presets/classic/apply')->assertOk();
        $this->getJson('/api/v1/storefront/theme/draft')->assertOk()
            ->assertJsonPath('data.settings.preset', 'classic')
            ->assertJsonPath('data.settings.layout.listing_columns', ['desktop' => 4, 'tablet' => 2, 'mobile' => 2]);
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $this->asVisitorNow();
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.theme.layout.listing_columns', ['desktop' => 4, 'tablet' => 2, 'mobile' => 2]);
    }

    public function test_another_store_never_sees_or_uses_this_stores_parts(): void
    {
        $berryAbout = $this->cmsPage('about', 'About Berry', ['body_html' => '<p>Berry</p>']);
        $berryMenu = $this->menu('main', 'Berry main', [['label' => 'Berry shop', 'url' => '/shop']]);
        $header = $this->create('header', 'header', 'Berry header', 'current');
        $this->publishDoc($header);

        $mango = $this->openStore('Mango Mart', 'mango.test');
        // Mango's admin cannot open, design from or point at Berry's records.
        $this->getJson(self::DOCS."/{$header}")->assertNotFound();
        $this->getJson(self::DOCS)->assertOk()->assertJsonCount(0, 'data');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => "cms:{$berryAbout['id']}", 'title' => 'Steal', 'from' => 'cms'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'CMS_PAGE_NOT_FOUND');
        $mangoHeader = $this->create('header', 'header', 'Mango header');
        $this->saveDraft($mangoHeader, $this->doc([$this->el('e_menu', 'menu', ['menu_id' => $berryMenu])]))
            ->assertUnprocessable()->assertJsonPath('error.details.errors.0.code', 'MENU_NOT_FOUND');
        // The same keys are free in another organization.
        $this->saveDraft($mangoHeader, $this->doc([$this->el('e_logo', 'logo', ['height' => 40])]))->assertOk();
        $this->publishDoc($mangoHeader);

        $this->asVisitorNow();
        $this->getJson('http://mango.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.builder.header.document.title', 'Mango header');
        $berry = $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.builder.header.document.title', 'Berry header')->json('data.builder.header');
        $this->assertContains('Berry shop', array_column(array_merge(...array_map(fn (array $d) => $d['items'] ?? [], array_values($berry['data']))), 'label'));
        $this->getJson('http://mango.test/api/v1/store/pages/about')->assertNotFound();

        // Berry staff previewing Mango's store get Mango's published parts, not drafts.
        $this->actingAsUser($this->t['admin']);
        $this->getJson('http://mango.test/api/v1/store/bootstrap?preview=draft')->assertOk()
            ->assertJsonPath('data.builder.header.document.source', 'published')
            ->assertJsonPath('data.builder.header.document.title', 'Mango header');
        $this->assertNotNull($mango['admin']);
    }
}
