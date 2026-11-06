<?php

namespace App\Modules\AI\Domain\Insights;

/**
 * Customer segments from RFM scores (1–5 each; see RfmScorer for the rules and their order).
 */
enum Segment: string
{
    case Champions = 'champions';
    case Loyal = 'loyal';
    case Potential = 'potential';
    case New = 'new';
    case AtRisk = 'at_risk';
    case Hibernating = 'hibernating';

    public function label(): string
    {
        return match ($this) {
            self::Champions => 'Champions',
            self::Loyal => 'Loyal',
            self::Potential => 'Potential',
            self::New => 'New',
            self::AtRisk => 'At risk',
            self::Hibernating => 'Hibernating',
        };
    }

    public function description(): string
    {
        return match ($this) {
            self::Champions => 'Bought recently, buy often and spend the most.',
            self::Loyal => 'Buy regularly and recently.',
            self::Potential => 'Recent customers with few purchases so far.',
            self::New => 'Made their first purchase recently.',
            self::AtRisk => 'Used to buy often but have not come back for a while.',
            self::Hibernating => 'Bought rarely and long ago.',
        };
    }
}
