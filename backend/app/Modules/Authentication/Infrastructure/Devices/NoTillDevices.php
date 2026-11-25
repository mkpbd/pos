<?php

namespace App\Modules\Authentication\Infrastructure\Devices;

use App\Modules\Authentication\Application\Contracts\TillDevices;
use Illuminate\Http\Request;

/**
 * Default when no module provides tills: no device is a till, so PIN sign-in is unavailable.
 */
final class NoTillDevices implements TillDevices
{
    public function fromRequest(Request $request): ?array
    {
        return null;
    }

    public function deviceKey(Request $request): ?string
    {
        return null;
    }
}
