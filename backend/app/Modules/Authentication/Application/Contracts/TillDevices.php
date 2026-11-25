<?php

namespace App\Modules\Authentication\Application\Contracts;

use Illuminate\Http\Request;

/**
 * POS1a: the till (set-up device) a request comes from, for PIN sign-in. Declared here and
 * implemented by the Pos module (dependency inversion: Authentication does not depend on Pos).
 * Bound to NoTillDevices until the Pos module binds its own.
 */
interface TillDevices
{
    /** Permission a user needs to sign in at a till. */
    public const SIGN_IN_PERMISSION = 'pos.sell';

    /**
     * The till of this device (valid, not revoked), or null.
     *
     * @return array{id: string, organization_id: string, name: string, store_id: string, branch_id: string}|null
     */
    public function fromRequest(Request $request): ?array;

    /**
     * A stable, non-secret key of the device's till credential (for rate limits), or null.
     */
    public function deviceKey(Request $request): ?string;
}
