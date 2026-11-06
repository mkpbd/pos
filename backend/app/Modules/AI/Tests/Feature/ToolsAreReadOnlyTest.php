<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Application\Tools\AnalyticsTool;
use App\Modules\AI\Application\Tools\DashboardKpisTool;
use App\Modules\AI\Application\Tools\ReorderSuggestionsTool;
use App\Modules\AI\Application\Tools\ReportTool;
use App\Modules\AI\Application\Tools\Toolbox;
use App\Modules\Reports\Application\ReportRegistry;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * No write is reachable from the model: the toolbox only holds the read-only tool classes, the
 * report tools are exactly the registry reports the user may run, and running every tool issues
 * no INSERT / UPDATE / DELETE.
 */
class ToolsAreReadOnlyTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, RefreshDatabase;

    public function test_every_tool_is_read_only_and_bound_to_the_users_reports(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $store = $this->mainStoreId($org);
        $this->travelTo($this->dhaka('2026-11-07 10:00'));
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '3', '40.00');
        $this->checkout($this->cart($store, [[$soap, '2']], [['cash', '200']]))->assertCreated();
        app(TenantContext::class)->setOrganization($org->id);

        $tools = app(Toolbox::class)->forUser($admin->fresh(), $org->id, '2026-11-07');
        $allowedClasses = [ReportTool::class, DashboardKpisTool::class, ReorderSuggestionsTool::class, AnalyticsTool::class];
        foreach ($tools as $tool) {
            $this->assertContains($tool::class, $allowedClasses);
        }
        $reportKeys = array_keys(array_filter($tools, fn ($t) => $t instanceof ReportTool));
        $this->assertSame(array_map(fn ($d) => $d->key, app(ReportRegistry::class)->visibleTo($admin)), $reportKeys);

        $writes = [];
        DB::listen(function (QueryExecuted $query) use (&$writes) {
            if (preg_match('/^\s*(insert|update|delete|alter|drop|create|truncate)\b/i', $query->sql)) {
                $writes[] = $query->sql;
            }
        });
        foreach ($tools as $name => $tool) {
            $schema = $tool->definition()->inputSchema;
            $args = [];
            foreach ($schema['required'] as $param) {
                $args[$param] = match ($param) {
                    'date_from', 'date_to' => '2026-11-07',
                    'store_id' => $store,
                    default => $this->fail("No test value for {$name}.{$param}"),
                };
            }
            $output = $tool->run($args);
            $this->assertIsArray($output->data, $name);
        }
        $this->assertSame([], $writes);

        // A branch-limited inventory manager: no financial reports, no dashboard writes, same classes.
        $manager = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $names = array_keys(app(Toolbox::class)->forUser($manager, $org->id, '2026-11-07'));
        $this->assertNotContains('profit_and_loss', $names);
        $this->assertNotContains('tax', $names);
        $this->assertContains('reorder_suggestions', $names);
        $this->assertContains('low_stock', $names);
    }
}
