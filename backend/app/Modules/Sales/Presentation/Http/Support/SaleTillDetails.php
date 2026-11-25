<?php

namespace App\Modules\Sales\Presentation\Http\Support;

use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SalePromotion;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Collection;

/**
 * POS1a: what the invoice and receipt show about prices and promotions — per line the list
 * price, where the charged price came from, who approved a changed price and the line's
 * promotion; per sale the promotions used, the coupon, the savings and who approved the
 * manual discounts. Same shapes as the priced cart.
 */
final class SaleTillDetails
{
    /**
     * @param  Collection<int, SaleLine>  $lines
     * @param  array<string, string>  $users  id => name
     * @return array{sale: array<string, mixed>, lines: array<string, array<string, mixed>>}
     */
    public static function of(Sale $sale, Collection $lines, array $users): array
    {
        $person = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $users[$id] ?? null];

        $savings = Money::of((string) $sale->item_discount_total, $sale->currency)->plus(Money::of((string) $sale->invoice_discount_total, $sale->currency));
        $result = [];
        foreach ($lines as $line) {
            if ($line->list_price !== null) {
                $difference = Money::ofProduct((string) $line->quantity, (string) $line->list_price, $sale->currency)->minus(Money::of((string) $line->line_subtotal, $sale->currency));
                if ($difference->isPositive()) {
                    $savings = $savings->plus($difference);
                }
            }
            $promotion = Decimal::compare((string) $line->promotion_discount, '0') > 0
                ? ['name' => $line->promotion_name, 'amount' => (string) $line->promotion_discount]
                : null;
            $result[$line->id] = [
                'list_price' => $line->list_price === null ? null : (string) $line->list_price,
                'price_source' => $line->price_source,
                'price_approved_by' => $person($line->price_approved_by),
                'promotion' => $promotion,
                'promotion_discount' => (string) $line->promotion_discount,
            ];
        }

        return [
            'sale' => [
                'promotions' => $sale->promotions()->get()->map(fn (SalePromotion $p) => [
                    'name' => $p->name,
                    'kind' => $p->kind,
                    'amount' => (string) $p->amount,
                ])->values()->all(),
                'coupon_code' => $sale->coupon_code,
                'savings_total' => $savings->amount(),
                'discount_approved_by' => $person($sale->discount_approved_by),
            ],
            'lines' => $result,
        ];
    }
}
