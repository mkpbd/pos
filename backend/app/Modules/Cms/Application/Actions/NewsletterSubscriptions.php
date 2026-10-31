<?php

namespace App\Modules\Cms\Application\Actions;

use App\Modules\Cms\Domain\SubscriberStatus;
use App\Modules\Cms\Infrastructure\Models\NewsletterSubscriber;
use App\Modules\Cms\Infrastructure\Notifications\ConfirmNewsletterSubscription;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;

/**
 * Newsletter sign-up with double opt-in. Responses never reveal whether an address is
 * already on the list; tokens travel only in the e-mail and are stored as hashes.
 */
class NewsletterSubscriptions
{
    /** A pending address gets at most one confirmation e-mail in this window. */
    public const RESEND_AFTER_MINUTES = 10;

    public const CONFIRM_WITHIN_DAYS = 7;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    /**
     * @param  string  $siteUrl  scheme and host of the storefront the visitor used, for the e-mailed links
     */
    public function subscribe(string $email, ?string $ip, string $siteUrl): void
    {
        $email = mb_strtolower(trim($email));

        $send = DB::transaction(function () use ($email, $ip) {
            $subscriber = NewsletterSubscriber::query()->whereRaw('lower(email) = ?', [$email])->lockForUpdate()->first()
                ?? new NewsletterSubscriber(['email' => $email]);

            if ($subscriber->exists && $subscriber->status === SubscriberStatus::Subscribed) {
                return null;
            }
            if ($subscriber->status === SubscriberStatus::Pending
                && $subscriber->confirmation_sent_at?->gt(now()->subMinutes(self::RESEND_AFTER_MINUTES))) {
                return null;
            }

            $confirm = Str::random(48);
            $unsubscribe = Str::random(48);
            $subscriber->fill([
                'status' => SubscriberStatus::Pending,
                'confirm_token_hash' => hash('sha256', $confirm),
                'unsubscribe_token_hash' => hash('sha256', $unsubscribe),
                'confirmation_sent_at' => now(),
                'unsubscribed_at' => null,
                'ip' => $ip,
            ])->save();

            return [$confirm, $unsubscribe];
        });

        if ($send === null) {
            return;
        }

        [$confirm, $unsubscribe] = $send;
        $site = rtrim($siteUrl, '/');
        $name = $this->organizations->summary($this->tenant->requireOrganization())['name'] ?? $site;

        Notification::route('mail', $email)->notify(new ConfirmNewsletterSubscription(
            $name,
            "{$site}/newsletter/confirm?token={$confirm}",
            "{$site}/newsletter/unsubscribe?token={$unsubscribe}",
        ));
    }

    public function confirm(string $token): void
    {
        DB::transaction(function () use ($token) {
            $subscriber = NewsletterSubscriber::query()
                ->where('confirm_token_hash', hash('sha256', $token))
                ->lockForUpdate()
                ->first();

            if ($subscriber === null || $subscriber->status !== SubscriberStatus::Pending
                || $subscriber->confirmation_sent_at?->lt(now()->subDays(self::CONFIRM_WITHIN_DAYS))) {
                throw new BusinessRuleViolation('TOKEN_INVALID', 'This confirmation link is invalid or has expired. Please sign up again.');
            }

            $subscriber->update([
                'status' => SubscriberStatus::Subscribed,
                'confirmed_at' => now(),
                'confirm_token_hash' => null,
            ]);
        });
    }

    /**
     * Idempotent: following the link again after unsubscribing succeeds as well.
     */
    public function unsubscribe(string $token): void
    {
        DB::transaction(function () use ($token) {
            $subscriber = NewsletterSubscriber::query()
                ->where('unsubscribe_token_hash', hash('sha256', $token))
                ->lockForUpdate()
                ->first();

            if ($subscriber === null) {
                throw new BusinessRuleViolation('TOKEN_INVALID', 'This unsubscribe link is invalid.');
            }
            if ($subscriber->status !== SubscriberStatus::Unsubscribed) {
                $subscriber->update([
                    'status' => SubscriberStatus::Unsubscribed,
                    'unsubscribed_at' => now(),
                    'confirm_token_hash' => null,
                ]);
            }
        });
    }
}
