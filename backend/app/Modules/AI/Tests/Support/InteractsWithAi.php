<?php

namespace App\Modules\AI\Tests\Support;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\ToolResult;
use App\Modules\AI\Infrastructure\Providers\FakeLanguageModel;
use Illuminate\Support\Facades\Http;

/**
 * AI on with a scripted model (never the network).
 */
trait InteractsWithAi
{
    protected function fakeAi(): FakeLanguageModel
    {
        Http::preventStrayRequests();
        config(['ai.enabled' => true]);
        $fake = new FakeLanguageModel;
        $this->app->instance(LanguageModel::class, $fake);

        return $fake;
    }

    /**
     * The tool results the model was sent in request $index (0-based), decoded.
     *
     * @return list<array{id: string, error: bool, data: array<string, mixed>, raw: string}>
     */
    protected function toolResultsSent(FakeLanguageModel $fake, int $index): array
    {
        $messages = $fake->requests[$index]['conversation']->messages;
        /** @var Message $last */
        $last = end($messages);

        return array_values(array_map(fn (ToolResult $r) => [
            'id' => $r->toolCallId,
            'error' => $r->isError,
            'data' => (array) json_decode($r->content, true),
            'raw' => $r->content,
        ], array_filter($last->content, fn ($block) => $block instanceof ToolResult)));
    }

    /**
     * @return list<string>
     */
    protected function toolNamesSent(FakeLanguageModel $fake, int $index = 0): array
    {
        return array_map(fn ($tool) => $tool->name, $fake->requests[$index]['tools']);
    }
}
