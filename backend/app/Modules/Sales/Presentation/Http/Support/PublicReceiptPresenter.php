<?php

namespace App\Modules\Sales\Presentation\Http\Support;

use App\Modules\Sales\Infrastructure\Models\Sale;

/**
 * POS1d: the digital receipt anyone with its link may read (the public receipt page and the
 * receipt e-mail) — what the printed receipt shows and nothing more: the organization / branch
 * header and footer, lines, totals, tax, payments (a gift card by its last 4 characters only),
 * change, the exchange it came from, the customer's name and the cashier's first name. Never
 * costs, the customer's phone, e-mail or balance, payment references or internal ids.
 */
class PublicReceiptPresenter
{
    public function __construct(private readonly SalePresenter $sales) {}

    /**
     * @return array<string, mixed>
     */
    public function present(Sale $sale): array
    {
        $doc = $this->sales->document($sale, false);
        $receipt = $doc['receipt'];
        $branch = $receipt['branch'];
        $cashier = trim((string) ($doc['cashier']['name'] ?? ''));
        $exchange = $doc['exchange'];

        return [
            'number' => $doc['number'],
            'status' => $doc['status'],
            'sold_at' => $doc['sold_at'],
            'cancelled_at' => $doc['cancelled_at'],
            'currency' => $doc['currency'],
            'tax_mode' => $doc['tax_mode'],
            'store' => $doc['store'] === null ? null : ['name' => $doc['store']['name']],
            'customer' => $doc['customer'] === null ? null : ['name' => $doc['customer']['name'] ?? null],
            'cashier' => $cashier === '' ? null : ['name' => explode(' ', $cashier)[0]],
            'receipt' => [
                'organization_name' => $receipt['organization_name'],
                'tax_number' => $receipt['tax_number'],
                'is_tax_invoice' => $receipt['is_tax_invoice'],
                'header' => $receipt['header'],
                'footer' => $receipt['footer'],
                'branch' => $branch === null ? null : [
                    'name' => $branch['name'] ?? null,
                    'address' => $branch['address'] ?? null,
                    'phone' => $branch['phone'] ?? null,
                    'email' => $branch['email'] ?? null,
                ],
                'timezone' => $receipt['timezone'],
            ],
            'lines' => array_map(fn (array $l) => [
                'product_name' => $l['product_name'],
                'variant_name' => $l['variant_name'],
                'unit_code' => $l['unit_code'],
                'quantity' => $l['quantity'],
                'unit_price' => $l['unit_price'],
                'list_price' => $l['list_price'],
                'discount_amount' => $l['discount_amount'],
                'promotion' => $l['promotion'],
                'tax_rate' => $l['tax_rate'],
                'tax_amount' => $l['tax_amount'],
                'line_total' => $l['line_total'],
                'serials' => $l['serials'],
            ], $doc['lines']),
            'subtotal' => $doc['subtotal'],
            'item_discount_total' => $doc['item_discount_total'],
            'invoice_discount_total' => $doc['invoice_discount_total'],
            'promotions' => $doc['promotions'],
            'coupon_code' => $doc['coupon_code'],
            'savings_total' => $doc['savings_total'],
            'tax_total' => $doc['tax_total'],
            'total' => $doc['total'],
            'paid_total' => $doc['paid_total'],
            'change_total' => $doc['change_total'],
            'due_total' => $doc['due_total'],
            'payments' => array_map(fn (array $p) => [
                'kind' => $p['kind'],
                'method' => $p['method'],
                'method_label' => $p['method_label'],
                'amount' => $p['amount'],
                'tendered' => $p['tendered'],
                'gift_card_last4' => $p['gift_card_last4'],
            ], $doc['payments']),
            'exchange' => $exchange === null ? null : [
                'return_number' => $exchange['return_number'],
                'original_sale_number' => $exchange['original_sale_number'],
                'value' => $exchange['value'],
                'applied' => $exchange['applied'],
                'lines' => $exchange['lines'],
            ],
        ];
    }
}
