<?php

namespace App\Modules\AI\Application\Assistants;

use App\Modules\AI\Application\Services\AiRunner;
use App\Modules\AI\Application\Services\MeteredCall;
use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\ToolLoop;
use App\Modules\AI\Application\Tools\Toolbox;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Validation\ValidationException;

/**
 * Ask AI (natural-language reporting + sales / inventory assistant): one question, optionally
 * with up to 6 earlier turns from the client (no server-side chat storage), answered by the
 * model from the user's toolbox only (registry reports, dashboard, reorder suggestions,
 * analytics). Returns the answer, the last registry report a tool ran (rows ≤ 50 + totals + the
 * "open full report" link), the tools used and the token usage.
 */
final class AskAssistant
{
    public const MAX_HISTORY = 6;

    public const REFUSAL_ANSWER = 'I can\'t help with that request. I can answer questions about your sales, stock, purchasing and finances from the reports you have access to.';

    public function __construct(
        private readonly AiRunner $runner,
        private readonly Toolbox $toolbox,
        private readonly ToolLoop $loop,
        private readonly BranchDirectory $branches,
        private readonly OrganizationDirectory $organizations,
        private readonly OrganizationDate $dates,
    ) {}

    /**
     * @param  list<array{role: string, content: string}>  $history
     * @return array<string, mixed>
     */
    public function ask(TenantUser&Authorizable $user, string $organizationId, string $question, ?string $branchId, array $history = []): array
    {
        $focus = $branchId === null ? null : $this->requireBranch($user, $organizationId, $branchId);
        $messages = $this->history($history);

        return $this->runner->run($organizationId, (string) $user->getAuthIdentifier(), 'ask', function (MeteredCall $metered) use ($user, $organizationId, $question, $focus, $messages) {
            $today = $this->dates->today();
            $tools = $this->toolbox->forUser($user, $organizationId, $today);
            $conversation = new Conversation($this->system($user, $organizationId, $today, $tools, $focus), [...$messages, Message::user($question)]);

            try {
                $result = $this->loop->run($conversation, $tools);
            } finally {
                $metered->usage = $this->loop->consumed();
                $metered->tools = $this->loop->attempted();
            }
            $metered->model = $result->final->model;

            $refused = $result->final->stopReason === StopReason::Refusal;
            $answer = $refused ? self::REFUSAL_ANSWER : $result->final->text();
            if ($answer === '') {
                $answer = 'I could not produce an answer to this question. Try asking it differently, for example with a period and a branch.';
            }
            $metered->status = $refused ? 'refused' : 'ok';
            $metered->summary = sprintf('%d tool call(s), %d round(s), answer %d chars', count($result->toolsUsed), $result->rounds, mb_strlen($answer));

            return [
                'answer' => $answer,
                'report' => $refused ? null : $result->report,
                'tools_used' => array_map(fn (array $t) => ['name' => $t['name'], 'params' => $t['params'], 'ok' => $t['ok']], $result->toolsUsed),
                'usage' => $result->usage->toArray() + ['rounds' => $result->rounds],
                'model' => $result->final->model,
                'refused' => $refused,
                'truncated' => $result->final->stopReason === StopReason::MaxTokens,
            ];
        });
    }

    /**
     * @param  array<string, AiTool>  $tools
     * @param  array{id: string, name: string}|null  $focus
     */
    private function system(TenantUser&Authorizable $user, string $organizationId, string $today, array $tools, ?array $focus): string
    {
        $organization = $this->organizations->summary($organizationId) ?? [];
        $accessible = $user->accessibleBranchIds();
        $branches = array_values(array_filter($this->branches->summaries($organizationId, $accessible), fn (array $b) => $b['is_active']));
        $stores = array_values(array_filter($this->branches->activeStores($organizationId), fn (array $s) => $accessible === null || in_array($s['branch_id'], $accessible, true)));
        $capabilities = array_map(fn (AiTool $t) => self::capability($t), array_values($tools));

        return Prompts::ask(
            (string) ($organization['name'] ?? 'the organization'),
            $today,
            $this->dates->timezone(),
            (string) ($organization['base_currency'] ?? config('pos.default_currency', 'BDT')),
            array_map(fn (array $b) => ['id' => $b['id'], 'name' => $b['name']], $branches),
            array_map(fn (array $s) => ['id' => $s['id'], 'name' => $s['name'], 'branch' => $s['branch_name']], $stores),
            $capabilities,
            $focus,
        );
    }

    private static function capability(AiTool $tool): string
    {
        $definition = $tool->definition();
        $first = strtok($definition->description, '.') ?: $definition->name;

        return $definition->name.': '.trim($first);
    }

    /**
     * @return array{id: string, name: string}
     */
    private function requireBranch(TenantUser $user, string $organizationId, string $branchId): array
    {
        $branch = $this->branches->summaries($organizationId, [$branchId])[0] ?? null;
        if ($branch === null || ! $user->canAccessBranch($branchId)) {
            throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist or is not accessible.']]);
        }

        return ['id' => $branch['id'], 'name' => $branch['name']];
    }

    /**
     * Earlier turns: alternating user / assistant, starting with the user and ending with the
     * assistant (the new question follows).
     *
     * @param  list<array{role: string, content: string}>  $history
     * @return list<Message>
     */
    private function history(array $history): array
    {
        $history = array_slice(array_values($history), -self::MAX_HISTORY);
        $messages = [];
        foreach ($history as $i => $turn) {
            $expected = $i % 2 === 0 ? Message::USER : Message::ASSISTANT;
            if (($turn['role'] ?? null) !== $expected) {
                throw ValidationException::withMessages(['history' => ['The history must alternate user and assistant turns, starting with the user.']]);
            }
            $messages[] = $expected === Message::USER ? Message::user((string) $turn['content']) : Message::assistant((string) $turn['content']);
        }
        if ($messages !== [] && end($messages)->role !== Message::ASSISTANT) {
            throw ValidationException::withMessages(['history' => ['The history must end with an assistant turn.']]);
        }

        return $messages;
    }
}
