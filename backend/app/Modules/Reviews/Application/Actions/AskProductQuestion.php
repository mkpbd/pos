<?php

namespace App\Modules\Reviews\Application\Actions;

use App\Modules\Reviews\Application\Events\ProductQuestionAsked;
use App\Modules\Reviews\Domain\QuestionStatus;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use Illuminate\Support\Facades\DB;

/**
 * P1b: a shopper (guest or signed in) asks a question about a live product. It waits for staff
 * (pending) and appears on the product page only once answered and published. A filled honeypot
 * stores nothing (the answer is the same, so bots learn nothing). After commit, staff who
 * moderate reviews are notified.
 */
class AskProductQuestion
{
    /**
     * @param  array{name: string, email: string, question: string, website?: ?string}  $data  validated
     */
    public function __invoke(string $productId, array $data, ?string $customerAccountId, string $locale, string $siteUrl): ?ProductQuestion
    {
        // Honeypot: bots fill every field; answer as usual, keep nothing.
        if (filled($data['website'] ?? null)) {
            return null;
        }

        return DB::transaction(function () use ($productId, $data, $customerAccountId, $locale, $siteUrl) {
            $question = ProductQuestion::query()->create([
                'product_id' => $productId,
                'customer_account_id' => $customerAccountId,
                'name' => trim($data['name']),
                'email' => mb_strtolower(trim($data['email'])),
                'question' => trim($data['question']),
                'status' => QuestionStatus::Pending,
                'locale' => $locale,
                'site_url' => mb_substr(rtrim($siteUrl, '/'), 0, 255),
            ]);
            event(new ProductQuestionAsked($question->organization_id, $question->id));

            return $question;
        });
    }
}
