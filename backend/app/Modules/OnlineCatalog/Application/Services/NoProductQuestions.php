<?php

namespace App\Modules\OnlineCatalog\Application\Services;

use App\Modules\OnlineCatalog\Application\Contracts\ProductQuestionCounts;

/**
 * P1b: without the Reviews module, products have no published questions.
 */
final class NoProductQuestions implements ProductQuestionCounts
{
    public function publishedCount(string $productId): int
    {
        return 0;
    }
}
