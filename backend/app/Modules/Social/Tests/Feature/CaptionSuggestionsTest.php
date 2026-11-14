<?php

namespace App\Modules\Social\Tests\Feature;

use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Social\Tests\Concerns\BuildsSocial;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P2b: caption suggestions — through the AI module (gate, budget, usage row) when it is on,
 * template captions in English or Bangla when it is off, fails or answers something unusable.
 */
class CaptionSuggestionsTest extends TestCase
{
    use BuildsSocial, InteractsWithAi, RefreshDatabase;

    /** @var array<string, mixed> */
    private array $shop;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shop = $this->socialShop();
    }

    public function test_template_captions_when_ai_is_off(): void
    {
        $en = $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['shirt']['id']])->assertOk()->json('data');
        $this->assertSame(['template', 'disabled'], [$en['source'], $en['reason']]);
        $this->assertCount(3, $en['captions']);
        $this->assertStringContainsString('Polo Shirt', $en['captions'][0]);
        $this->assertStringContainsString('Price: ৳450', $en['captions'][0]);
        $this->assertStringContainsString('#BerryKids #Shirts #Polo', $en['captions'][0]);

        $bn = $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['shirt']['id'], 'language' => 'bn', 'tone' => 'festive'])->assertOk()->json('data');
        $this->assertStringContainsString('উৎসব', $bn['captions'][0]);
        $this->assertStringContainsString('দাম: ৳450', $bn['captions'][0]);

        // A promotion shows as the sale price with its name.
        $this->postJson('/api/v1/promotions', [
            'name' => 'Cap week', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->shop['cap']['id']], 'trigger' => 'automatic',
        ])->assertCreated();
        $short = $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['cap']['id'], 'tone' => 'short'])->assertOk()->json('data.captions');
        $this->assertSame("Sun Cap — ৳108 (was ৳120) 👇\n#BerryKids", $short[0]);

        $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonValidationErrors('product_id', 'error.details');
        $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['cap']['id'], 'tone' => 'angry', 'language' => 'fr'])
            ->assertStatus(422)->assertJsonValidationErrors(['tone', 'language'], 'error.details');
        $this->actingAsUser($this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::Cashier));
        $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['cap']['id']])->assertForbidden();
    }

    public function test_ai_captions_are_metered_and_unusable_answers_fall_back(): void
    {
        $fake = $this->fakeAi();
        $fake->answer("```json\n".json_encode(['captions' => ['One ✨', 'Two 💛', 'Three 🎉']], JSON_UNESCAPED_UNICODE)."\n```", 300, 80);
        $ai = $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['shirt']['id'], 'language' => 'bn', 'tone' => 'short'])->assertOk()->json('data');
        $this->assertSame(['captions' => ['One ✨', 'Two 💛', 'Three 🎉'], 'source' => 'ai', 'reason' => null], $ai);

        // The model saw only the product's facts, in Bangla, and the rules.
        $request = $fake->requests[0];
        $this->assertStringContainsString('Bangla', $request['conversation']->system);
        $this->assertStringContainsString('JSON', $request['conversation']->system);
        /** @var Message $message */
        $message = $request['conversation']->messages[0];
        $facts = json_decode(substr($message->text(), strpos($message->text(), '{')), true);
        $this->assertSame(['name', 'price', 'sale_price', 'offer', 'store', 'brand', 'category', 'description'], array_keys($facts));
        $this->assertSame(['Polo Shirt', '450.00', 'Berry Kids', 'Polo'], [$facts['name'], $facts['price'], $facts['store'], $facts['brand']]);
        $this->assertSame([], $request['tools']);

        $row = DB::table('ai_requests')->first();
        $this->assertSame(['social_captions', 'ok', 300, 80], [$row->feature, $row->status, (int) $row->input_tokens, (int) $row->output_tokens]);
        $this->assertStringNotContainsString('One ✨', json_encode($row));

        // Not JSON, too few captions, a refusal, a provider failure → templates.
        $fake->answer('Here are some ideas: be happy!');
        $fake->answer(json_encode(['captions' => ['Only one']]));
        $fake->refuse();
        $fake->fail();
        foreach (['invalid_output', 'invalid_output', 'invalid_output', 'unavailable'] as $reason) {
            $fallback = $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['shirt']['id']])->assertOk()->json('data');
            $this->assertSame(['template', $reason], [$fallback['source'], $fallback['reason']]);
            $this->assertCount(3, $fallback['captions']);
        }

        // The organization's monthly budget is respected.
        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => 100])->assertOk();
        $budget = $this->postJson('/api/v1/social/caption-suggestions', ['product_id' => $this->shop['shirt']['id']])->assertOk()->json('data');
        $this->assertSame(['template', 'budget_exceeded'], [$budget['source'], $budget['reason']]);
        $this->assertSame(5, $fake->callCount(), 'No model call over budget.');
    }
}
