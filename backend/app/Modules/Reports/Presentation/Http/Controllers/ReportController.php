<?php

namespace App\Modules\Reports\Presentation\Http\Controllers;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportRegistry;
use App\Modules\Reports\Application\ReportRunner;
use App\Modules\Reports\Application\Support\CashierOptions;
use App\Modules\Reports\Application\Support\FilterDescription;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Presentation\Http\Exports\ReportExport;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Export\ExportFormat;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The report registry over HTTP (Phase 7): the catalog of reports the user may run and the
 * run itself (JSON page, or an X1 export of every row with ?export=xlsx|pdf|csv).
 */
class ReportController
{
    public function __construct(
        private readonly ReportRegistry $registry,
        private readonly ReportRunner $runner,
        private readonly CashierOptions $cashiers,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * Report catalog
     *
     * Definitions of the reports the user may run (`reports.view` → operational reports,
     * `reports.financial` → profit and loss and tax): key, title, group, permission, typed
     * parameters, columns (with `cost_sensitive`), default sort, totals, and
     * `omitted_columns` — the cost-sensitive columns this user will not receive. The
     * `cashier_id` parameter carries `options` (users of the viewer's branches).
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);
        if (! $user->can('reports.view') && ! $user->can('reports.financial')) {
            throw new AuthorizationException;
        }
        $canViewCost = $user->can('products.view_cost');
        $cashiers = null;
        $definitions = array_map(function (ReportDefinition $d) use ($canViewCost, $user, &$cashiers) {
            $data = $d->toArray($canViewCost);
            foreach ($data['params'] as $i => $param) {
                if (($param['entity'] ?? null) === 'cashier') {
                    $data['params'][$i]['options'] = $cashiers ??= $this->cashiers->for($user, $this->tenant->requireOrganization());
                }
            }

            return $data;
        }, $this->registry->visibleTo($user));

        return ApiResponse::success($definitions, meta: ['groups' => ReportRegistry::groups()]);
    }

    /**
     * Run a report
     *
     * Parameters per the definition (dates `Y-m-d` in the organization's timezone; `date_from`
     * and `date_to` required for time-based reports; ranges up to 366 days for daily rows,
     * else five years — `422 RANGE_TOO_LARGE`), plus `sort` (a sortable column, `-` for
     * descending), `page`, `per_page` (default 50, max 500) and `export=xlsx|pdf|csv`.
     * Unknown key: 404. Branch scope: the user's branches ∩ `branch_id` (another branch: 422).
     */
    public function show(Request $request, string $key, ListExporter $exports): Response
    {
        $report = $this->registry->find($key) ?? throw new NotFoundHttpException('Unknown report.');
        $user = $this->user($request);
        if (! $user->can($report->definition()->permission)) {
            throw new AuthorizationException;
        }

        if ($format = ListExporter::requested($request)) {
            return $this->export($request, $report, $format, $exports);
        }

        $payload = $this->runner->run($report, $request->query(), $user);

        return ApiResponse::success($payload['data'], meta: $payload['meta']);
    }

    private function export(Request $request, Report $report, ExportFormat $format, ListExporter $exports): Response
    {
        $user = $this->user($request);
        $definition = $report->definition();
        $input = $request->query();
        $context = $this->runner->context($report, $input, $user);
        $result = $report->run($context);
        [$sortKey, $descending] = $this->runner->sort($definition, $input, $context->canViewCost);
        $columns = $this->runner->columns($definition, $result, $context->canViewCost);
        $hidden = $context->canViewCost ? [] : $definition->costSensitiveKeys();
        $export = new ReportExport($definition, $columns, FilterDescription::of($definition, $context));

        if ($result->isQuery()) {
            $present = $result->present;
            $source = RowSource::fromQuery(
                $this->runner->orderedQuery($result, $sortKey, $descending),
                fn (Collection $rows) => array_map(fn (array $row) => ReportRunner::strip($row, $hidden), $present($rows)),
            );
        } else {
            $rows = array_map(fn (array $row) => ReportRunner::strip($row, $hidden), $this->runner->ordered($definition, $result, $sortKey, $descending));
            if ($definition->totals && $result->totals !== null && $columns !== []) {
                $rows[] = [$columns[0]->key => 'Total'] + ReportRunner::strip($result->totals, $hidden);
            }
            $source = RowSource::fromRows($rows);
        }

        return $exports->download($request, $format, $export, $source);
    }

    private function user(Request $request): TenantUser&Authorizable
    {
        /** @var TenantUser&Authorizable */
        return $request->user();
    }
}
