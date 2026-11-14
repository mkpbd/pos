<?php

namespace App\Modules\Reviews\Infrastructure\Notifications;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Reviews\Application\Events\ProductQuestionAnswered;
use App\Modules\Reviews\Application\Events\ProductQuestionAsked;
use App\Modules\Reviews\Domain\QuestionStatus;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Throwable;

/**
 * P1b (queued, after commit):
 * - a new question → an inbox notification "New product question" to every active staff user
 *   with `reviews.moderate`, linking to the pending questions;
 * - an answer published for the first time → one e-mail to the asker in the language they asked
 *   in, linking to the product page while it is live. A mail failure is logged and never undoes
 *   the answer.
 */
class SendProductQuestionNotifications implements ShouldQueue
{
    public const LINK = '/reviews/questions?status=pending';

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
        private readonly LocaleContext $locale,
    ) {}

    public function asked(ProductQuestionAsked $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var ProductQuestion|null $question */
            $question = ProductQuestion::query()->find($event->questionId);
            if ($question === null) {
                return;
            }
            $recipients = $this->users->withPermission($event->organizationId, 'reviews.moderate');
            if ($recipients->isEmpty()) {
                return;
            }
            $product = app(StorefrontCatalog::class)->productSummaries([$question->product_id])[$question->product_id]['name'] ?? 'a product';

            Notification::send($recipients, new ProductQuestionNotification([
                'title' => 'New product question',
                'message' => "{$question->name} asked about {$product}: ".Str::limit($question->question, 120),
                'question_id' => $question->id,
                'product_id' => $question->product_id,
                'url' => self::LINK,
                'link' => self::LINK,
            ]));
        });
    }

    public function answered(ProductQuestionAnswered $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var ProductQuestion|null $question */
            $question = ProductQuestion::query()->find($event->questionId);
            if ($question === null || $question->status !== QuestionStatus::Published || $question->answer === null) {
                return;
            }
            $language = in_array($question->locale, LocaleContext::SUPPORTED, true) ? $question->locale : LocaleContext::BASE;

            try {
                $product = $this->locale->runAs($language, fn () => app(StorefrontCatalog::class)->productSummaries([$question->product_id])[$question->product_id] ?? null);
                Notification::route('mail', $question->email)->notify(new ProductQuestionAnsweredEmail(
                    (string) (app(StorefrontConfig::class)->settings()->site_name ?? ''),
                    (string) ($product['name'] ?? ''),
                    $question->question,
                    $question->answer,
                    ($product['slug'] ?? null) === null ? null : rtrim($question->site_url, '/').'/product/'.$product['slug'],
                    $language,
                ));
            } catch (Throwable $e) {
                Log::warning('Product question answer e-mail failed', ['question_id' => $question->id, 'error' => $e->getMessage()]);
            }
        });
    }
}
