<?php

namespace App\Modules\AI\Tests\Unit;

use App\Modules\AI\Domain\Insights\LoyaltySuggestions;
use App\Modules\AI\Domain\Insights\RfmScorer;
use App\Modules\AI\Domain\Insights\Segment;
use PHPUnit\Framework\TestCase;

/**
 * RFM quintiles, segmentation and loyalty suggestions on crafted customers.
 */
class RfmScorerTest extends TestCase
{
    public function test_quintile_scores_and_segments(): void
    {
        $customers = [
            ['id' => 'c01', 'recency_days' => 2, 'frequency' => 12, 'monetary' => '5000.00'],
            ['id' => 'c02', 'recency_days' => 5, 'frequency' => 10, 'monetary' => '4000.00'],
            ['id' => 'c03', 'recency_days' => 10, 'frequency' => 8, 'monetary' => '3000.00'],
            ['id' => 'c04', 'recency_days' => 20, 'frequency' => 6, 'monetary' => '2000.00'],
            ['id' => 'c05', 'recency_days' => 3, 'frequency' => 1, 'monetary' => '300.00'],
            ['id' => 'c06', 'recency_days' => 200, 'frequency' => 9, 'monetary' => '3500.00'],
            ['id' => 'c07', 'recency_days' => 300, 'frequency' => 1, 'monetary' => '100.00'],
            ['id' => 'c08', 'recency_days' => 250, 'frequency' => 2, 'monetary' => '150.00'],
            ['id' => 'c09', 'recency_days' => 40, 'frequency' => 2, 'monetary' => '600.00'],
            ['id' => 'c10', 'recency_days' => 15, 'frequency' => 3, 'monetary' => '800.00'],
        ];

        $scores = RfmScorer::score($customers);

        // R: most days first → ⌊k × 5 ÷ 10⌋ + 1.
        $this->assertSame(['r' => 5, 'f' => 5, 'm' => 5], array_intersect_key($scores['c01'], ['r' => 1, 'f' => 1, 'm' => 1]));
        $this->assertSame(1, $scores['c07']['r']);
        $this->assertSame(2, $scores['c06']['r']);
        $this->assertSame(3, $scores['c04']['r']);
        // Ties share the score of the first customer with that value: two customers with 1 purchase → F 1, two with 2 → F 2.
        $this->assertSame(1, $scores['c05']['f']);
        $this->assertSame(1, $scores['c07']['f']);
        $this->assertSame(2, $scores['c08']['f']);
        $this->assertSame(2, $scores['c09']['f']);
        $this->assertSame(3, $scores['c10']['f']);
        $this->assertSame(4, $scores['c06']['f']);
        $this->assertSame(4, $scores['c06']['m']);

        $segments = array_map(fn (array $s) => $s['segment'], $scores);
        $this->assertSame(Segment::Champions, $segments['c01']);
        $this->assertSame(Segment::Champions, $segments['c02']);
        $this->assertSame(Segment::Champions, $segments['c03']);
        $this->assertSame(Segment::Loyal, $segments['c04']);
        $this->assertSame(Segment::New, $segments['c05']);
        $this->assertSame(Segment::AtRisk, $segments['c06']);
        $this->assertSame(Segment::Hibernating, $segments['c07']);
        $this->assertSame(Segment::Hibernating, $segments['c08']);
        $this->assertSame(Segment::Hibernating, $segments['c09']);
        $this->assertSame(Segment::Loyal, $segments['c10']);
    }

    public function test_segment_rules_in_order(): void
    {
        $this->assertSame(Segment::New, RfmScorer::segment(4, 1, 1, 1));
        $this->assertSame(Segment::Potential, RfmScorer::segment(3, 1, 1, 1)); // one purchase, not recent enough to be new
        $this->assertSame(Segment::Champions, RfmScorer::segment(4, 4, 4, 9));
        $this->assertSame(Segment::Loyal, RfmScorer::segment(4, 4, 3, 9));
        $this->assertSame(Segment::Potential, RfmScorer::segment(5, 2, 5, 2));
        $this->assertSame(Segment::AtRisk, RfmScorer::segment(2, 5, 5, 12));
        $this->assertSame(Segment::Hibernating, RfmScorer::segment(1, 2, 1, 2));
        $this->assertSame([], RfmScorer::score([]));
        $this->assertSame(1, RfmScorer::score([['id' => 'x', 'recency_days' => 1, 'frequency' => 3, 'monetary' => '10']])['x']['r']);
    }

    public function test_loyalty_suggestions_by_rule(): void
    {
        $customers = [
            ['segment' => Segment::AtRisk, 'points' => 120],
            ['segment' => Segment::AtRisk, 'points' => 0],
            ['segment' => Segment::Hibernating, 'points' => 50],
            ['segment' => Segment::Champions, 'points' => 10],
            ['segment' => Segment::Champions, 'points' => 0],
            ['segment' => Segment::New, 'points' => 0],
            ['segment' => Segment::Potential, 'points' => 0],
            ['segment' => Segment::Loyal, 'points' => 30],
        ];

        $on = LoyaltySuggestions::suggest($customers, true, '0.50');
        $this->assertSame(['remind_points', 'win_back_points', 'reward_champions', 'second_purchase', 'enroll_potential', 'reactivate'], array_column($on, 'code'));
        $this->assertSame(['segment' => 'at_risk', 'code' => 'remind_points', 'customers' => 1, 'points' => 120, 'value' => '60.00',
            'message' => 'Remind 1 at-risk customer of their 120 unused loyalty points.'], $on[0]);
        $this->assertSame('25.00', $on[1]['value']);
        $this->assertSame(2, $on[2]['customers']);
        $this->assertSame(1, $on[5]['customers']); // at risk without points

        $off = LoyaltySuggestions::suggest($customers, false, '1.00');
        $this->assertSame(['reward_champions', 'second_purchase', 'reactivate'], array_column($off, 'code'));
        $this->assertSame(2, $off[2]['customers']); // every at-risk customer when there is no program
    }
}
