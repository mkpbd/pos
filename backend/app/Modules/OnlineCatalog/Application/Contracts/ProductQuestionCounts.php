<?php

namespace App\Modules\OnlineCatalog\Application\Contracts;

/**
 * P1b: how many shopper questions of a product are answered and published (the product page's
 * "Questions (n)" tab). Declared here and implemented by the Reviews module, like
 * ProductRatings; the default answers 0.
 */
interface ProductQuestionCounts
{
    public function publishedCount(string $productId): int;
}
