<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Actions\AwardRfq;
use App\Modules\Purchasing\Application\Actions\ChangeRfqStatus;
use App\Modules\Purchasing\Application\Actions\RecordSupplierQuote;
use App\Modules\Purchasing\Application\Actions\SaveRfq;
use App\Modules\Purchasing\Application\Actions\SendRfq;
use App\Modules\Purchasing\Domain\Procurement\QuoteComparison;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Infrastructure\Documents\RfqDocument;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqLine;
use App\Modules\Purchasing\Infrastructure\Models\RfqSupplier;
use App\Modules\Purchasing\Infrastructure\Models\SupplierQuoteLine;
use App\Modules\Purchasing\Presentation\Http\Exports\RfqsExport;
use App\Modules\Purchasing\Presentation\Http\Requests\AwardRfqRequest;
use App\Modules\Purchasing\Presentation\Http\Requests\RecordQuoteRequest;
use App\Modules\Purchasing\Presentation\Http\Requests\SaveRfqRequest;
use App\Modules\Purchasing\Presentation\Http\Support\ProcurementPresenter;
use App\Modules\Purchasing\Presentation\Http\Support\PurchasingPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Requests for quotation (SC2): drafts, invited suppliers, sending (PDF per supplier, queued
 * e-mail with the PDF), recorded quotes, the comparison and the award.
 */
class RfqController
{
    public function __construct(
        private readonly ProcurementPresenter $presenter,
        private readonly PurchasingPresenter $purchasing,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * List RFQs
     *
     * Filters: `status`, `requisition_id`, `supplier_id` (invited); `search` matches number and
     * title. Sort: `created_at` (default, newest first), `number`, `reply_by`, `sent_at`.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(RfqStatus::class)],
            'requisition_id' => ['sometimes', 'uuid'],
            'supplier_id' => ['sometimes', 'uuid'],
        ]);
        $query = Rfq::query()
            ->withCount(['lines', 'suppliers', 'suppliers as quotes_count' => fn (Builder $q) => $q->whereHas('quote')])
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('requisition_id'), fn (Builder $q, string $v) => $q->where('requisition_id', $v))
            ->when($request->query('supplier_id'), fn (Builder $q, string $v) => $q->whereHas('suppliers', fn (Builder $s) => $s->where('supplier_id', $v)));
        $this->purchasing->scopeBranches($query, $this->user($request));

        ListQuery::apply($query, $request, sortable: ['created_at', 'number', 'reply_by', 'sent_at'], searchable: ['number', 'title']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, RfqsExport::class, RowSource::fromQuery($query, fn (Collection $rows) => $rows->map($this->presenter->rfqHeaders($rows))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $header = $this->presenter->rfqHeaders(collect($page->items()));

        return ApiResponse::paginated($page, fn (Rfq $r) => new JsonResource($header($r)));
    }

    /**
     * Create an RFQ
     *
     * A blank draft for a store of the user's branches (RFQs for requisition lines are created
     * by converting the requisition). `supplier_ids` invites suppliers.
     */
    public function store(SaveRfqRequest $request, SaveRfq $save): JsonResponse
    {
        $user = $this->user($request);

        return ApiResponse::created($this->presenter->rfq($save->create($user, $request->validated()), $user));
    }

    public function show(Request $request, Rfq $rfq): JsonResponse
    {
        $user = $this->visible($request, $rfq);

        return ApiResponse::success($this->presenter->rfq($rfq, $user));
    }

    /**
     * Update a draft RFQ
     *
     * Header fields; `lines` (blank RFQs only) and `supplier_ids` (the full list of invited
     * suppliers) replace the current ones when sent.
     */
    public function update(SaveRfqRequest $request, Rfq $rfq, SaveRfq $save): JsonResponse
    {
        $user = $this->visible($request, $rfq);

        return ApiResponse::success($this->presenter->rfq($save->update($user, $rfq, $request->validated()), $user));
    }

    /**
     * Invite suppliers
     *
     * Adds suppliers (draft or sent); on a sent RFQ the new suppliers get the request at once.
     * Requires an `Idempotency-Key` header.
     */
    public function invite(Request $request, Rfq $rfq, SaveRfq $save): JsonResponse
    {
        $user = $this->visible($request, $rfq);
        $data = $request->validate(['supplier_ids' => ['required', 'array', 'min:1', 'max:20'], 'supplier_ids.*' => ['uuid', 'distinct']]);

        return ApiResponse::success($this->presenter->rfq($save->invite($rfq, $data['supplier_ids']), $user));
    }

    public function removeSupplier(Request $request, Rfq $rfq, string $supplierId, SaveRfq $save): JsonResponse
    {
        $user = $this->visible($request, $rfq);

        return ApiResponse::success($this->presenter->rfq($save->removeSupplier($rfq, $supplierId), $user));
    }

    /**
     * Send the RFQ
     *
     * Needs 2+ invited suppliers, a line and a reply-by date. Suppliers with an e-mail address
     * get a queued e-mail with their PDF attached; the others are flagged `send_manually`.
     * Requires an `Idempotency-Key` header.
     */
    public function send(Request $request, Rfq $rfq, SendRfq $send): JsonResponse
    {
        $user = $this->visible($request, $rfq);

        return ApiResponse::success($this->presenter->rfq($send->send($rfq), $user));
    }

    /**
     * The request PDF for one invited supplier
     */
    public function pdf(Request $request, Rfq $rfq, string $supplierId, RfqDocument $document, SupplierDirectory $suppliers): Response
    {
        $this->visible($request, $rfq);
        if (! $rfq->suppliers()->where('supplier_id', $supplierId)->exists()) {
            throw new NotFoundHttpException;
        }
        $supplier = $suppliers->contacts($rfq->organization_id, [$supplierId])[$supplierId];

        return response($document->render($rfq, $supplierId), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.RfqDocument::filename($rfq, $supplier).'"',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    /**
     * Record a supplier's quote (or decline)
     *
     * `status=received` with prices for any of the lines, or `status=declined`. Recording again
     * replaces the supplier's previous answer. Requires an `Idempotency-Key` header.
     */
    public function quote(RecordQuoteRequest $request, Rfq $rfq, RecordSupplierQuote $record): JsonResponse
    {
        $user = $this->visible($request, $rfq);
        $record($rfq, $request->validated());

        return ApiResponse::success($this->presenter->rfq($rfq->refresh(), $user));
    }

    /**
     * Quote comparison
     *
     * Lines × suppliers: unit price, line total (requested quantity × price), lead time,
     * validity, flags `lowest_price` / `fastest` / `expired` / `partial`; per supplier the total
     * of the quoted lines and the coverage.
     */
    public function comparison(Request $request, Rfq $rfq, ProductDirectory $products, SupplierDirectory $suppliers, OrganizationDate $dates): JsonResponse
    {
        $this->visible($request, $rfq);
        $org = $this->tenant->requireOrganization();
        $lines = $rfq->lines()->get();
        $invited = $rfq->suppliers()->with('quote.lines')->get();
        $variants = $products->variants($org, $lines->pluck('variant_id')->all());
        $contacts = $suppliers->contacts($org, $invited->pluck('supplier_id')->all());
        $currency = $this->presenter->rfqHeaders(collect([$rfq]))($rfq)['currency'];

        $result = QuoteComparison::compare(
            $lines->map(fn (RfqLine $l) => ['id' => $l->id, 'quantity' => $l->quantity])->values()->all(),
            $invited->map(fn (RfqSupplier $s) => [
                'supplier_id' => $s->supplier_id,
                'status' => $s->quote?->status->value ?? 'pending',
                'valid_until' => $s->quote?->valid_until?->toDateString(),
                'prices' => $s->quote === null ? [] : $s->quote->lines->mapWithKeys(fn (SupplierQuoteLine $q) => [$q->rfq_line_id => [
                    'unit_price' => $q->unit_price,
                    'quantity_offered' => $q->quantity_offered,
                    'lead_time_days' => $q->lead_time_days,
                ]])->all(),
            ])->values()->all(),
            $currency,
            $dates->today(),
        );

        $byLine = $lines->keyBy('id');
        $supplierRef = fn (string $id) => isset($contacts[$id]) ? ['id' => $id, 'code' => $contacts[$id]['code'], 'name' => $contacts[$id]['name'], 'email' => $contacts[$id]['email']] : ['id' => $id, 'code' => null, 'name' => null, 'email' => null];

        return ApiResponse::success([
            'rfq' => ['id' => $rfq->id, 'number' => $rfq->number, 'status' => $rfq->status->value],
            'currency' => $currency,
            'line_count' => $lines->count(),
            'suppliers' => array_map(fn (array $s) => ['supplier' => $supplierRef($s['supplier_id'])] + $s, $result['suppliers']),
            'lines' => array_map(fn (array $l) => [
                'rfq_line_id' => $l['rfq_line_id'],
                'line' => $this->presenter->rfqLine($byLine[$l['rfq_line_id']], $variants),
            ] + $l, $result['lines']),
        ]);
    }

    /**
     * Award the RFQ
     *
     * `lines: [{rfq_line_id, supplier_id, quantity}]` (split awards allowed) → one draft purchase
     * order per supplier at the quoted prices; `update_catalog` writes the quoted cost and lead
     * time into the supplier catalog. Requires an `Idempotency-Key` header.
     */
    public function award(AwardRfqRequest $request, Rfq $rfq, AwardRfq $award): JsonResponse
    {
        $user = $this->visible($request, $rfq);
        $result = $award($user, $rfq, $request->validated());

        return ApiResponse::created([
            'rfq' => $this->presenter->rfq($result['rfq'], $user),
            'purchase_orders' => $this->presenter->orderRefs($result['orders']),
            'catalog_updated' => $result['catalog_updated'],
        ]);
    }

    public function close(Request $request, Rfq $rfq, ChangeRfqStatus $status): JsonResponse
    {
        $user = $this->visible($request, $rfq);
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);

        return ApiResponse::success($this->presenter->rfq($status->close($rfq, $data['reason'] ?? null), $user));
    }

    public function cancel(Request $request, Rfq $rfq, ChangeRfqStatus $status): JsonResponse
    {
        $user = $this->visible($request, $rfq);
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);

        return ApiResponse::success($this->presenter->rfq($status->cancel($rfq, $data['reason'] ?? null), $user));
    }

    private function visible(Request $request, Rfq $rfq): TenantUser
    {
        $user = $this->user($request);
        $this->purchasing->assertVisible($user, $rfq->branch_id);

        return $user;
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
