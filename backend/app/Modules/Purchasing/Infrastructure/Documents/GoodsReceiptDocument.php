<?php

namespace App\Modules\Purchasing\Infrastructure\Documents;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptCharge;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Shared\Infrastructure\Export\PdfFonts;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Support\Str;

/**
 * The goods receipt (ST2b): letterhead, GRN number, supplier and its invoice number / date,
 * the receiving store, lines (quantity, free quantity, unit cost, discount %, effective cost,
 * tax, line total), the charges and the totals. Rendered like the RFQ document.
 */
class GoodsReceiptDocument
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
    public function render(GoodsReceipt $receipt): string
    {
        return $this->renderer->render($this->html($receipt), false, PurchaseOrderDocument::footer($receipt->number));
    }

    public function html(GoodsReceipt $receipt): string
    {
        $organizationId = $receipt->organization_id;
        $store = $this->branches->storeSummaries($organizationId, [$receipt->store_id])[$receipt->store_id] ?? null;
        $lines = $receipt->lines()->get();
        $variants = $this->products->variants($organizationId, $lines->pluck('variant_id')->all());
        $money = fn (string $value) => ExportValues::grouped($value, 2);
        $letterhead = $this->letterhead->forOrganization($organizationId);
        $timezone = $letterhead['timezone'] !== '' ? $letterhead['timezone'] : (string) config('app.timezone');

        return $this->views->make('purchasing.goods-receipt', [
            'fontCss' => PdfFonts::css(),
            'letterhead' => $letterhead,
            'supplier' => $this->suppliers->contacts($organizationId, [$receipt->supplier_id])[$receipt->supplier_id] ?? null,
            'store' => $store === null ? '' : $store['name'].' — '.$store['branch_name'],
            'receipt' => [
                'number' => $receipt->number,
                'date' => CarbonImmutable::instance($receipt->created_at)->setTimezone($timezone)->format('d M Y'),
                'order_number' => $receipt->purchase_order_id === null ? null : PurchaseOrder::query()->whereKey($receipt->purchase_order_id)->value('number'),
                'invoice_number' => $receipt->supplier_invoice_number,
                'invoice_date' => $receipt->invoice_date->format('d M Y'),
                'due_date' => $receipt->due_date?->format('d M Y'),
                'currency' => $receipt->currency,
                'subtotal' => $money($receipt->subtotal),
                'tax_total' => $money($receipt->tax_total),
                'total' => $money($receipt->total),
                'charges_total' => $money($receipt->charges_total),
                'charges_tax_total' => $money($receipt->charges_tax_total),
                'payable_total' => $money($receipt->payable_total),
                'notes' => $receipt->notes,
            ],
            'lines' => $lines->map(function (GoodsReceiptLine $line) use ($variants, $money) {
                $variant = $variants[$line->variant_id] ?? null;

                return [
                    'sku' => $variant['sku'] ?? '',
                    'name' => $variant === null ? '' : $variant['product_name'].($variant['variant_name'] ? ' — '.$variant['variant_name'] : ''),
                    'unit' => $variant['unit_code'] ?? '',
                    'quantity' => ExportValues::quantity($line->quantity),
                    'bonus' => ExportValues::quantity($line->bonus_quantity),
                    'unit_cost' => PurchaseOrderDocument::cost($line->unit_cost),
                    'discount' => PurchaseOrderDocument::percent($line->discount_percent),
                    'effective_cost' => PurchaseOrderDocument::cost($line->effective_unit_cost),
                    'tax' => $money($line->line_tax),
                    'total' => $money($line->line_total),
                ];
            })->values()->all(),
            'charges' => $receipt->charges()->get()->map(fn (GoodsReceiptCharge $c) => [
                'type' => $c->type->label(),
                'description' => $c->description,
                'amount' => $money($c->amount),
                'tax' => $money($c->tax_amount),
            ])->values()->all(),
        ])->render();
    }

    /**
     * @param  array{code: string}  $supplier
     */
    public static function filename(GoodsReceipt $receipt, array $supplier): string
    {
        return $receipt->number.'-'.Str::slug($supplier['code']).'.pdf';
    }
}
