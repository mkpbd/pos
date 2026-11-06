<?php

namespace App\Modules\AI\Domain\Exceptions;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * The organization used its monthly AI token budget. Rendered as 429 AI_BUDGET_EXCEEDED.
 */
final class AiBudgetExceeded extends BusinessRuleViolation
{
    public function __construct(int $budget, int $used, string $month)
    {
        parent::__construct(
            'AI_BUDGET_EXCEEDED',
            'The monthly AI token budget of this organization is used up. It renews next month, or an administrator can raise it in the AI settings.',
            ['budget' => $budget, 'used' => $used, 'month' => $month],
            429,
        );
    }
}
