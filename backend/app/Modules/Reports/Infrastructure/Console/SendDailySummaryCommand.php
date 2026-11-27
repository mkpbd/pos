<?php

namespace App\Modules\Reports\Infrastructure\Console;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Reports\Application\Dashboard\Dashboard;
use App\Modules\Reports\Application\ReportRunner;
use App\Modules\Reports\Application\Reports\PaymentCollectionsReport;
use App\Modules\Reports\Infrastructure\Notifications\DailySummaryNotification;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Persistence\AlertRun;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Throwable;

/**
 * R1: the owners' daily summary. Scheduled hourly; an organization is handled from its
 * `alerts.daily_summary_hour` in its own timezone (unless `alerts.daily_summary` is off), once
 * per local day (claim `daily_summary`). Every user with `reports.view` gets an in-app
 * notification and a queued e-mail with today's figures in their own branch scope: net sales and
 * POS sales count, web orders, cash collected and refunds (payment collections report), the
 * top 3 products and the low-stock count (dashboard).
 */
class SendDailySummaryCommand extends Command
{
    protected $signature = 'reports:daily-summary {--any-hour : Ignore the configured local hour (manual runs)}';

    protected $description = 'Send the daily sales summary to owners and managers (once a day per organization)';

    public function handle(
        OrganizationDirectory $organizations,
        UserDirectory $users,
        TenantContext $tenant,
        Dashboard $dashboard,
        ReportRunner $runner,
        PaymentCollectionsReport $collections,
    ): int {
        $sent = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            try {
                $alerts = $organizations->alertSettings($organizationId);
                $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
                $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));
                if (! $alerts['daily_summary'] || ($local->hour < $alerts['daily_summary_hour'] && ! $this->option('any-hour'))) {
                    continue;
                }
                $day = $local->toDateString();
                if (! AlertRun::claim($organizationId, 'daily_summary', $organizationId, $day)) {
                    continue;
                }

                foreach ($users->withPermission($organizationId, 'reports.view') as $user) {
                    if (! $user instanceof TenantUser || ! $user instanceof Authorizable) {
                        continue;
                    }
                    try {
                        $payload = $tenant->runAs($organizationId, fn () => $this->figures($dashboard, $runner, $collections, $user, $day));
                        $user->notify(new DailySummaryNotification($payload));
                        $sent++;
                    } catch (Throwable $e) {
                        report($e);
                    }
                }
            } catch (Throwable $e) {
                report($e);
            }
        }

        $this->info("Sent {$sent} daily summar".($sent === 1 ? 'y' : 'ies').'.');

        return self::SUCCESS;
    }

    /**
     * @return array<string, mixed>
     */
    private function figures(Dashboard $dashboard, ReportRunner $runner, PaymentCollectionsReport $collections, TenantUser&Authorizable $user, string $day): array
    {
        $board = $dashboard->build($user, ['date_from' => $day, 'date_to' => $day]);
        $data = $board['data'];
        $currency = (string) $board['meta']['params']['currency'];
        $channels = array_column($data['sales_by_channel'], null, 'channel');
        $money = $runner->run($collections, ['date_from' => $day, 'date_to' => $day, 'group_by' => 'method'], $user);
        $cash = '0.00';
        foreach ($money['data'] as $row) {
            if ($row['group_key'] === 'cash') {
                $cash = $row['collected'];
            }
        }

        $figures = [
            'date' => $day,
            'currency' => $currency,
            'sales_total' => $data['kpis']['total_sales']['value'],
            'sales_count' => (int) ($channels['pos']['orders'] ?? 0),
            'web_orders' => (int) ($channels['online']['orders'] ?? 0),
            'cash_collected' => $cash,
            'refunds' => $money['meta']['totals']['refunded'] ?? '0.00',
            'top_products' => array_map(fn (array $p) => ['product_id' => $p['product_id'], 'name' => $p['name'], 'quantity' => $p['quantity'], 'net_sales' => $p['net_sales']], array_slice($data['top_products'], 0, 3)),
            'low_stock_count' => (int) $data['low_stock']['count'],
        ];

        return [
            'title' => 'Daily summary for '.CarbonImmutable::parse($day)->format('j M Y'),
            'message' => sprintf(
                'Sales %s %s from %d sale%s and %d web order%s; cash collected %s %s; refunds %s %s; %d item%s low on stock.',
                $figures['sales_total'], $currency, $figures['sales_count'], $figures['sales_count'] === 1 ? '' : 's',
                $figures['web_orders'], $figures['web_orders'] === 1 ? '' : 's', $cash, $currency, $figures['refunds'], $currency,
                $figures['low_stock_count'], $figures['low_stock_count'] === 1 ? '' : 's',
            ),
        ] + $figures + ['link' => '/dashboard'];
    }
}
