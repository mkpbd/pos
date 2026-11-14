<?php

namespace App\Modules\Reviews\Infrastructure;

use App\Modules\OnlineCatalog\Application\Contracts\ProductQuestionCounts;
use App\Modules\Reviews\Domain\QuestionStatus;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;

/**
 * P1b: published questions of a product (the product page's "Questions (n)"). Kept free of
 * other dependencies: the product page that asks is built by the catalog read side.
 */
final class EloquentProductQuestionCounts implements ProductQuestionCounts
{
    public function publishedCount(string $productId): int
    {
        return ProductQuestion::query()->where('product_id', $productId)->where('status', QuestionStatus::Published->value)->count();
    }
}
