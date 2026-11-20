<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Llm\TextBlock;
use App\Modules\AI\Infrastructure\Models\AiRequest;
use App\Modules\AI\Infrastructure\Providers\FakeLanguageModel;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Shared\Application\Contracts\AiJsonWriter;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AI2a: Shared's AiJsonWriter — the structured-output request, gate, budget, usage row (no prompt
 * or answer stored) and every status; the fake model's scripted and schema-synthesized JSON.
 */
class AiJsonWriterTest extends TestCase
{
    use InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const SCHEMA = [
        'type' => 'object',
        'additionalProperties' => false,
        'required' => ['title', 'tone', 'tags', 'details', 'count', 'ok'],
        'properties' => [
            'title' => ['type' => 'string'],
            'tone' => ['type' => 'string', 'enum' => ['warm', 'formal']],
            'tags' => ['type' => 'array', 'items' => ['type' => 'string']],
            'details' => ['type' => 'object', 'additionalProperties' => false, 'required' => ['paragraphs'], 'properties' => [
                'paragraphs' => ['type' => 'array', 'items' => ['type' => 'string']],
            ]],
            'count' => ['type' => 'integer'],
            'ok' => ['type' => 'boolean'],
        ],
    ];

    private string $organizationId;

    private string $userId;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = $this->provisionTenant('Berry Kids');
        $this->organizationId = $tenant['organization']->id;
        $this->userId = $tenant['admin']->id;
    }

    /**
     * @return array{status: string, data: ?array<string, mixed>}
     */
    private function write(): array
    {
        return app(AiJsonWriter::class)->write($this->organizationId, $this->userId, 'catalog_writer', 'You write.', 'Secret facts: Blue Cotton Shirt', self::SCHEMA, 1500);
    }

    public function test_a_structured_answer_is_decoded_metered_and_never_stored(): void
    {
        $fake = $this->fakeAi()->answerJson(['title' => 'Blue shirt', 'tone' => 'warm', 'tags' => ['cotton'], 'details' => ['paragraphs' => ['Soft.']], 'count' => 2, 'ok' => true], 300, 60);

        $result = $this->write();

        $this->assertSame('ok', $result['status']);
        $this->assertSame('Blue shirt', $result['data']['title']);
        $this->assertSame(['Soft.'], $result['data']['details']['paragraphs']);
        $options = $fake->requests[0]['options'];
        $this->assertSame(self::SCHEMA, $options->outputSchema);
        $this->assertSame(1500, $options->maxTokens);
        $this->assertSame([], $fake->requests[0]['tools']);
        $this->assertSame('You write.', $fake->requests[0]['conversation']->system);

        $row = AiRequest::query()->withoutGlobalScopes()->sole();
        $this->assertSame(['catalog_writer', 'ok', 300, 60, $this->userId], [$row->feature, $row->status, (int) $row->input_tokens, (int) $row->output_tokens, $row->user_id]);
        $this->assertSame('json 6 field(s), 6 value(s)', $row->summary);
        $this->assertStringNotContainsString('Blue', json_encode($row->getAttributes()));
    }

    public function test_statuses_for_refusals_cut_off_invalid_and_empty_answers(): void
    {
        $fake = $this->fakeAi()
            ->refuse()
            ->reply(fn () => FakeLanguageModel::completion([new TextBlock('{"title": "Blue')], StopReason::MaxTokens, 100, 2000))
            ->answer('not json at all')
            ->answer('["a list", "not an object"]')
            ->answer('{}')
            ->answer('')
            ->answer("Here you go:\n```json\n{\"title\": \"Wrapped\"}\n```");

        $this->assertSame(['status' => 'refused', 'data' => null], $this->write());
        $this->assertSame(['status' => 'invalid', 'data' => null], $this->write());
        $this->assertSame(['status' => 'invalid', 'data' => null], $this->write());
        $this->assertSame(['status' => 'invalid', 'data' => null], $this->write());
        $this->assertSame(['status' => 'empty', 'data' => null], $this->write());
        $this->assertSame(['status' => 'empty', 'data' => null], $this->write());
        $this->assertSame(['status' => 'ok', 'data' => ['title' => 'Wrapped']], $this->write());
        $this->assertSame(7, $fake->callCount());
        $this->assertSame(7, AiRequest::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, AiRequest::query()->withoutGlobalScopes()->where('status', 'refused')->count());
        $this->assertSame(1, AiRequest::query()->withoutGlobalScopes()->where('summary', 'json cut off at the token limit')->count());
    }

    public function test_disabled_budget_and_provider_failures_never_throw(): void
    {
        // AI off: nothing is called or logged.
        $this->assertSame(['status' => 'disabled', 'data' => null], $this->write());
        $this->assertSame(0, AiRequest::query()->withoutGlobalScopes()->count());

        $fake = $this->fakeAi()->fail(new AiUnavailable('timeout'))->answerJson(['title' => 'x']);
        $this->assertSame(['status' => 'unavailable', 'data' => null], $this->write());
        $failed = AiRequest::query()->withoutGlobalScopes()->sole();
        $this->assertSame(['failed', 'timeout'], [$failed->status, $failed->error_code]);

        // The organization's switch.
        $this->actingAsUser(User::query()->withoutGlobalScopes()->findOrFail($this->userId));
        $this->patchJson('/api/v1/ai/settings', ['enabled' => false])->assertOk();
        $this->assertSame(['status' => 'disabled', 'data' => null], $this->write());

        // Budget used up: refused before the provider, logged as failed.
        $this->patchJson('/api/v1/ai/settings', ['enabled' => true, 'monthly_token_budget' => 10])->assertOk();
        AiRequest::query()->withoutGlobalScopes()->update(['input_tokens' => 50]);
        $this->assertSame(['status' => 'budget_exceeded', 'data' => null], $this->write());
        $this->assertSame(1, $fake->callCount());
        $this->assertSame(1, AiRequest::query()->withoutGlobalScopes()->where('status', 'failed')->where('error_code', 'AI_BUDGET_EXCEEDED')->count());
    }

    public function test_the_fake_model_synthesizes_a_schema_valid_answer_when_nothing_is_scripted(): void
    {
        $this->fakeAi();

        $result = $this->write();

        $this->assertSame('ok', $result['status']);
        $this->assertSame([
            'title' => 'Sample title',
            'tone' => 'warm',
            'tags' => ['Sample tags'],
            'details' => ['paragraphs' => ['Sample paragraphs']],
            'count' => 1,
            'ok' => true,
        ], $result['data']);

        // Without a schema the fallback text is unchanged.
        $plain = (new FakeLanguageModel)->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);
        $this->assertSame('This is a test answer.', $plain->text());
        $this->assertSame(['a' => null, 'b' => 'x', 'c' => ['Sample c']], (array) FakeLanguageModel::synthesize([
            'type' => 'object',
            'properties' => [
                'a' => ['type' => ['null', 'string'], 'const' => null],
                'b' => ['anyOf' => [['type' => 'string', 'enum' => ['x', 'y']], ['type' => 'null']]],
                'c' => ['type' => 'array', 'items' => ['type' => 'string']],
            ],
        ]));
    }
}
