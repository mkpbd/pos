<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * AI2b §1: the shop assistant's settings in the storefront settings (off by default, audited,
 * validated) and the bootstrap's `assistant` — on only with the store's switch AND AI available,
 * greeting in the page's language, a hand-off that works, never limits or usage.
 */
class StoreAssistantSettingsTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const BOOTSTRAP = 'http://berry.test/api/v1/store/bootstrap';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    public function test_settings_are_off_by_default_validated_and_audited(): void
    {
        $this->getJson('/api/v1/storefront/settings')->assertOk()->assertJsonPath('data.assistant', [
            'enabled' => false,
            'name' => 'Shop assistant',
            'greeting' => null,
            'daily_conversation_limit' => 200,
            'handoff' => 'contact',
            'translations' => ['bn' => []],
        ]);

        $this->patchJson('/api/v1/storefront/settings', ['assistant' => [
            'enabled' => true,
            'name' => '  Berry helper ',
            'greeting' => 'Hi! Ask me about <b>sizes</b> and delivery.',
            'daily_conversation_limit' => 50,
            'handoff' => 'none',
            'translations' => ['bn' => ['greeting' => 'হ্যালো! সাইজ ও ডেলিভারি নিয়ে জিজ্ঞেস করুন।']],
        ]])->assertOk()->assertJsonPath('data.assistant', [
            'enabled' => true,
            'name' => 'Berry helper',
            'greeting' => 'Hi! Ask me about sizes and delivery.',
            'daily_conversation_limit' => 50,
            'handoff' => 'none',
            'translations' => ['bn' => ['greeting' => 'হ্যালো! সাইজ ও ডেলিভারি নিয়ে জিজ্ঞেস করুন।']],
        ]);

        // Partial: other fields are kept; a blank name falls back to the default.
        $this->patchJson('/api/v1/storefront/settings', ['assistant' => ['name' => '', 'translations' => ['bn' => ['greeting' => null]]]])
            ->assertOk()
            ->assertJsonPath('data.assistant.name', 'Shop assistant')
            ->assertJsonPath('data.assistant.daily_conversation_limit', 50)
            ->assertJsonPath('data.assistant.enabled', true)
            ->assertJsonPath('data.assistant.translations.bn', []);

        $audit = DB::table('audit_logs')->where('action', 'storefront.settings_updated')->pluck('new_values')->implode(' ');
        $this->assertStringContainsString('assistant_enabled', $audit);
        $this->assertStringContainsString('assistant_daily_limit', $audit);

        foreach ([
            ['name' => str_repeat('a', 41)],
            ['greeting' => str_repeat('a', 201)],
            ['daily_conversation_limit' => 0],
            ['daily_conversation_limit' => 2001],
            ['handoff' => 'phone'],
            ['enabled' => 'maybe'],
            ['limit' => 5],
            ['translations' => ['fr' => ['greeting' => 'Bonjour']]],
        ] as $bad) {
            $this->patchJson('/api/v1/storefront/settings', ['assistant' => $bad])->assertStatus(422);
        }
    }

    public function test_settings_need_storefront_manage(): void
    {
        $viewer = $this->createUserWithRole($this->t['organization'], $this->inTenant($this->t['organization'], function () {
            $role = Role::query()->create(['name' => 'Viewer']);
            $role->permissions()->sync(['storefront.view']);

            return $role;
        }));
        $this->actingAsUser($viewer);
        $this->getJson('/api/v1/storefront/settings')->assertOk()->assertJsonPath('data.assistant.enabled', false);
        $this->patchJson('/api/v1/storefront/settings', ['assistant' => ['enabled' => true]])->assertForbidden();
    }

    public function test_bootstrap_shows_the_assistant_only_when_switched_on_and_ai_is_available(): void
    {
        $this->asVisitor();
        $this->assertSame(['enabled' => false, 'name' => 'Shop assistant', 'greeting' => null, 'handoff' => 'none', 'handoff_url' => null], $this->getJson(self::BOOTSTRAP)->json('data.assistant'));

        $this->actingAsUser($this->t['admin']);
        $this->patchJson('/api/v1/storefront/settings', ['assistant' => ['enabled' => true, 'greeting' => 'Hello!', 'translations' => ['bn' => ['greeting' => 'হ্যালো!']]]])->assertOk();
        $this->asVisitor();
        // AI is off for the application: still off.
        $this->assertFalse($this->getJson(self::BOOTSTRAP)->json('data.assistant.enabled'));

        $this->fakeAi();
        $assistant = $this->getJson(self::BOOTSTRAP)->json('data.assistant');
        $this->assertTrue($assistant['enabled']);
        $this->assertSame('Hello!', $assistant['greeting']);
        $this->assertSame(['enabled', 'name', 'greeting', 'handoff', 'handoff_url'], array_keys($assistant));
        $this->assertSame('হ্যালো!', $this->getJson(self::BOOTSTRAP.'?lang=bn')->json('data.assistant.greeting'));

        // The organization turns AI off: the widget goes away (outside the content cache).
        $this->actingAsUser($this->t['admin']);
        $this->patchJson('/api/v1/ai/settings', ['enabled' => false])->assertOk();
        $this->asVisitor();
        $this->assertFalse($this->getJson(self::BOOTSTRAP)->json('data.assistant.enabled'));
    }

    public function test_the_handoff_falls_back_to_one_that_works(): void
    {
        // Contact without a contact page → none; with a visible page → the page.
        $this->asVisitor();
        $this->assertSame('none', $this->getJson(self::BOOTSTRAP)->json('data.assistant.handoff'));
        $this->actingAsUser($this->t['admin']);
        $this->postJson('/api/v1/cms/pages', ['slug' => 'contact', 'title' => 'Contact us', 'body_html' => '<p>Call us.</p>', 'status' => 'published'])->assertCreated();
        $this->asVisitor();
        $this->assertSame(['contact', '/pages/contact'], array_values(array_intersect_key($this->getJson(self::BOOTSTRAP)->json('data.assistant'), ['handoff' => 1, 'handoff_url' => 1])));

        // A WhatsApp number makes WhatsApp the default; chosen without a number → contact.
        $this->actingAsUser($this->t['admin']);
        $this->patchJson('/api/v1/storefront/settings', ['whatsapp_number' => '01712345678'])->assertOk()->assertJsonPath('data.assistant.handoff', 'whatsapp');
        $this->asVisitor();
        $this->assertSame('https://wa.me/8801712345678', $this->getJson(self::BOOTSTRAP)->json('data.assistant.handoff_url'));
        $this->actingAsUser($this->t['admin']);
        $this->patchJson('/api/v1/storefront/settings', ['assistant' => ['handoff' => 'whatsapp'], 'whatsapp_number' => null])->assertOk();
        $this->asVisitor();
        $this->assertSame('contact', $this->getJson(self::BOOTSTRAP)->json('data.assistant.handoff'));
    }
}
