<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * P2a: the order form element (props normalized and checked), campaign pages from the landing
 * templates (for a chosen product) and a domain's entry page.
 */
class LandingPagesTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    /** @var array<string, mixed> */
    private array $t;

    private string $tea;

    private string $mug;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
        $tea = $this->makeProduct($this->t['unit']->id, 'Green Tea', [['TEA', '350.00']]);
        $mug = $this->makeProduct($this->t['unit']->id, 'Mug', [['MUG', '200.00']]);
        $this->publish($tea['id'], ['is_published' => true, 'is_featured' => true]);
        $this->publish($mug['id']);
        $this->tea = $tea['id'];
        $this->mug = $mug['id'];
    }

    /**
     * @param  array<string, mixed>  $props
     */
    private function saveOrderForm(string $document, array $props): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$document}")->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$document}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [['id' => 'e_order', 'type' => 'order_form', 'props' => $props]]]],
        ]]]]);
    }

    public function test_order_form_props_are_normalized_and_checked(): void
    {
        $meta = collect($this->getJson('/api/v1/storefront/builder/elements')->assertOk()->json('data.types'))->firstWhere('type', 'order_form');
        $this->assertSame(['commerce', 'Order form', ['page', 'cms', 'zone'], true], [$meta['group'], $meta['label'], $meta['allowed_in'], $meta['has_data']]);
        $this->assertSame(['title', 'text', 'button_label', 'success_message', 'upsell.label'], $meta['translatable']);
        $this->assertNull($meta['props']['product_id']);

        $document = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:tea', 'title' => 'Tea'])->assertCreated()->json('data.id');
        $saved = $this->saveOrderForm($document, ['product_id' => strtoupper($this->tea), 'upsell' => ['product_id' => $this->mug, 'label' => 'Add a mug']])
            ->assertOk()->json('data.content.sections.0.columns.0.elements.0.props');
        $this->assertSame([
            'product_id' => $this->tea, 'title' => 'Order now', 'text' => '', 'show_variants' => true, 'quantity' => ['default' => 1, 'max' => 10],
            'fields' => ['email' => 'optional', 'note' => 'optional'], 'payment' => 'cod_only', 'button_label' => 'Confirm order',
            'success_message' => 'Thank you! Your order has been placed. We will call you soon to confirm it.',
            'upsell' => ['product_id' => $this->mug, 'label' => 'Add a mug'], 'layout' => 'stacked',
        ], $saved);

        $errors = $this->saveOrderForm($document, [
            'product_id' => null, 'quantity' => ['default' => 5, 'max' => 3], 'fields' => ['email' => 'always', 'note' => 'required'],
            'payment' => 'card', 'button_label' => '', 'upsell' => ['product_id' => $this->tea, 'label' => ''], 'layout' => 'grid',
        ])->assertStatus(422)->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors');
        $paths = array_map(fn (array $e) => str_replace('sections.0.columns.0.elements.0.props.', '', $e['path']), $errors);
        $this->assertEqualsCanonicalizing(['product_id', 'quantity.default', 'fields.email', 'fields.note', 'payment', 'button_label', 'upsell.label', 'layout'], $paths);
        // Not allowed in popups; an unknown product is a missing reference.
        $this->saveOrderForm($document, ['product_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonPath('error.details.errors.0.code', 'PRODUCT_NOT_FOUND');
        $this->saveOrderForm($document, ['product_id' => $this->tea, 'upsell' => ['product_id' => $this->tea, 'label' => 'Again']])->assertStatus(422);

        // Canvas data for an unsaved element.
        $resolved = $this->postJson('/api/v1/storefront/builder/resolve', ['elements' => [['id' => 'e_order', 'type' => 'order_form', 'props' => ['product_id' => $this->tea]]]])->assertOk()->json('data');
        $this->assertSame($this->tea, $resolved['data']['e_order']['product']['id']);
        $this->assertSame([], (array) $resolved['errors']);
    }

    public function test_landing_templates_are_listed_and_make_campaign_pages_for_a_product(): void
    {
        $landing = $this->getJson('/api/v1/storefront/builder/templates?scope=page&context=page')->assertOk()->json('data');
        $ids = array_column(array_filter($landing, fn (array $t) => $t['category'] === 'landing'), 'id');
        $this->assertSame(['landing-order', 'landing-eid-sale', 'landing-new-arrival', 'landing-lead'], array_values($ids));
        $order = collect($landing)->firstWhere('id', 'landing-order');
        $this->assertSame([['product', 'products'], '/builder-templates/landing-order.png', ['page']], [$order['requires'], $order['thumbnail_url'], $order['allowed_in']]);
        $this->assertSame([], collect($landing)->firstWhere('id', 'landing-lead')['requires']);

        // For the chosen product (not the featured one).
        $page = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:mug-offer', 'title' => 'Mug offer', 'from' => 'template', 'template' => 'landing-order', 'product_id' => $this->mug])
            ->assertCreated()->json('data');
        $content = $this->getJson(self::DOCS."/{$page['id']}")->assertOk()->json('data.content');
        $types = [];
        BuilderDocumentSchema::walk($content, function (array $node, string $path, string $kind) use (&$types) {
            if ($kind === 'element') {
                $types[$node['type']] = $node['props']['product_id'] ?? null;
            }
        });
        $this->assertSame($this->mug, $types['order_form']);
        $this->assertSame($this->mug, $types['product_spotlight']);
        $this->assertSame($this->mug, $types['review_wall']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_created']);

        // Without a product: the store's featured one. Every landing template makes a valid page.
        foreach (['landing-order', 'landing-eid-sale', 'landing-new-arrival', 'landing-lead'] as $i => $template) {
            $doc = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => "landing:t{$i}", 'title' => $template, 'from' => 'template', 'template' => $template])->assertCreated()->json('data.id');
            $this->postJson(self::DOCS."/{$doc}/publish")->assertOk();
        }
        $first = $this->getJson(self::DOCS.'/'.$this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:featured', 'title' => 'F', 'from' => 'template', 'template' => 'landing-new-arrival'])->json('data.id'))->json('data.content');
        $this->assertStringContainsString($this->tea, (string) json_encode($first));

        // Errors.
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:x1', 'title' => 'X', 'from' => 'template', 'template' => 'landing-order', 'product_id' => (string) Str::uuid()])
            ->assertStatus(422)->assertJsonValidationErrors('product_id', 'error.details');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:x2', 'title' => 'X', 'from' => 'template', 'template' => 'popup-newsletter'])
            ->assertStatus(422)->assertJsonValidationErrors('template', 'error.details');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'X', 'from' => 'template', 'template' => 'landing-order'])
            ->assertStatus(422)->assertJsonValidationErrors('from', 'error.details');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:mug-offer', 'title' => 'X', 'from' => 'template', 'template' => 'landing-order'])
            ->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');

        // Another organization's product is not found.
        $other = $this->openStore('Other', 'other.test');
        $cap = $this->makeProduct($other['unit']->id, 'Cap', [['CAP', '10.00']]);
        $this->actingAsUser($this->t['admin']);
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:x3', 'title' => 'X', 'from' => 'template', 'template' => 'landing-order', 'product_id' => $cap['id']])
            ->assertStatus(422)->assertJsonValidationErrors('product_id', 'error.details');
    }

    public function test_a_domain_opens_on_its_entry_page(): void
    {
        $domains = $this->getJson('/api/v1/storefront/domains')->assertOk()->json('data');
        $this->assertNull($domains[0]['entry_path']);
        $second = $this->postJson('/api/v1/storefront/domains', ['host' => 'eid.berry.test', 'entry_path' => '/p/eid-sale'])->assertCreated()->json('data');
        $this->assertSame(['/p/eid-sale', false], [$second['entry_path'], $second['is_primary']]);

        foreach (['/', 'p/eid', '//evil.test', '/p/eid?x=1', '/a b', '/api/v1/x', '/go/eid'] as $bad) {
            $this->patchJson("/api/v1/storefront/domains/{$second['id']}", ['entry_path' => $bad])->assertStatus(422)->assertJsonValidationErrors('entry_path', 'error.details');
        }
        $this->patchJson("/api/v1/storefront/domains/{$second['id']}", [])->assertStatus(422);
        $this->patchJson("/api/v1/storefront/domains/{$domains[0]['id']}", ['entry_path' => '/p/winter'])->assertOk()
            ->assertJsonPath('data.entry_path', '/p/winter')->assertJsonPath('data.is_primary', true);

        $this->app['auth']->forgetGuards();
        $this->getJson('http://eid.berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.entry_path', '/p/eid-sale');
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.entry_path', '/p/winter');

        $this->actingAsUser($this->t['admin']);
        $this->patchJson("/api/v1/storefront/domains/{$domains[0]['id']}", ['entry_path' => null])->assertOk()->assertJsonPath('data.entry_path', null);
        $this->patchJson("/api/v1/storefront/domains/{$second['id']}", ['is_primary' => true])->assertOk()
            ->assertJsonPath('data.is_primary', true)->assertJsonPath('data.entry_path', '/p/eid-sale');
        $this->app['auth']->forgetGuards();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.entry_path', null);
    }
}
