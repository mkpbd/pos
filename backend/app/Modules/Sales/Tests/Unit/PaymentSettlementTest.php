<?php

namespace App\Modules\Sales\Tests\Unit;

use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Sales\Domain\PaymentSettlement;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use PHPUnit\Framework\TestCase;

/**
 * Critical workflow #7: multiple payment processing.
 */
class PaymentSettlementTest extends TestCase
{
    private function settle(string $total, array $tenders): array
    {
        return PaymentSettlement::settle(Money::of($total, 'BDT'), array_map(fn (array $t) => ['method' => $t[0], 'amount' => $t[1]], $tenders));
    }

    public function test_cash_over_the_total_gives_change(): void
    {
        $result = $this->settle('230.00', [[PaymentMethod::Cash, '250']]);

        $this->assertSame('230.00', $result['paid_total']);
        $this->assertSame('20.00', $result['change']);
        $this->assertSame('0.00', $result['due']);
        $this->assertSame('230.00', $result['payments'][0]['amount']);
        $this->assertSame('250.00', $result['payments'][0]['tendered']);
    }

    public function test_split_payment_takes_change_from_cash_only(): void
    {
        $result = $this->settle('230.00', [[PaymentMethod::Card, '100'], [PaymentMethod::Cash, '150']]);

        $this->assertSame([['card', '100.00', null], ['cash', '130.00', '150.00']], array_map(
            fn (array $p) => [$p['method']->value, $p['amount'], $p['tendered']],
            $result['payments'],
        ));
        $this->assertSame('20.00', $result['change']);
    }

    public function test_partial_payment_leaves_the_rest_due(): void
    {
        $result = $this->settle('230.00', [[PaymentMethod::MobileBanking, '100.50']]);

        $this->assertSame('100.50', $result['paid_total']);
        $this->assertSame('129.50', $result['due']);
        $this->assertSame('0.00', $result['change']);
    }

    public function test_no_payment_is_a_full_credit_sale(): void
    {
        $result = $this->settle('99.99', []);

        $this->assertSame([], $result['payments']);
        $this->assertSame('99.99', $result['due']);
    }

    public function test_card_cannot_be_overpaid(): void
    {
        $this->expectException(BusinessRuleViolation::class);
        $this->expectExceptionMessage('only cash can be over-tendered');

        $this->settle('230.00', [[PaymentMethod::Card, '240'], [PaymentMethod::Cash, '5']]);
    }
}
