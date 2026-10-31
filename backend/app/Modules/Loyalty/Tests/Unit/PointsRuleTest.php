<?php

namespace App\Modules\Loyalty\Tests\Unit;

use App\Modules\Loyalty\Domain\PointsRule;
use PHPUnit\Framework\TestCase;

class PointsRuleTest extends TestCase
{
    public function test_points_are_earned_per_full_spend(): void
    {
        $this->assertSame(12, PointsRule::earned('1250.00', '100.00', 1));
        $this->assertSame(0, PointsRule::earned('99.99', '100.00', 1));
        $this->assertSame(6, PointsRule::earned('300.00', '100.00', 2));
        $this->assertSame(0, PointsRule::earned('-50.00', '100.00', 1));
    }

    public function test_redemption_needs_whole_points(): void
    {
        $this->assertSame(40, PointsRule::forAmount('20.00', '0.50'));
        $this->assertNull(PointsRule::forAmount('20.25', '0.50'));
        $this->assertSame(10, PointsRule::forAmount('10', '1.00'));
    }

    public function test_shares_round_down(): void
    {
        $this->assertSame(19, PointsRule::share(38, '0.5'));
        $this->assertSame(12, PointsRule::share(38, '0.333333'));
        $this->assertSame(38, PointsRule::share(38, '1'));
    }
}
