<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Application\Insights\InsightsCalculator;
use App\Modules\AI\Domain\Insights\SalesAnomalies;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Support\Facades\Validator;
use InvalidArgumentException;

/**
 * The deterministic insight analytics as tools (computed by InsightsCalculator over registry
 * reports and SC1 suggestions, in the user's scope):
 *
 *   sales_anomalies  unusual days (z-score ≥ 2.5 vs the trailing 28 days)   reports.view
 *   slow_movers      products in stock with no sales in N days              reports.view
 *   shortage_risk    items whose days of cover are below the lead time      purchases.view
 */
final class AnalyticsTool implements AiTool
{
    public const ANOMALIES = 'sales_anomalies';

    public const SLOW_MOVERS = 'slow_movers';

    public const SHORTAGE_RISK = 'shortage_risk';

    public const PERMISSIONS = [
        self::ANOMALIES => 'reports.view',
        self::SLOW_MOVERS => 'reports.view',
        self::SHORTAGE_RISK => 'purchases.view',
    ];

    public function __construct(
        private readonly string $name,
        private readonly InsightsCalculator $calculator,
        private readonly TenantUser&Authorizable $user,
        private readonly string $today,
        private readonly int $rowLimit,
    ) {
        if (! isset(self::PERMISSIONS[$name])) {
            throw new InvalidArgumentException("Unknown analytics tool [{$name}].");
        }
    }

    public function definition(): ToolDefinition
    {
        $branch = ['type' => 'string', 'description' => 'The id of a branch from the list in the instructions (omit for all accessible branches)'];

        return match ($this->name) {
            self::ANOMALIES => new ToolDefinition(
                self::ANOMALIES,
                'Unusual sales days in a period (at most 92 days): days whose net sales z-score against the trailing '.SalesAnomalies::WINDOW_DAYS
                .' days is at least '.SalesAnomalies::THRESHOLD.' (spike) or at most -'.SalesAnomalies::THRESHOLD.' (drop), with the mean and standard deviation used. '
                .'Needs '.SalesAnomalies::MIN_HISTORY_DAYS.' days of trading history before a day.',
                Arguments::schema([
                    'date_from' => ['type' => 'string', 'format' => 'date', 'description' => 'First day, YYYY-MM-DD'],
                    'date_to' => ['type' => 'string', 'format' => 'date', 'description' => 'Last day, YYYY-MM-DD'],
                    'branch_id' => $branch,
                ], ['date_from', 'date_to']),
            ),
            self::SLOW_MOVERS => new ToolDefinition(
                self::SLOW_MOVERS,
                'Slow movers: products in stock now with no net sales in the last N days (default 30) up to today, largest stock first.',
                Arguments::schema([
                    'days' => ['type' => 'integer', 'minimum' => 7, 'maximum' => 365, 'description' => 'Days without sales (default 30)'],
                    'branch_id' => $branch,
                ]),
            ),
            default => new ToolDefinition(
                self::SHORTAGE_RISK,
                'Shortage risk: items in the active stores in scope whose days of cover (on hand ÷ average daily sales) are below the supplier lead time, '
                .'with the suggested purchase / transfer. Lowest cover first.',
                Arguments::schema([
                    'branch_id' => $branch,
                    'store_id' => ['type' => 'string', 'description' => 'The id of a store from the list in the instructions (omit for every store in scope)'],
                ]),
            ),
        };
    }

    public function run(array $input): ToolOutput
    {
        if (! $this->user->can(self::PERMISSIONS[$this->name])) {
            throw new AuthorizationException;
        }

        return match ($this->name) {
            self::ANOMALIES => $this->anomalies($input),
            self::SLOW_MOVERS => $this->slowMovers($input),
            default => $this->shortageRisk($input),
        };
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function anomalies(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['date_from', 'date_to', 'branch_id']), [
            'date_from' => ['required', 'date_format:Y-m-d'],
            'date_to' => ['required', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'branch_id' => ['sometimes', 'uuid'],
        ])->validate();
        $anomalies = $this->calculator->anomalies($this->user, $args['branch_id'] ?? null, $args['date_from'], $args['date_to']);

        return new ToolOutput(['period' => $args, 'anomalies' => $anomalies, 'count' => count($anomalies)], $args);
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function slowMovers(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['days', 'branch_id']), [
            'days' => ['sometimes', 'integer', 'min:7', 'max:365'],
            'branch_id' => ['sometimes', 'uuid'],
        ])->validate();
        $result = $this->calculator->slowMovers($this->user, $args['branch_id'] ?? null, $this->today, (int) ($args['days'] ?? InsightsCalculator::SLOW_MOVER_DAYS), $this->rowLimit);

        return new ToolOutput(['as_of' => $this->today] + $result, $args);
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function shortageRisk(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['branch_id', 'store_id']), [
            'branch_id' => ['sometimes', 'uuid'],
            'store_id' => ['sometimes', 'uuid'],
        ])->validate();

        return new ToolOutput($this->calculator->shortageRisk($this->user, $args['branch_id'] ?? null, $args['store_id'] ?? null, $this->rowLimit), $args);
    }
}
