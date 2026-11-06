<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Domain\Llm\Completion;
use App\Modules\AI\Domain\Llm\Usage;

final readonly class ToolLoopResult
{
    /**
     * @param  list<array{name: string, params: array<string, mixed>, ok: bool}>  $toolsUsed
     * @param  array<string, mixed>|null  $report  the last registry report a tool ran
     */
    public function __construct(
        public Completion $final,
        public Usage $usage,
        public array $toolsUsed,
        public ?array $report,
        public int $rounds,
    ) {}
}
