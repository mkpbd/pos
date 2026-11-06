<?php

namespace App\Modules\AI\Domain\Insights;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Loyalty actions per segment, computed by rules (pure; the model may only explain them):
 *
 *   remind_points    At risk customers holding points (program on): remind them of their points
 *   win_back_points  Hibernating customers holding points (program on): a win-back message
 *   reward_champions Champions: thank / reward them (bonus points, early access)
 *   second_purchase  New customers: encourage a second purchase
 *   enroll_potential Potential customers without points (program on): invite them to collect points
 *   reactivate       At risk customers without points: a personal offer to come back
 *
 * Suggestions with nobody in them are left out. `value` = points × point value.
 */
final class LoyaltySuggestions
{
    /**
     * @param  list<array{segment: Segment, points: int}>  $customers
     * @return list<array{segment: string, code: string, customers: int, points: ?int, value: ?string, message: string}>
     */
    public static function suggest(array $customers, bool $programEnabled, string $pointValue): array
    {
        $groups = [];
        foreach ($customers as $c) {
            $withPoints = $c['points'] > 0 ? 'with' : 'without';
            $groups[$c['segment']->value][$withPoints]['count'] = ($groups[$c['segment']->value][$withPoints]['count'] ?? 0) + 1;
            $groups[$c['segment']->value][$withPoints]['points'] = ($groups[$c['segment']->value][$withPoints]['points'] ?? 0) + max(0, $c['points']);
        }
        $count = fn (Segment $s, string $which) => (int) ($groups[$s->value][$which]['count'] ?? 0);
        $points = fn (Segment $s, string $which) => (int) ($groups[$s->value][$which]['points'] ?? 0);
        $all = fn (Segment $s) => $count($s, 'with') + $count($s, 'without');
        $value = fn (int $p) => Decimal::mul((string) $p, $pointValue, 2);

        $suggestions = [];
        $add = function (Segment $segment, string $code, int $customers, ?int $pts, string $message) use (&$suggestions, $value) {
            if ($customers > 0) {
                $suggestions[] = [
                    'segment' => $segment->value,
                    'code' => $code,
                    'customers' => $customers,
                    'points' => $pts,
                    'value' => $pts === null ? null : $value($pts),
                    'message' => $message,
                ];
            }
        };

        if ($programEnabled) {
            $n = $count(Segment::AtRisk, 'with');
            $p = $points(Segment::AtRisk, 'with');
            $add(Segment::AtRisk, 'remind_points', $n, $p, "Remind {$n} at-risk ".self::customers($n)." of their {$p} unused loyalty points.");
            $n = $count(Segment::Hibernating, 'with');
            $p = $points(Segment::Hibernating, 'with');
            $add(Segment::Hibernating, 'win_back_points', $n, $p, "Send a win-back message to {$n} hibernating ".self::customers($n)." holding {$p} points.");
        }
        $n = $all(Segment::Champions);
        $add(Segment::Champions, 'reward_champions', $n, null, "Reward {$n} ".self::customers($n, 'champion').' with bonus points or early access to offers.');
        $n = $all(Segment::New);
        $add(Segment::New, 'second_purchase', $n, null, "Encourage a second purchase from {$n} new ".self::customers($n).'.');
        if ($programEnabled) {
            $n = $count(Segment::Potential, 'without');
            $add(Segment::Potential, 'enroll_potential', $n, null, "Invite {$n} potential ".self::customers($n).' to start collecting loyalty points.');
        }
        $n = $programEnabled ? $count(Segment::AtRisk, 'without') : $all(Segment::AtRisk);
        $add(Segment::AtRisk, 'reactivate', $n, null, "Offer {$n} at-risk ".self::customers($n).' a personal reason to come back.');

        return $suggestions;
    }

    private static function customers(int $n, string $noun = 'customer'): string
    {
        return $n === 1 ? $noun : $noun.'s';
    }
}
