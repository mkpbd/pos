<?php

namespace App\Modules\Cart\Domain;

/**
 * Whose cart a request works on: a signed-in customer's, or a guest's identified by the
 * token of their cart cookie (null until the first item is added).
 */
final class CartOwner
{
    private function __construct(
        public readonly ?string $customerId,
        public readonly ?string $guestToken,
    ) {}

    public static function customer(string $customerId): self
    {
        return new self($customerId, null);
    }

    public static function guest(?string $token): self
    {
        return new self(null, $token);
    }

    public function isGuest(): bool
    {
        return $this->customerId === null;
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * 40 random bytes, base64url without padding.
     */
    public static function newToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(40)), '+/', '-_'), '=');
    }
}
