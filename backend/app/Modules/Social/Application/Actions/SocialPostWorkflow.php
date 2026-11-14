<?php

namespace App\Modules\Social\Application\Actions;

use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Social\Application\Services\PublishReadiness;
use App\Modules\Social\Domain\PostStatus;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Domain\TargetStatus;
use App\Modules\Social\Infrastructure\Jobs\PublishSocialPostJob;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use App\Modules\Social\Infrastructure\Models\SocialPostResult;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P2b: the post workflow, each step with the post row locked.
 *
 * - publish (draft | scheduled → publishing) and retry (failed | partially_published: only the
 *   failed targets go again) check PublishReadiness, set the targets to `pending`, give each
 *   target its short link (P2a: utm_source = facebook | instagram, utm_medium = social,
 *   utm_campaign = the campaign's or "social") and queue PublishSocialPostJob after commit.
 * - cancel (scheduled → draft); delete (draft | scheduled | failed).
 * - publishDue: the scheduler's claim of a due scheduled post (FOR UPDATE SKIP LOCKED on
 *   PostgreSQL), so parallel runs publish it once; a post that cannot go out fails with the reason.
 * - recoverStale: targets claimed by a worker that died are failed as PUBLISH_INTERRUPTED (never
 *   posted again automatically), posts left `publishing` with unclaimed targets are queued again.
 *
 * Publishing, retrying and deleting are audited.
 */
class SocialPostWorkflow
{
    /** A target claimed this long ago is considered interrupted. */
    public const STALE_MINUTES = 15;

    public function __construct(
        private readonly PublishReadiness $readiness,
        private readonly MarketingLinks $marketing,
        private readonly AuditTrail $audit,
    ) {}

    public function publish(SocialPost $post): SocialPost
    {
        DB::transaction(function () use ($post) {
            $locked = $this->lock($post->id);
            if (! $locked->status->publishable()) {
                throw $this->invalid($locked, 'published now');
            }
            $targets = $locked->targetList();
            $from = $locked->status->value;
            $this->readiness->check($locked, $targets);
            $this->start($locked, $targets);
            $this->audit->record('social.post_publish_requested', $locked, ['status' => $from], ['status' => PostStatus::Publishing->value], [
                'targets' => array_map(fn (PostTarget $t) => $t->value, $targets),
            ]);
        });

        return $this->fresh($post);
    }

    public function retry(SocialPost $post): SocialPost
    {
        DB::transaction(function () use ($post) {
            $locked = $this->lock($post->id);
            if (! $locked->status->retryable()) {
                throw $this->invalid($locked, 'retried');
            }
            $failed = array_values(array_map(
                fn (SocialPostResult $r) => $r->target,
                $locked->results->filter(fn (SocialPostResult $r) => $r->status === TargetStatus::Failed)->all(),
            ));
            $this->readiness->check($locked, $failed);
            $this->start($locked, $failed);
            $this->audit->record('social.post_retry_requested', $locked, [], [], [
                'targets' => array_map(fn (PostTarget $t) => $t->value, $failed),
            ]);
        });

        return $this->fresh($post);
    }

    public function cancel(SocialPost $post): SocialPost
    {
        DB::transaction(function () use ($post) {
            $locked = $this->lock($post->id);
            if (! $locked->status->cancellable()) {
                throw $this->invalid($locked, 'cancelled');
            }
            $locked->status = PostStatus::Draft;
            $locked->scheduled_at = null;
            $locked->save();
        });

        return $this->fresh($post);
    }

    public function delete(SocialPost $post): void
    {
        DB::transaction(function () use ($post) {
            $locked = $this->lock($post->id);
            if (! $locked->status->deletable()) {
                throw $this->invalid($locked, 'deleted');
            }
            $this->audit->record('social.post_deleted', $locked, [
                'status' => $locked->status->value,
                'targets' => $locked->targets,
                'caption' => mb_substr($locked->caption, 0, 200),
            ], []);
            $locked->delete();
        });
    }

    /**
     * The scheduler's claim of a due scheduled post (in its tenant): true when it was queued or
     * failed here, false when another run took it or it is no longer due.
     */
    public function publishDue(string $postId): bool
    {
        return DB::transaction(function () use ($postId) {
            $query = SocialPost::query()->with('results')->whereKey($postId)
                ->where('status', PostStatus::Scheduled->value)
                ->where('scheduled_at', '<=', now());
            /** @var SocialPost|null $post */
            $post = (DB::getDriverName() === 'pgsql' ? $query->lock('for update skip locked') : $query->lockForUpdate())->first();
            if ($post === null) {
                return false;
            }
            $targets = $post->targetList();
            try {
                $this->readiness->check($post, $targets);
            } catch (BusinessRuleViolation|ValidationException $e) {
                $code = $e instanceof BusinessRuleViolation ? $e->errorCode : 'MEDIA_MISSING';
                $message = $e instanceof BusinessRuleViolation ? $e->getMessage() : 'A photo of this post was deleted. Choose the photos again and retry.';
                $this->failAll($post, $code === 'SOCIAL_NOT_CONNECTED' ? 'NOT_CONNECTED' : $code, $message);

                return true;
            }
            $this->start($post, $targets);

            return true;
        });
    }

    /**
     * Interrupted targets fail; publishing posts with unclaimed targets are queued again.
     *
     * @return int the posts touched
     */
    public function recoverStale(string $postId): int
    {
        return DB::transaction(function () use ($postId) {
            $post = SocialPost::query()->with('results')->whereKey($postId)->where('status', PostStatus::Publishing->value)->lockForUpdate()->first();
            if ($post === null) {
                return 0;
            }
            $cutoff = CarbonImmutable::now()->subMinutes(self::STALE_MINUTES);
            $requeue = false;
            foreach ($post->results as $result) {
                if ($result->status === TargetStatus::Publishing && $result->claimed_at !== null && $result->claimed_at->lt($cutoff)) {
                    SocialPostResult::query()->whereKey($result->id)->where('status', TargetStatus::Publishing->value)->update([
                        'status' => TargetStatus::Failed->value,
                        'error_code' => 'PUBLISH_INTERRUPTED',
                        'error_message' => 'Publishing was interrupted. Check your Page before retrying, the post may already be there.',
                        'updated_at' => now(),
                    ]);
                }
                if ($result->status === TargetStatus::Pending && ($post->publishing_started_at === null || $post->publishing_started_at->lt($cutoff))) {
                    $requeue = true;
                }
            }
            if ($requeue) {
                $this->queue($post);
            } else {
                self::finish($post->id);
            }

            return 1;
        });
    }

    /**
     * The post's status from its targets once none is waiting (published_at = the last target's).
     */
    public static function finish(string $postId): void
    {
        $results = SocialPostResult::query()->where('post_id', $postId)->get(['status', 'published_at']);
        $status = PostStatus::fromTargets(array_values($results->map(fn (SocialPostResult $r) => $r->status)->all()));
        if ($status === PostStatus::Publishing) {
            return;
        }
        $publishedAt = $results->map(fn (SocialPostResult $r) => $r->published_at)->filter()->max();
        SocialPost::query()->whereKey($postId)->where('status', PostStatus::Publishing->value)->update([
            'status' => $status->value,
            'published_at' => $publishedAt,
            'updated_at' => now(),
        ]);
    }

    /**
     * Targets to `pending` with a short link each, the post to `publishing`, the job queued.
     *
     * @param  list<PostTarget>  $targets
     */
    private function start(SocialPost $post, array $targets): void
    {
        $post->status = PostStatus::Publishing;
        $post->publishing_started_at = CarbonImmutable::now();
        $post->save();

        $campaign = $post->campaign_id === null ? null : ($this->marketing->campaigns([$post->campaign_id])[$post->campaign_id] ?? null);
        foreach ($post->results as $result) {
            if (! in_array($result->target, $targets, true)) {
                continue;
            }
            if ($result->short_link_id === null && $post->link_path !== null && $this->marketing->isStorePath($post->link_path)) {
                $result->short_link_id = $this->marketing->createShortLink($post->link_path, [
                    'source' => $result->target->value,
                    'medium' => 'social',
                    'campaign' => $campaign['utm_campaign'] ?? 'social',
                ], $campaign['id'] ?? null)['id'];
            }
            $result->fill(['status' => TargetStatus::Pending, 'error_code' => null, 'error_message' => null, 'claimed_at' => null]);
            $result->save();
        }
        $this->queue($post);
    }

    private function queue(SocialPost $post): void
    {
        PublishSocialPostJob::dispatch($post->id, $post->organization_id)->afterCommit();
    }

    /**
     * Every target failed with the same reason (a due post that cannot go out).
     */
    private function failAll(SocialPost $post, string $code, string $message): void
    {
        SocialPostResult::query()->where('post_id', $post->id)->update([
            'status' => TargetStatus::Failed->value,
            'error_code' => mb_substr($code, 0, 50),
            'error_message' => mb_substr($message, 0, 500),
            'updated_at' => now(),
        ]);
        $post->status = PostStatus::Failed;
        $post->save();
    }

    private function lock(string $id): SocialPost
    {
        /** @var SocialPost */
        return SocialPost::query()->with('results')->whereKey($id)->lockForUpdate()->firstOrFail();
    }

    private function fresh(SocialPost $post): SocialPost
    {
        return SocialPost::query()->with('results')->findOrFail($post->id);
    }

    private function invalid(SocialPost $post, string $what): BusinessRuleViolation
    {
        return new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "A {$post->status->value} post cannot be {$what}.", ['status' => $post->status->value]);
    }
}
