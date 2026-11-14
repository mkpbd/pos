<?php

namespace App\Modules\Reviews\Domain;

/**
 * P1b: a shopper's question — pending (new, or answered but not published yet) → published
 * (answered, shown on the product page) | rejected (hidden). Publishing needs an answer.
 */
enum QuestionStatus: string
{
    case Pending = 'pending';
    case Published = 'published';
    case Rejected = 'rejected';

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Pending',
            self::Published => 'Published',
            self::Rejected => 'Rejected',
        };
    }
}
