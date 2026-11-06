<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Llm\ToolCall;
use App\Modules\AI\Domain\Llm\ToolResult;
use App\Modules\AI\Domain\Llm\Usage;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;
use JsonException;

/**
 * The server-side tool-use loop: call the model; when it asks for tools, run each (only tools
 * of this user's toolbox — an unknown name, invalid parameters, a branch or store out of scope
 * or a missing permission come back to the model as a tool error, nothing else runs), append
 * the results in one user turn and call again — at most `ai.max_tool_rounds` rounds, after which
 * one last call asks for a final answer without tools.
 */
final class ToolLoop
{
    /** Tokens and tools of the last run so far (also when it failed half-way, for the usage log). */
    private Usage $consumed;

    /** @var list<array{name: string, params: array<string, mixed>, ok: bool}> */
    private array $attempted = [];

    public function __construct(private readonly LanguageModel $model)
    {
        $this->consumed = new Usage;
    }

    public function consumed(): Usage
    {
        return $this->consumed;
    }

    /**
     * @return list<array{name: string, params: array<string, mixed>, ok: bool}>
     */
    public function attempted(): array
    {
        return $this->attempted;
    }

    /**
     * @param  array<string, AiTool>  $tools
     */
    public function run(Conversation $conversation, array $tools, ?int $maxRounds = null): ToolLoopResult
    {
        $maxRounds = max(0, $maxRounds ?? (int) config('ai.max_tool_rounds', 4));
        $definitions = array_values(array_map(fn (AiTool $t) => $t->definition(), $tools));
        $usage = $this->consumed = new Usage;
        $used = $this->attempted = [];
        $report = null;
        $completion = null;

        for ($round = 0; ; $round++) {
            $allowTools = $round < $maxRounds && $definitions !== [];
            $completion = $this->model->complete($conversation, $definitions, new CompletionOptions(allowTools: $allowTools));
            $usage = $this->consumed = $usage->add($completion->usage);
            $conversation = $conversation->with($completion->message);
            $calls = $completion->toolCalls();
            if ($calls === [] || ! $allowTools || $completion->stopReason !== StopReason::ToolUse) {
                break;
            }

            $results = [];
            foreach ($calls as $call) {
                [$result, $record, $output] = $this->execute($call, $tools);
                $results[] = $result;
                $used[] = $this->attempted[] = $record;
                if ($output?->report !== null) {
                    $report = $output->report;
                }
            }
            $conversation = $conversation->with(Message::toolResults($results));
        }

        return new ToolLoopResult($completion, $usage, $used, $report, $round + 1);
    }

    /**
     * @param  array<string, AiTool>  $tools
     * @return array{0: ToolResult, 1: array{name: string, params: array<string, mixed>, ok: bool}, 2: ?ToolOutput}
     */
    private function execute(ToolCall $call, array $tools): array
    {
        $tool = $tools[$call->name] ?? null;
        $params = self::loggable($call->input);
        if ($tool === null) {
            return [new ToolResult($call->id, self::json(['error' => 'Unknown tool "'.$call->name.'". Use only the tools provided.']), true),
                ['name' => mb_substr($call->name, 0, 64), 'params' => $params, 'ok' => false], null];
        }

        try {
            $output = $tool->run($call->input);
        } catch (ValidationException $e) {
            return [new ToolResult($call->id, self::json(['error' => 'Invalid parameters.', 'details' => $e->errors()]), true),
                ['name' => $call->name, 'params' => $params, 'ok' => false], null];
        } catch (AuthorizationException) {
            return [new ToolResult($call->id, self::json(['error' => 'The user is not allowed to use this data.']), true),
                ['name' => $call->name, 'params' => $params, 'ok' => false], null];
        } catch (BusinessRuleViolation $e) {
            return [new ToolResult($call->id, self::json(['error' => $e->getMessage(), 'code' => $e->errorCode]), true),
                ['name' => $call->name, 'params' => $params, 'ok' => false], null];
        }

        return [new ToolResult($call->id, self::json($output->data)), ['name' => $call->name, 'params' => $output->params, 'ok' => true], $output];
    }

    /**
     * Scalar parameters only (the model's raw arguments may be anything), for the usage log.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private static function loggable(array $input): array
    {
        $params = [];
        foreach (array_slice($input, 0, 10, true) as $key => $value) {
            if (is_scalar($value) || $value === null) {
                $params[mb_substr((string) $key, 0, 40)] = is_string($value) ? mb_substr($value, 0, 60) : $value;
            }
        }

        return $params;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function json(array $data): string
    {
        try {
            return json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
        } catch (JsonException) {
            return '{"error":"The result could not be encoded."}';
        }
    }
}
