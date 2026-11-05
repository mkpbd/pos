<?php

namespace App\Modules\Payments\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Presentation\Http\Exports\PaymentsLedgerExport;
use App\Modules\Payments\Presentation\Http\Support\PaymentsPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * The payments ledger: every amount received or paid out, by any module.
 */
class PaymentController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly PaymentsPresenter $presenter,
    ) {}

    /**
     * Payment history
     *
     * Filters: `branch_id`, `method`, `direction`, `source_type`, `customer_id`,
     * `cash_register_session_id`, `from`/`to` (days in the organization's timezone); `search`
     * matches the document number or reference. `meta.totals` sums the filtered rows.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'branch_id' => ['sometimes', 'uuid'],
            'method' => ['sometimes', Rule::enum(PaymentMethod::class)],
            'direction' => ['sometimes', Rule::enum(PaymentDirection::class)],
            'source_type' => ['sometimes', 'string', 'max:30'],
            'customer_id' => ['sometimes', 'uuid'],
            'cash_register_session_id' => ['sometimes', 'uuid'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();
        $timezone = $this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? config('app.timezone');
        $day = fn (string $date) => Carbon::parse($date, $timezone)->startOfDay()->setTimezone(config('app.timezone'));
        $accessible = $user->accessibleBranchIds();

        $query = Payment::query()
            ->when($accessible !== null, fn (Builder $q) => $q->whereIn('branch_id', $accessible))
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->when($request->query('method'), fn (Builder $q, string $v) => $q->where('method', $v))
            ->when($request->query('direction'), fn (Builder $q, string $v) => $q->where('direction', $v))
            ->when($request->query('source_type'), fn (Builder $q, string $v) => $q->where('source_type', $v))
            ->when($request->query('customer_id'), fn (Builder $q, string $v) => $q->where('customer_id', $v))
            ->when($request->query('cash_register_session_id'), fn (Builder $q, string $v) => $q->where('cash_register_session_id', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('created_at', '>=', $day($v)))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('created_at', '<', $day($v)->addDay()));

        $listed = ListQuery::apply(clone $query, $request, sortable: ['created_at', 'amount'], searchable: ['source_number', 'reference'], defaultSort: '-created_at');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, PaymentsLedgerExport::class, RowSource::fromQuery($listed, fn (Collection $payments) => $payments->map($this->presenter->payments($payments))));
        }

        $sums = (clone $query)->groupBy('direction')->selectRaw('direction, SUM(amount) as total')->pluck('total', 'direction');
        $in = Decimal::round((string) ($sums[PaymentDirection::In->value] ?? '0'), 2);
        $out = Decimal::round((string) ($sums[PaymentDirection::Out->value] ?? '0'), 2);

        $page = $listed->paginate(ListQuery::perPage($request));
        $present = $this->presenter->payments(collect($page->items()));

        return ApiResponse::paginated($page, fn (Payment $p) => new JsonResource($present($p)), ['totals' => ['in' => $in, 'out' => $out, 'net' => Decimal::sub($in, $out, 2)]]);
    }
}
