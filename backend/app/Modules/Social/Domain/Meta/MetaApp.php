<?php

namespace App\Modules\Social\Domain\Meta;

/**
 * P2b: the store's Meta app (Facebook developer app): id, secret and Graph API version. The
 * secret only lives in memory while a call needs it; it is never logged or returned.
 */
final readonly class MetaApp
{
    public function __construct(
        public string $id,
        #[\SensitiveParameter] public string $secret,
        public string $graphVersion = 'v21.0',
    ) {}

    public function __debugInfo(): array
    {
        return ['id' => $this->id, 'secret' => '[redacted]', 'graphVersion' => $this->graphVersion];
    }
}
