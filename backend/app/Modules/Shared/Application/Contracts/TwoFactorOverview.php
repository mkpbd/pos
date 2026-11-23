<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * G1a: how far an organization's staff have adopted two-factor sign-in, for the organization's
 * security settings. Implemented by the Authentication module.
 */
interface TwoFactorOverview
{
    /**
     * Active staff users, how many have two-factor sign-in on, and how many the organization's
     * policy requires it from who have not set it up yet.
     *
     * @return array{users: int, enabled: int, required_missing: int}
     */
    public function summary(string $organizationId): array;
}
