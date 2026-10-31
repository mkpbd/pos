<?php

namespace App\Modules\Shared\Application\Contracts;

use Illuminate\Database\Eloquent\Model;

/**
 * Append-only record of sensitive operations. Implemented by the Audit module.
 */
interface AuditTrail
{
    /**
     * @param  string  $action  dotted verb, e.g. "user.created", "auth.login"
     * @param  array<string, mixed>  $old  attributes before the change
     * @param  array<string, mixed>  $new  attributes after the change
     * @param  array<string, mixed>  $context  extra non-attribute details
     */
    public function record(string $action, ?Model $subject = null, array $old = [], array $new = [], array $context = []): void;
}
