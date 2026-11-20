<?php

namespace App\Modules\OnlineCatalog\Tests\Concerns;

use App\Modules\Shared\Application\Contracts\AiJsonWriter;
use Closure;

/**
 * A scripted Shared AiJsonWriter for OnlineCatalog tests: answers are queued (or computed from
 * the call) and every call is recorded (feature, prompts, schema). Never calls a model.
 */
final class ScriptedAiJsonWriter implements AiJsonWriter
{
    /** @var list<array{organization_id: string, user_id: ?string, feature: string, system: string, prompt: string, schema: array<string, mixed>, max_tokens: int}> */
    public array $calls = [];

    /** @var list<array{status: string, data: ?array<string, mixed>}|Closure> */
    private array $answers = [];

    /**
     * @param  array<string, mixed>  $data
     */
    public function answer(array $data): self
    {
        $this->answers[] = ['status' => 'ok', 'data' => $data];

        return $this;
    }

    public function status(string $status): self
    {
        $this->answers[] = ['status' => $status, 'data' => null];

        return $this;
    }

    /**
     * @param  Closure(array<string, mixed>): array{status: string, data: ?array<string, mixed>}  $reply  gets the call
     */
    public function reply(Closure $reply): self
    {
        $this->answers[] = $reply;

        return $this;
    }

    public function write(string $organizationId, ?string $userId, string $feature, string $system, string $prompt, array $schema, int $maxTokens = 2000): array
    {
        $call = ['organization_id' => $organizationId, 'user_id' => $userId, 'feature' => $feature, 'system' => $system, 'prompt' => $prompt, 'schema' => $schema, 'max_tokens' => $maxTokens];
        $this->calls[] = $call;
        $answer = array_shift($this->answers) ?? ['status' => 'unavailable', 'data' => null];

        return $answer instanceof Closure ? $answer($call) : $answer;
    }
}
