<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\ProviderBlock;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Llm\ToolCall;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\AI\Domain\Llm\ToolResult;
use App\Modules\AI\Infrastructure\Providers\AnthropicLanguageModel;
use App\Modules\AI\Infrastructure\Providers\NullLanguageModel;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;
use Tests\TestCase;

/**
 * The Claude adapter over Laravel's HTTP client — every request is faked (no network): headers,
 * body (tools, effort, fallbacks, no sampling parameters), the tool-use round trip with thinking
 * blocks echoed unchanged, retries with backoff, timeouts and errors → AiUnavailable.
 */
class AnthropicLanguageModelTest extends TestCase
{
    private const KEY = 'sk-ant-test-0123456789';

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        Sleep::fake();
    }

    private function model(array $options = []): AnthropicLanguageModel
    {
        return new AnthropicLanguageModel(app(\Illuminate\Http\Client\Factory::class), self::KEY, 'claude-sonnet-5-5', 30, $options + [
            'base_url' => 'https://api.anthropic.com',
            'version' => '2026-10-21',
            'max_tokens' => 8000,
            'effort' => 'low',
            'refusal_fallback' => true,
            'max_retries' => 2,
            'retry_base_ms' => 500,
            'retry_max_ms' => 8000,
        ]);
    }

    /**
     * @param  list<array<string, mixed>>  $content
     * @return array<string, mixed>
     */
    private static function reply(array $content, string $stop = 'end_turn', array $usage = ['input_tokens' => 120, 'output_tokens' => 30]): array
    {
        return ['id' => 'msg_1', 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-sonnet-5-5', 'content' => $content, 'stop_reason' => $stop, 'usage' => $usage];
    }

    private static function tool(): ToolDefinition
    {
        return new ToolDefinition('sales_daily', 'Daily sales report.', [
            'type' => 'object',
            'properties' => ['date_from' => ['type' => 'string', 'format' => 'date'], 'date_to' => ['type' => 'string', 'format' => 'date']],
            'required' => ['date_from', 'date_to'],
            'additionalProperties' => false,
        ]);
    }

    public function test_request_headers_and_body_follow_the_messages_api(): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(self::reply([['type' => 'text', 'text' => 'Hello']]))]);

        $completion = $this->model()->complete(new Conversation('You are a test.', [Message::user('Hi')]), [
            self::tool(),
            new ToolDefinition('dashboard_kpis', 'KPIs.', ['type' => 'object', 'properties' => [], 'required' => [], 'additionalProperties' => false]),
        ], new CompletionOptions);

        $this->assertSame('Hello', $completion->text());
        $this->assertSame(StopReason::EndTurn, $completion->stopReason);
        $this->assertSame(['input_tokens' => 120, 'output_tokens' => 30], $completion->usage->toArray());

        Http::assertSent(function (Request $request) {
            $body = $request->data();
            $raw = $request->body();

            return $request->url() === 'https://api.anthropic.com/v1/messages'
                && $request->method() === 'POST'
                && $request->header('x-api-key') === [self::KEY]
                && $request->header('anthropic-version') === ['2026-10-21']
                && $request->header('anthropic-beta') === [AnthropicLanguageModel::FALLBACK_BETA]
                && $body['model'] === 'claude-sonnet-5-5'
                && $body['max_tokens'] === 8000
                && $body['system'] === 'You are a test.'
                && $body['messages'] === [['role' => 'user', 'content' => [['type' => 'text', 'text' => 'Hi']]]]
                && $body['tools'][0]['name'] === 'sales_daily'
                && $body['tools'][0]['input_schema']['required'] === ['date_from', 'date_to']
                && str_contains($raw, '"properties":{}') // an empty schema is an object, not []
                && $body['output_config'] === ['effort' => 'low']
                && $body['fallbacks'] === 'default'
                && $body['cache_control'] === ['type' => 'ephemeral']
                && ! array_key_exists('tool_choice', $body)
                && ! array_key_exists('temperature', $body)
                && ! array_key_exists('top_p', $body)
                && ! array_key_exists('thinking', $body);
        });
    }

    public function test_tool_use_round_trip_echoes_thinking_and_sends_tool_results(): void
    {
        $thinking = ['type' => 'thinking', 'thinking' => '', 'signature' => 'sig-abc'];
        Http::fakeSequence('api.anthropic.com/*')
            ->push(self::reply([
                $thinking,
                ['type' => 'text', 'text' => 'Let me check.'],
                ['type' => 'tool_use', 'id' => 'toolu_01', 'name' => 'sales_daily', 'input' => ['date_from' => '2026-11-01', 'date_to' => '2026-11-07']],
            ], 'tool_use', ['input_tokens' => 100, 'output_tokens' => 40, 'cache_creation_input_tokens' => 50, 'cache_read_input_tokens' => 25]))
            ->push(self::reply([['type' => 'text', 'text' => 'Net sales were 1,000.00.']]));
        $model = $this->model();
        $conversation = new Conversation('System', [Message::user('Sales this week?')]);

        $first = $model->complete($conversation, [self::tool()], new CompletionOptions);
        $this->assertSame(StopReason::ToolUse, $first->stopReason);
        $this->assertSame(175, $first->usage->inputTokens); // input + cache writes + cache reads
        $this->assertCount(1, $first->toolCalls());
        $this->assertEquals(new ToolCall('toolu_01', 'sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07']), $first->toolCalls()[0]);
        $this->assertInstanceOf(ProviderBlock::class, $first->message->content[0]);

        $conversation = $conversation->with($first->message)->with(Message::toolResults([
            new ToolResult('toolu_01', '{"totals":{"net_sales":"1000.00"}}'),
            new ToolResult('toolu_02', '{"error":"Invalid parameters."}', true),
        ]));
        $final = $model->complete($conversation, [self::tool()], new CompletionOptions(allowTools: false));
        $this->assertSame('Net sales were 1,000.00.', $final->text());

        $requests = Http::recorded();
        $this->assertCount(2, $requests);
        $second = json_decode($requests[1][0]->body(), true);
        $this->assertSame('assistant', $second['messages'][1]['role']);
        $this->assertSame($thinking, $second['messages'][1]['content'][0]); // echoed unchanged, first
        $this->assertSame(['type' => 'tool_use', 'id' => 'toolu_01', 'name' => 'sales_daily', 'input' => ['date_from' => '2026-11-01', 'date_to' => '2026-11-07']], $second['messages'][1]['content'][2]);
        $this->assertSame([
            ['type' => 'tool_result', 'tool_use_id' => 'toolu_01', 'content' => '{"totals":{"net_sales":"1000.00"}}'],
            ['type' => 'tool_result', 'tool_use_id' => 'toolu_02', 'content' => '{"error":"Invalid parameters."}', 'is_error' => true],
        ], $second['messages'][2]['content']);
        $this->assertSame('user', $second['messages'][2]['role']);
        $this->assertSame(['type' => 'none'], $second['tool_choice']); // final round: answer without tools
    }

    public function test_retries_overloaded_and_rate_limited_responses_with_backoff(): void
    {
        Http::fakeSequence('api.anthropic.com/*')
            ->push(['type' => 'error', 'error' => ['type' => 'overloaded_error', 'message' => 'Overloaded']], 529)
            ->push(['type' => 'error', 'error' => ['type' => 'rate_limit_error', 'message' => 'Slow down']], 429, ['retry-after' => '3'])
            ->push(self::reply([['type' => 'text', 'text' => 'OK']]));

        $completion = $this->model()->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);

        $this->assertSame('OK', $completion->text());
        Http::assertSentCount(3);
        Sleep::assertSleptTimes(2);
        Sleep::assertSequence([Sleep::for(500)->milliseconds(), Sleep::for(3000)->milliseconds()]);
    }

    public function test_errors_after_retries_and_non_retryable_statuses_become_ai_unavailable_without_leaking_the_key(): void
    {
        Log::spy();
        $error = fn (string $type) => ['type' => 'error', 'error' => ['type' => $type, 'message' => 'x']];
        Http::fakeSequence('api.anthropic.com/*')
            ->push($error('api_error'), 500)->push($error('api_error'), 502)->push($error('api_error'), 500)
            ->push($error('invalid_request_error'), 400)
            ->push($error('authentication_error'), 401);
        try {
            $this->model()->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);
            $this->fail('Expected AiUnavailable');
        } catch (AiUnavailable $e) {
            $this->assertSame('provider_error', $e->reason);
            $this->assertSame(503, $e->status);
            $this->assertSame('AI_UNAVAILABLE', $e->errorCode);
        }
        Http::assertSentCount(3); // 1 + 2 retries

        try {
            $this->model(['max_retries' => 5])->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);
            $this->fail('Expected AiUnavailable');
        } catch (AiUnavailable $e) {
            $this->assertSame('provider_rejected', $e->reason);
        }
        Http::assertSentCount(4); // a 400 is not retried

        try {
            $this->model()->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);
            $this->fail('Expected AiUnavailable');
        } catch (AiUnavailable $e) {
            $this->assertSame('provider_auth', $e->reason);
            $this->assertStringNotContainsString(self::KEY, $e->getMessage());
        }

        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context) {
            return ! str_contains(json_encode($context), self::KEY) && isset($context['status']);
        })->atLeast()->times(3);
    }

    public function test_a_timeout_is_retried_and_then_reported_as_unavailable(): void
    {
        Http::fake(fn () => throw new ConnectionException('cURL error 28: Operation timed out after 30001 milliseconds'));

        try {
            $this->model()->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);
            $this->fail('Expected AiUnavailable');
        } catch (AiUnavailable $e) {
            $this->assertSame('timeout', $e->reason);
        }
        Sleep::assertSleptTimes(2);
    }

    public function test_refusals_and_server_side_fallback_blocks(): void
    {
        Http::fakeSequence('api.anthropic.com/*')
            ->push(self::reply([], 'refusal') + ['stop_details' => ['type' => 'refusal', 'category' => 'cyber']])
            ->push(self::reply([
                ['type' => 'thinking', 'thinking' => '', 'signature' => 'declined'],
                ['type' => 'fallback', 'from' => ['model' => 'claude-sonnet-5-5'], 'to' => ['model' => 'claude-sonnet-5']],
                ['type' => 'text', 'text' => 'Answer from the fallback model.'],
            ]));
        $model = $this->model();

        $refused = $model->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);
        $this->assertSame(StopReason::Refusal, $refused->stopReason);
        $this->assertSame('', $refused->text());

        $fallback = $model->complete(new Conversation('S', [Message::user('Q')]), [], new CompletionOptions);
        $this->assertSame('Answer from the fallback model.', $fallback->text());
        $this->assertCount(1, $fallback->message->content); // declined thinking and the marker are not echoed
    }

    public function test_disabled_or_unconfigured_ai_binds_the_null_model(): void
    {
        config(['ai.enabled' => false]);
        $this->assertInstanceOf(NullLanguageModel::class, app(LanguageModel::class));

        config(['ai.enabled' => true, 'ai.provider' => 'anthropic', 'ai.api_key' => '']);
        $this->assertInstanceOf(NullLanguageModel::class, app(LanguageModel::class));

        config(['ai.api_key' => self::KEY]);
        $this->assertInstanceOf(AnthropicLanguageModel::class, app(LanguageModel::class));

        $this->expectException(AiUnavailable::class);
        (new NullLanguageModel)->complete(new Conversation('S'), [], new CompletionOptions);
    }
}
