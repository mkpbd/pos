<?php

namespace App\Modules\Social\Domain\Meta;

/**
 * P2b: what a network answered for a published post: its id and public address (when known).
 */
final readonly class PublishedPost
{
    public function __construct(
        public string $remoteId,
        public ?string $permalink,
    ) {}
}
