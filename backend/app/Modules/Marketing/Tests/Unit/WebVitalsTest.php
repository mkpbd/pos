<?php

namespace App\Modules\Marketing\Tests\Unit;

use App\Modules\Marketing\Application\Actions\RecordPageEvents;
use App\Modules\Marketing\Domain\WebVitals;
use PHPUnit\Framework\TestCase;

/**
 * B15: Web Vitals histograms put Google's thresholds exactly on bucket edges; the 75th
 * percentile comes from the counts; click positions map to a 20 × 20 grid.
 */
class WebVitalsTest extends TestCase
{
    public function test_buckets_rate_exactly_at_the_thresholds(): void
    {
        $this->assertSame([25, 26, 40, 41], [WebVitals::bucket('lcp', 2500), WebVitals::bucket('lcp', 2501), WebVitals::bucket('lcp', 4000), WebVitals::bucket('lcp', 4000.4)]);
        $this->assertSame(['good', 'needs_improvement', 'needs_improvement', 'poor'], [
            WebVitals::rating('lcp', 25), WebVitals::rating('lcp', 26), WebVitals::rating('lcp', 40), WebVitals::rating('lcp', 41),
        ]);
        $this->assertSame([8, 9, 20, 21], [WebVitals::bucket('inp', 200), WebVitals::bucket('inp', 201), WebVitals::bucket('inp', 500), WebVitals::bucket('inp', 501)]);
        $this->assertSame([10, 11, 25, 26, 0], [WebVitals::bucket('cls', 0.1), WebVitals::bucket('cls', 0.1001), WebVitals::bucket('cls', 0.25), WebVitals::bucket('cls', 0.26), WebVitals::bucket('cls', 0)]);
        $this->assertSame(['good', 'poor'], [WebVitals::rating('cls', 10), WebVitals::rating('cls', 26)]);
        // Capped at the last bucket; implausible values are ignored.
        $this->assertSame([100, 80, 100], [WebVitals::bucket('lcp', 25000), WebVitals::bucket('inp', 9000), WebVitals::bucket('cls', 4.2)]);
        $this->assertSame([null, null, null, null, null], [
            WebVitals::bucket('lcp', -1), WebVitals::bucket('lcp', 60001), WebVitals::bucket('cls', 11), WebVitals::bucket('lcp', '2500'), WebVitals::bucket('fid', 10),
        ]);
        $this->assertSame([2500, 200, '0.100'], [WebVitals::value('lcp', 25), WebVitals::value('inp', 8), WebVitals::value('cls', 10)]);
    }

    public function test_the_75th_percentile_comes_from_the_histogram(): void
    {
        $this->assertNull(WebVitals::p75([]));
        $this->assertSame(12, WebVitals::p75([12 => 5]));
        // 4 samples: the third smallest.
        $this->assertSame(30, WebVitals::p75([40 => 1, 10 => 1, 30 => 1, 20 => 1]));
        $this->assertSame(20, WebVitals::p75([10 => 70, 20 => 10, 90 => 20]));
    }

    public function test_click_positions_map_to_the_grid(): void
    {
        $this->assertSame([0, 0], RecordPageEvents::cell(0, 0));
        $this->assertSame([19, 19], RecordPageEvents::cell(1, 1.0));
        $this->assertSame([8, 16], RecordPageEvents::cell(0.42, 0.8));
        $this->assertNull(RecordPageEvents::cell(1.01, 0.5));
        $this->assertNull(RecordPageEvents::cell('0.5', 0.5));
        $this->assertNull(RecordPageEvents::cell(null, 0.5));
    }
}
