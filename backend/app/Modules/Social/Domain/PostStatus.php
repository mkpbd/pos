<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: a social post's life — draft → scheduled (a time is set) → publishing → published,
 * partially_published (some targets failed) or failed. Retrying a (partially) failed post
 * publishes its failed targets again; published targets are never posted twice.
 */
enum PostStatus: string
{
    case Draft = 'draft';
    case Scheduled = 'scheduled';
    case Publishing = 'publishing';
    case Published = 'published';
    case PartiallyPublished = 'partially_published';
    case Failed = 'failed';

    public const ACTIONS = ['edit', 'publish', 'cancel', 'retry', 'delete'];

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(fn (self $s) => $s->value, self::cases());
    }

    /** Caption, targets, photos, link and time may change (nothing is published yet). */
    public function editable(): bool
    {
        return in_array($this, [self::Draft, self::Scheduled, self::Failed], true);
    }

    public function publishable(): bool
    {
        return in_array($this, [self::Draft, self::Scheduled], true);
    }

    public function cancellable(): bool
    {
        return $this === self::Scheduled;
    }

    public function retryable(): bool
    {
        return in_array($this, [self::Failed, self::PartiallyPublished], true);
    }

    /** Nothing of it is live on a network (and nothing is being posted). */
    public function deletable(): bool
    {
        return in_array($this, [self::Draft, self::Scheduled, self::Failed], true);
    }

    /**
     * What the admin may do now (the server re-checks).
     *
     * @return list<string>
     */
    public function allowedActions(): array
    {
        return array_values(array_filter([
            $this->editable() ? 'edit' : null,
            $this->publishable() ? 'publish' : null,
            $this->cancellable() ? 'cancel' : null,
            $this->retryable() ? 'retry' : null,
            $this->deletable() ? 'delete' : null,
        ]));
    }

    /**
     * The status of a publishing post from its targets: still running while any target waits or is
     * being published; else published, failed or partially published.
     *
     * @param  list<TargetStatus>  $targets
     */
    public static function fromTargets(array $targets): self
    {
        if ($targets === []) {
            return self::Failed;
        }
        $published = 0;
        foreach ($targets as $target) {
            if ($target === TargetStatus::Pending || $target === TargetStatus::Publishing) {
                return self::Publishing;
            }
            $published += $target === TargetStatus::Published ? 1 : 0;
        }

        return match ($published) {
            count($targets) => self::Published,
            0 => self::Failed,
            default => self::PartiallyPublished,
        };
    }
}
