<?php

namespace App\Modules\Purchasing\Infrastructure\Documents;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqLine;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Shared\Infrastructure\Export\PdfFonts;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Support\Str;

/**
 * The request for quotation sent to one supplier (SC2): letterhead, RFQ number and date,
 * supplier and delivery address, reply-by and needed-by dates, the lines (SKU, item,
 * quantity, unit — never prices) with blank columns for the supplier's price and lead time,
 * and the notes. Rendered with the X1 PdfRenderer (A4 portrait, "Page X of Y").
 */
class RfqDocument
{
    public function __construct(
        private readonly PdfRenderer $renderer,
        private readonly ViewFactory $views,
        private readonly DocumentLetterhead $letterhead,
        private readonly ProductDirectory $products,
        private readonly BranchDirectory $branches,
        private readonly SupplierDirectory $suppliers,
    ) {}

    /** PDF bytes; throws PdfUnavailable (503) when no renderer can run. */
    public function render(Rfq $rfq, string $supplierId): string
    {
        return $this->renderer->render($this->html($rfq, $supplierId), false, self::footer($rfq->number));
    }

    public function html(Rfq $rfq, string $supplierId): string
    {
        $organizationId = $rfq->organization_id;
        $letterhead = $this->letterhead->forOrganization($organizationId);
        $timezone = $letterhead['timezone'] !== '' ? $letterhead['timezone'] : (string) config('app.timezone');
        $supplier = $this->suppliers->contacts($organizationId, [$supplierId])[$supplierId];
        $store = $this->branches->storeSummaries($organizationId, [$rfq->store_id])[$rfq->store_id] ?? null;
        $branch = $this->branches->profile($rfq->branch_id, $organizationId);
        $lines = $rfq->lines()->get();
        $variants = $this->products->variants($organizationId, $lines->pluck('variant_id')->all());

        return $this->views->make('purchasing.rfq', [
            'fontCss' => PdfFonts::css(),
            'letterhead' => $letterhead,
            'supplier' => $supplier,
            'deliverTo' => [
                'name' => $store === null ? ($branch['name'] ?? '') : $store['name'].' — '.$store['branch_name'],
                'address' => $branch['address'] ?? null,
                'phone' => $branch['phone'] ?? null,
            ],
            'rfq' => [
                'number' => $rfq->number,
                'title' => $rfq->title,
                'date' => CarbonImmutable::instance($rfq->sent_at ?? now())->setTimezone($timezone)->format('d M Y'),
                'reply_by' => $rfq->reply_by?->format('d M Y'),
                'needed_by' => $rfq->needed_by?->format('d M Y'),
                'notes' => $rfq->notes,
            ],
            'lines' => $lines->map(function (RfqLine $line) use ($variants) {
                $variant = $variants[$line->variant_id] ?? null;

                return [
                    'sku' => $variant['sku'] ?? '',
                    'name' => $variant === null ? '' : $variant['product_name'].($variant['variant_name'] ? ' — '.$variant['variant_name'] : ''),
                    'quantity' => ExportValues::quantity($line->quantity),
                    'unit' => $variant['unit_code'] ?? '',
                    'notes' => $line->notes,
                ];
            })->values()->all(),
        ])->render();
    }

    /**
     * @param  array{code: string}  $supplier
     */
    public static function filename(Rfq $rfq, array $supplier): string
    {
        return $rfq->number.'-'.Str::slug($supplier['code']).'.pdf';
    }

    private static function footer(string $number): string
    {
        return '<div style="width:100%;font-size:8px;color:#555;padding:0 10mm;font-family:sans-serif;display:flex;justify-content:space-between">'
            .'<span>'.e($number).'</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>';
    }
}
