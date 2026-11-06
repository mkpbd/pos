<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * One tool the model may call: a typed JSON schema over existing deterministic, read-only code
 * (a registry report through ReportRunner, SC1 reorder suggestions, the dashboard, the insight
 * analytics), bound to one user — so it can only ever read what that user may read. Tools never
 * write.
 */
interface AiTool
{
    public function definition(): ToolDefinition;

    /**
     * @param  array<string, mixed>  $input  the model's arguments (untrusted)
     *
     * @throws ValidationException|BusinessRuleViolation|AuthorizationException returned to the model as a tool error
     */
    public function run(array $input): ToolOutput;
}
