<?php

namespace App\Modules\AI\Domain\Llm;

/**
 * A provider-specific content block (e.g. a Claude thinking block) that the application does not
 * interpret but must send back unchanged in the next request of the same conversation.
 */
final readonly class ProviderBlock
{
    /**
     * @param  array<string, mixed>  $raw
     */
    public function __construct(
        public string $provider,
        public array $raw,
    ) {}
}
