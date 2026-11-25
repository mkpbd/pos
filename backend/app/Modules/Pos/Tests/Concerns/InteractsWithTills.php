<?php

namespace App\Modules\Pos\Tests\Concerns;

use App\Modules\Authentication\Application\Actions\ManagePin;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Pos\Application\Actions\SetUpTerminal;
use App\Modules\Pos\Application\Services\TerminalCookie;
use App\Modules\Users\Infrastructure\Models\User;

/**
 * POS1a: till PINs and till devices for tests.
 */
trait InteractsWithTills
{
    protected function setPin(User $user, string $pin = '2580'): User
    {
        app(ManagePin::class)->set($user, $pin);

        return $user->fresh();
    }

    /**
     * Sets up a till of the store (as the given manager) and returns the device's cookie token.
     */
    protected function tillToken(Organization $organization, User $actor, string $storeId, string $name = 'Till 1'): string
    {
        return $this->inTenant($organization, fn () => app(SetUpTerminal::class)($actor->fresh(), $storeId, $name, null)['token']);
    }

    /** Requests from the SPA on the device holding this till cookie (JSON requests send cookies only withCredentials). */
    protected function onTill(string $token): static
    {
        return $this->withHeaders($this->spaHeaders())->withCredentials()->withCookie(TerminalCookie::NAME, $token);
    }

    /** Requests from the SPA on a device without a till cookie. */
    protected function withoutTill(): static
    {
        unset($this->defaultCookies[TerminalCookie::NAME]);

        return $this->withHeaders($this->spaHeaders());
    }
}
