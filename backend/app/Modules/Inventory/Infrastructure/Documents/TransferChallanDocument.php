<?php

namespace App\Modules\Inventory\Infrastructure\Documents;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Models\StockTransferLine;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Shared\Infrastructure\Export\PdfFonts;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Support\Carbon;

/**
 * The delivery challan of a stock transfer (ST2b): letterhead, transfer number and dates, the
 * source and destination store / branch, the lines (item, batch / expiry, quantity sent and —
 * once received — received / damaged), the note and "Dispatched by" / "Received by" signature
 * blocks. No prices. Rendered like the RFQ document.
 */
class TransferChallanDocument
{
    public function __construct(
        private readonly PdfRenderer $renderer,
        private readonly ViewFactory $views,
        private readonly DocumentLetterhead $letterhead,
        private readonly ProductDirectory $products,
        private readonly BranchDirectory $branches,
        private readonly UserDirectory $users,
    ) {}

    /** PDF bytes; throws PdfUnavailable (503) when no renderer can run. */
    public function render(StockTransfer $transfer): string
    {
        return $this->renderer->render($this->html($transfer), false, self::footer($transfer->number));
    }

    public function html(StockTransfer $transfer): string
    {
        $organizationId = $transfer->organization_id;
        $letterhead = $this->letterhead->forOrganization($organizationId);
        $timezone = $letterhead['timezone'] !== '' ? $letterhead['timezone'] : (string) config('app.timezone');
        $at = fn (?Carbon $value) => $value === null ? null : CarbonImmutable::instance($value)->setTimezone($timezone)->format('d M Y H:i');
        $stores = $this->branches->storeSummaries($organizationId, [$transfer->from_store_id, $transfer->to_store_id]);
        $lines = $transfer->lines()->get();
        $variants = $this->products->variants($organizationId, $lines->pluck('variant_id')->all());
        $batchIds = $lines->pluck('batch_id')->filter()->unique()->values()->all();
        $batches = $batchIds === [] ? collect() : Batch::query()->whereKey($batchIds)->get()->keyBy('id');
        $names = $this->users->names($organizationId, array_values(array_filter([$transfer->dispatched_by, $transfer->completed_by])));
        $party = function (string $storeId, string $branchId) use ($stores, $organizationId) {
            $branch = $this->branches->profile($branchId, $organizationId);

            return [
                'name' => isset($stores[$storeId]) ? $stores[$storeId]['name'].' — '.$stores[$storeId]['branch_name'] : ($branch['name'] ?? ''),
                'address' => $branch['address'] ?? null,
                'phone' => $branch['phone'] ?? null,
            ];
        };

        return $this->views->make('inventory.transfer-challan', [
            'fontCss' => PdfFonts::css(),
            'letterhead' => $letterhead,
            'from' => $party($transfer->from_store_id, $transfer->from_branch_id),
            'to' => $party($transfer->to_store_id, $transfer->to_branch_id),
            'transfer' => [
                'number' => $transfer->number,
                'status' => ExportValues::status($transfer->status),
                'dispatched_at' => $at($transfer->dispatched_at),
                'received_at' => $at($transfer->completed_at),
                'dispatched_by' => $transfer->dispatched_by === null ? null : ($names[$transfer->dispatched_by] ?? null),
                'received_by' => $transfer->completed_by === null ? null : ($names[$transfer->completed_by] ?? null),
                'note' => $transfer->note,
            ],
            // Received / damaged columns only once the transfer was received (received_quantity set).
            'received' => $lines->contains(fn (StockTransferLine $l) => $l->received_quantity !== null),
            'lines' => $lines->map(function (StockTransferLine $line) use ($variants, $batches) {
                $variant = $variants[$line->variant_id] ?? null;
                $batch = $line->batch_id === null ? null : $batches->get($line->batch_id);

                return [
                    'sku' => $variant['sku'] ?? '',
                    'name' => $variant === null ? '' : $variant['product_name'].($variant['variant_name'] ? ' — '.$variant['variant_name'] : ''),
                    'unit' => $variant['unit_code'] ?? '',
                    'batch' => $batch?->batch_number,
                    'expires_on' => $batch?->expires_on?->format('d M Y'),
                    'quantity' => ExportValues::quantity($line->quantity),
                    'received' => $line->received_quantity === null ? null : ExportValues::quantity($line->received_quantity),
                    'damaged' => ExportValues::quantity($line->damaged_quantity ?? '0'),
                    'note' => $line->receive_note,
                ];
            })->values()->all(),
        ])->render();
    }

    public static function filename(StockTransfer $transfer): string
    {
        return $transfer->number.'-challan.pdf';
    }

    private static function footer(string $number): string
    {
        return '<div style="width:100%;font-size:8px;color:#555;padding:0 10mm;font-family:sans-serif;display:flex;justify-content:space-between">'
            .'<span>'.e($number).'</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>';
    }
}
