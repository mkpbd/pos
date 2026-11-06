<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Reports\Application\Dashboard\Dashboard;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Access\Authorizable;

/**
 * The dashboard figures (dashboard.view): KPIs vs the previous period of equal length, today vs
 * yesterday, top 10 products, the low-stock count, sales by channel and by branch. Recent
 * transactions (customer names) are not passed to the model.
 */
final class DashboardKpisTool implements AiTool
{
    public const NAME = 'dashboard_kpis';

    public function __construct(
        private readonly Dashboard $dashboard,
        private readonly TenantUser&Authorizable $user,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'Dashboard KPIs for a period (default: the last 30 days up to today; at most 366 days): net sales, today\'s revenue vs yesterday, orders, average ticket, '
            .'returns, gross profit (when the user may see cost), each with the previous period of equal length; top 10 products; low-stock item count; '
            .'sales by channel (POS / online) and by branch. Best for quick overviews ("how are we doing this week?").',
            Arguments::schema([
                'date_from' => ['type' => 'string', 'format' => 'date', 'description' => 'First day, YYYY-MM-DD (organization timezone)'],
                'date_to' => ['type' => 'string', 'format' => 'date', 'description' => 'Last day, YYYY-MM-DD (default today)'],
                'branch_id' => ['type' => 'string', 'description' => 'The id of a branch from the list in the instructions (omit for all accessible branches)'],
            ]),
        );
    }

    public function run(array $input): ToolOutput
    {
        if (! $this->user->can('dashboard.view')) {
            throw new AuthorizationException;
        }
        $args = Arguments::only($input, ['date_from', 'date_to', 'branch_id']);
        $payload = $this->dashboard->build($this->user, $args);
        $data = $payload['data'];

        return new ToolOutput(
            data: [
                'params' => $payload['meta']['params'],
                'kpis' => $data['kpis'],
                'top_products' => array_map(fn (array $p) => array_diff_key($p, ['product_id' => true]), $data['top_products']),
                'low_stock_items' => $data['low_stock']['count'],
                'sales_by_channel' => $data['sales_by_channel'],
                'sales_by_branch' => $data['sales_by_branch'],
                'omitted' => $payload['meta']['omitted'],
            ],
            params: $args,
        );
    }
}
