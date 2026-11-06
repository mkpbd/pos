<?php

namespace App\Modules\AI\Application\Tools;

/**
 * What a tool produced: `data` for the model (truncated rows + totals, no customer contact
 * details), `params` (the validated parameters, for the response and the usage log) and, for a
 * registry report, `report` — the structured table shown to the user.
 */
final readonly class ToolOutput
{
    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $params
     * @param  array<string, mixed>|null  $report
     */
    public function __construct(
        public array $data,
        public array $params,
        public ?array $report = null,
    ) {}
}
