<?php

namespace App\Modules\Cms\Application\Actions;

use App\Modules\Cms\Domain\CampaignStatus;
use App\Modules\Cms\Domain\SubscriberStatus;
use App\Modules\Cms\Infrastructure\Jobs\SendNewsletterCampaignJob;
use App\Modules\Cms\Infrastructure\Models\NewsletterCampaign;
use App\Modules\Cms\Infrastructure\Models\NewsletterSubscriber;
use App\Modules\Cms\Infrastructure\Notifications\NewsletterCampaignMail;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;

/**
 * BD2b: newsletter campaigns. Drafts are edited and deleted freely; sending flips the draft to
 * `sending` under a row lock (so it happens once) and a job mails every confirmed subscriber
 * in chunks, then marks it `sent`. Pending and unsubscribed addresses never get a campaign.
 */
class NewsletterCampaigns
{
    /** Subscribers loaded (and mails queued) per round; tests lower it. */
    public static int $chunkSize = 200;

    public function __construct(
        private readonly AuditTrail $audit,
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly StorefrontConfig $storefront,
        private readonly NewsletterSubscriptions $subscriptions,
    ) {}

    /**
     * @param  array{subject?: string, body?: string}  $attributes  validated
     */
    public function save(NewsletterCampaign $campaign, array $attributes, string $actorId): NewsletterCampaign
    {
        return DB::transaction(function () use ($campaign, $attributes, $actorId) {
            if (! $campaign->exists) {
                $campaign->fill([...$attributes, 'created_by' => $actorId])->save();
                $this->audit->record('newsletter_campaign.created', $campaign, [], ['subject' => $campaign->subject]);

                return $campaign;
            }

            $campaign = $this->lockedDraft($campaign);
            $before = $campaign->only(['subject', 'body']);
            $campaign->fill($attributes)->save();
            [$old, $new] = Changes::between($before, $campaign->only(['subject', 'body']));
            if ($new !== []) {
                $this->audit->record('newsletter_campaign.updated', $campaign, $old, $new);
            }

            return $campaign;
        });
    }

    public function delete(NewsletterCampaign $campaign): void
    {
        DB::transaction(function () use ($campaign) {
            $campaign = $this->lockedDraft($campaign);
            $campaign->delete();
            $this->audit->record('newsletter_campaign.deleted', $campaign, ['subject' => $campaign->subject]);
        });
    }

    /**
     * One copy, marked "[Test]", to $email (not necessarily a subscriber).
     */
    public function sendTest(NewsletterCampaign $campaign, string $email): void
    {
        Notification::route('mail', $email)->notify(new NewsletterCampaignMail(
            $this->storeName(), $campaign->subject, $campaign->body, null, test: true,
        ));
        $this->audit->record('newsletter_campaign.test_sent', $campaign, [], ['to' => self::mask($email)]);
    }

    /**
     * Starts sending a draft to the confirmed subscribers (`CAMPAIGN_NOT_DRAFT` when it already
     * started, `NO_SUBSCRIBERS` when nobody would get it).
     */
    public function send(NewsletterCampaign $campaign, string $actorId): NewsletterCampaign
    {
        $id = DB::transaction(function () use ($campaign, $actorId) {
            $campaign = $this->lockedDraft($campaign);
            $recipients = NewsletterSubscriber::query()->where('status', SubscriberStatus::Subscribed)->count();
            if ($recipients === 0) {
                throw new BusinessRuleViolation('NO_SUBSCRIBERS', 'There are no confirmed subscribers to send this campaign to.');
            }

            $campaign->update(['status' => CampaignStatus::Sending, 'recipients_count' => $recipients, 'sent_by' => $actorId]);
            $this->audit->record('newsletter_campaign.sent', $campaign, ['status' => CampaignStatus::Draft->value], ['status' => CampaignStatus::Sending->value, 'recipients_count' => $recipients]);
            SendNewsletterCampaignJob::dispatch($campaign->id, $campaign->organization_id)->afterCommit();

            return $campaign->id;
        });

        return NewsletterCampaign::query()->findOrFail($id);
    }

    /**
     * The job's work: queue one mail per confirmed subscriber, chunk by chunk, then mark the
     * campaign sent. Does nothing unless the campaign is `sending`.
     */
    public function deliver(string $campaignId): void
    {
        $campaign = NewsletterCampaign::query()->find($campaignId);
        if ($campaign === null || $campaign->status !== CampaignStatus::Sending) {
            return;
        }

        $site = rtrim($this->storefront->primaryUrl() ?? (string) config('app.url'), '/');
        $store = $this->storeName();
        $sent = 0;

        NewsletterSubscriber::query()->where('status', SubscriberStatus::Subscribed)->select(['id', 'email'])
            ->chunkById(self::$chunkSize, function (Collection $subscribers) use ($campaign, $site, $store, &$sent) {
                foreach ($subscribers as $subscriber) {
                    Notification::route('mail', $subscriber->email)->notify(new NewsletterCampaignMail(
                        $store, $campaign->subject, $campaign->body, $this->subscriptions->signedUnsubscribeUrl($site, $subscriber->id),
                    ));
                }
                $sent += $subscribers->count();
                NewsletterCampaign::query()->whereKey($campaign->id)->update(['sent_count' => $sent]);
            });

        $campaign->update(['status' => CampaignStatus::Sent, 'sent_count' => $sent, 'sent_at' => now()]);
    }

    /**
     * @return array{confirmed: int, pending: int, unsubscribed: int}
     */
    public function subscriberSummary(): array
    {
        $counts = NewsletterSubscriber::query()->toBase()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        return [
            'confirmed' => (int) ($counts[SubscriberStatus::Subscribed->value] ?? 0),
            'pending' => (int) ($counts[SubscriberStatus::Pending->value] ?? 0),
            'unsubscribed' => (int) ($counts[SubscriberStatus::Unsubscribed->value] ?? 0),
        ];
    }

    private function lockedDraft(NewsletterCampaign $campaign): NewsletterCampaign
    {
        $locked = NewsletterCampaign::query()->whereKey($campaign->id)->lockForUpdate()->firstOrFail();
        if ($locked->status !== CampaignStatus::Draft) {
            throw new BusinessRuleViolation('CAMPAIGN_NOT_DRAFT', 'This campaign was already sent; only drafts can be changed, deleted or sent.');
        }

        return $locked;
    }

    private function storeName(): string
    {
        return $this->organizations->summary($this->tenant->requireOrganization())['name'] ?? (string) config('app.name');
    }

    /** r***@example.com — audit entries never hold a full address. */
    private static function mask(string $email): string
    {
        $at = (int) strrpos($email, '@');

        return Str::mask($email, '*', 1, max(0, $at - 1));
    }
}
