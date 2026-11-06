<?php

namespace App\Modules\Reports\Tests\Unit;

use App\Modules\Reports\Domain\Aging;
use PHPUnit\Framework\TestCase;

class AgingTest extends TestCase
{
    public function test_buckets_by_age(): void
    {
        $this->assertSame('days_0_30', Aging::bucket(-3));
        $this->assertSame('days_0_30', Aging::bucket(30));
        $this->assertSame('days_31_60', Aging::bucket(31));
        $this->assertSame('days_61_90', Aging::bucket(90));
        $this->assertSame('days_over_90', Aging::bucket(91));
    }

    public function test_credits_settle_the_oldest_buckets_first(): void
    {
        $this->assertSame(
            ['outstanding' => '250.00', 'days_0_30' => '100.00', 'days_31_60' => '150.00', 'days_61_90' => '0.00', 'days_over_90' => '0.00'],
            Aging::allocate(['days_0_30' => '100', 'days_31_60' => '200', 'days_over_90' => '350'], '400'),
        );
    }

    public function test_a_credit_balance_leaves_every_bucket_empty(): void
    {
        $this->assertSame(
            ['outstanding' => '-20.00', 'days_0_30' => '0.00', 'days_31_60' => '0.00', 'days_61_90' => '0.00', 'days_over_90' => '0.00'],
            Aging::allocate(['days_0_30' => '80'], '100'),
        );
    }
}
