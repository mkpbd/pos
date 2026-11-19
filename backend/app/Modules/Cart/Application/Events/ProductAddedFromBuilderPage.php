<?php

namespace App\Modules\Cart\Application\Events;

/**
 * B13: a shopper added a product to the cart from a store builder page that shows A/B test
 * versions (`attribution.builder` with `experiments`) — Marketing counts the add-to-cart per
 * version. Dispatched after the cart change is committed; nothing personal.
 */
final readonly class ProductAddedFromBuilderPage
{
    /**
     * @param  array<string, string>  $experiments  test id => A | B
     */
    public function __construct(
        public string $organizationId,
        public string $documentId,
        public ?string $device,
        public array $experiments,
    ) {}
}
