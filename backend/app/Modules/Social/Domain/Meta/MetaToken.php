<?php

namespace App\Modules\Social\Domain\Meta;

use DateTimeImmutable;

/**
 * P2b: an access token from Facebook Login and when it expires (null: no expiry given).
 */
final readonly class MetaToken
{
    public function __construct(
        #[\SensitiveParameter] public string $value,
        public ?DateTimeImmutable $expiresAt = null,
    ) {}

    public function __debugInfo(): array
    {
        return ['value' => '[redacted]', 'expiresAt' => $this->expiresAt];
    }
}
