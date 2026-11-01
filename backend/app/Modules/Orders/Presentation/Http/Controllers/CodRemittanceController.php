<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Orders\Application\Actions\RecordCodRemittance;
use App\Modules\Orders\Domain\RemittanceMethod;
use App\Modules\Orders\Infrastructure\Models\CodRemittance;
use App\Modules\Orders\Infrastructure\Models\CodRemittanceLine;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * Couriers' cash-on-delivery remittances (E10a), `web_orders.remit`. Recording needs an
 * `Idempotency-Key`; remittances cannot be edited or deleted.
 */
class CodRemittanceController
{
    public function __construct(
        private readonly CourierDirectory $couriers,
        private readonly UserDirectory $users,
    ) {}

    /**
     * COD remittances
     *
     * Filters: `courier_id`, `date_from`/`date_to` (received date). Newest first, 25 per page.
     * Rows: `{id, number, courier: {id, name}, reference, received_at (Y-m-d), method,
     * method_label, currency, gross_amount, fee_amount, net_amount, order_count, created_at,
     * created_by: {id, name}}`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'courier_id' => ['sometimes', 'uuid'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'search' => ['sometimes', 'nullable', 'string', 'max:60'],
        ]);
        $query = CodRemittance::query()
            ->withCount('lines')
            ->when($request->query('courier_id'), fn (Builder $q, string $v) => $q->where('courier_id', $v))
            ->when($request->query('date_from'), fn (Builder $q, string $v) => $q->where('received_at', '>=', $v))
            ->when($request->query('date_to'), fn (Builder $q, string $v) => $q->where('received_at', '<=', $v));
        $page = ListQuery::paginate($query, $request, sortable: ['received_at', 'number', 'created_at', 'gross_amount'], searchable: ['number', 'reference'], defaultSort: '-number');

        /** @var list<CodRemittance> $items */
        $items = $page->items();
        $couriers = $this->couriers->summaries(array_values(array_unique(array_map(fn (CodRemittance $r) => $r->courier_id, $items))));
        $names = $items === [] ? [] : $this->users->names($items[0]->organization_id, array_values(array_filter(array_map(fn (CodRemittance $r) => $r->created_by, $items))));

        return ApiResponse::paginated($page, fn (CodRemittance $r) => new JsonResource($this->row($r, $couriers, $names)));
    }

    /**
     * COD remittance
     *
     * The row plus `note`, `expense` (`{id, number}` of the courier fee expense, or null) and
     * `lines` (`[{order_id, number, placed_at, delivered_at, contact_name, amount}]` by number).
     */
    public function show(CodRemittance $codRemittance): JsonResponse
    {
        return ApiResponse::success($this->document($codRemittance));
    }

    /**
     * Record a COD remittance
     *
     * `{courier_id, reference? (≤ 60, the courier's statement number), received_at (Y-m-d, not
     * in the future), method: bank_transfer|cash|mobile_banking, fee_amount (≥ 0, ≤ the gross),
     * order_ids: [uuid] (1–500), note? (≤ 500)}`. All or nothing: 422 `REMITTANCE_INVALID` with
     * `details.orders: [{id, number, reason: not_found|not_cod|not_delivered|already_paid|
     * other_courier}]`. Every order becomes paid (`cash_on_delivery` for its total, reference =
     * the REM number); a fee above zero is booked as an expense in "Courier fees". 201 with the
     * remittance as `GET` shows it.
     */
    public function store(Request $request, RecordCodRemittance $record, OrganizationDirectory $organizations, TenantContext $tenant): JsonResponse
    {
        $timezone = $organizations->summary($tenant->requireOrganization())['timezone'] ?? config('app.timezone');
        $data = $request->validate([
            'courier_id' => ['required', 'uuid'],
            'reference' => ['sometimes', 'nullable', 'string', 'max:60'],
            'received_at' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.CarbonImmutable::now($timezone)->toDateString()],
            'method' => ['required', Rule::enum(RemittanceMethod::class)],
            'fee_amount' => ['required', 'numeric', 'min:0', 'max:99999999', 'decimal:0,2'],
            'order_ids' => ['required', 'array', 'min:1', 'max:500'],
            'order_ids.*' => ['required', 'uuid', 'distinct'],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);
        $data['fee_amount'] = (string) $data['fee_amount'];

        $remittance = $record($data, (string) $request->user()->getAuthIdentifier());

        return ApiResponse::created($this->document($remittance));
    }

    /**
     * @return array<string, mixed>
     */
    private function document(CodRemittance $remittance): array
    {
        $remittance->loadCount('lines');
        $couriers = $this->couriers->summaries([$remittance->courier_id]);
        $names = $this->users->names($remittance->organization_id, array_values(array_filter([$remittance->created_by])));
        $lines = CodRemittanceLine::query()->where('remittance_id', $remittance->id)->with('order')->get()
            ->sortBy(fn (CodRemittanceLine $l) => $l->order->number)->values();
        $expense = $remittance->expense_id === null ? null : ['id' => $remittance->expense_id, 'number' => $remittance->expense_number];

        return $this->row($remittance, $couriers, $names) + [
            'note' => $remittance->note,
            'expense' => $expense,
            'lines' => $lines->map(fn (CodRemittanceLine $l) => [
                'order_id' => $l->order_id,
                'number' => $l->order->number,
                'placed_at' => $l->order->placed_at->toIso8601String(),
                'delivered_at' => $l->order->delivered_at?->toIso8601String(),
                'contact_name' => $l->order->contact_name,
                'amount' => (string) $l->amount,
            ])->all(),
        ];
    }

    /**
     * @param  array<string, array{name: string}>  $couriers
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    private function row(CodRemittance $r, array $couriers, array $names): array
    {
        return [
            'id' => $r->id,
            'number' => $r->number,
            'courier' => ['id' => $r->courier_id, 'name' => $couriers[$r->courier_id]['name'] ?? null],
            'reference' => $r->reference,
            'received_at' => $r->received_at->toDateString(),
            'method' => $r->method->value,
            'method_label' => $r->method->label(),
            'currency' => $r->currency,
            'gross_amount' => (string) $r->gross_amount,
            'fee_amount' => (string) $r->fee_amount,
            'net_amount' => (string) $r->net_amount,
            'order_count' => (int) $r->getAttribute('lines_count'),
            'created_at' => $r->created_at->toIso8601String(),
            'created_by' => $r->created_by === null ? null : ['id' => $r->created_by, 'name' => $names[$r->created_by] ?? null],
        ];
    }
}
