<?php

namespace App\Modules\Purchasing\Infrastructure\Documents;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Shared\Infrastructure\Export\PdfFonts;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Support\Str;

/**
 * The purchase order sent to the supplier (ST2b): letterhead, PO number and dates, supplier
 * and delivery store, lines (quantity, unit cost, discount %, free quantity, tax, line total),
 * the totals, notes and the supplier's payment terms. Rendered like the RFQ document.
 */
class PurchaseOrderDocument
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
    public function render(PurchaseOrder $order): string
    {
        return $this->renderer->render($this->html($order), false, self::footer($order->number));
    }

    public function html(PurchaseOrder $order): string
    {
        $organizationId = $order->organization_id;
        $supplier = $this->suppliers->contacts($organizationId, [$order->supplier_id])[$order->supplier_id] ?? null;
        $terms = $this->suppliers->find($order->supplier_id, $organizationId)['payment_terms_days'] ?? 0;
        $store = $this->branches->storeSummaries($organizationId, [$order->store_id])[$order->store_id] ?? null;
        $branch = $this->branches->profile($order->branch_id, $organizationId);
        $lines = $order->lines()->get();
        $variants = $this->products->variants($organizationId, $lines->pluck('variant_id')->all());

        return $this->views->make('purchasing.purchase-order', [
            'fontCss' => PdfFonts::css(),
            'letterhead' => $this->letterhead->forOrganization($organizationId),
            'supplier' => $supplier,
            'deliverTo' => [
                'name' => $store === null ? ($branch['name'] ?? '') : $store['name'].' — '.$store['branch_name'],
                'address' => $branch['address'] ?? null,
                'phone' => $branch['phone'] ?? null,
            ],
            'order' => [
                'number' => $order->number,
                'date' => $order->order_date->format('d M Y'),
                'expected' => $order->expected_date?->format('d M Y'),
                'currency' => $order->currency,
                'subtotal' => ExportValues::grouped($order->subtotal, 2),
                'tax_total' => ExportValues::grouped($order->tax_total, 2),
                'total' => ExportValues::grouped($order->total, 2),
                'notes' => $order->notes,
                'payment_terms' => $terms > 0 ? "Net {$terms} days" : 'Due on receipt',
            ],
            'lines' => $lines->map(function (PurchaseOrderLine $line) use ($variants) {
                $variant = $variants[$line->variant_id] ?? null;

                return [
                    'sku' => $variant['sku'] ?? '',
                    'name' => $variant === null ? '' : $variant['product_name'].($variant['variant_name'] ? ' — '.$variant['variant_name'] : ''),
                    'unit' => $variant['unit_code'] ?? '',
                    'quantity' => ExportValues::quantity($line->quantity),
                    'bonus' => ExportValues::quantity($line->bonus_quantity),
                    'unit_cost' => self::cost($line->unit_cost),
                    'discount' => self::percent($line->discount_percent),
                    'tax' => ExportValues::grouped($line->line_tax, 2),
                    'total' => ExportValues::grouped($line->line_total, 2),
                ];
            })->values()->all(),
        ])->render();
    }

    /**
     * @param  array{code: string}  $supplier
     */
    public static function filename(PurchaseOrder $order, array $supplier): string
    {
        return $order->number.'-'.Str::slug($supplier['code']).'.pdf';
    }

    /** Unit costs keep up to 4 decimals but show at least 2 ("18.5000" → "18.50", "17.5750" → "17.575"). */
    public static function cost(string $value): string
    {
        [$whole, $fraction] = explode('.', ExportValues::grouped($value, 4));

        return $whole.'.'.str_pad(rtrim($fraction, '0'), 2, '0');
    }

    public static function percent(string $value): string
    {
        return str_contains($value, '.') ? rtrim(rtrim($value, '0'), '.') : $value;
    }

    public static function footer(string $number): string
    {
        return '<div style="width:100%;font-size:8px;color:#555;padding:0 10mm;font-family:sans-serif;display:flex;justify-content:space-between">'
            .'<span>'.e($number).'</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>';
    }
}
