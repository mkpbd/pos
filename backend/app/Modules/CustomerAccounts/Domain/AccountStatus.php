<?php

namespace App\Modules\CustomerAccounts\Domain;

/**
 * Whether a customer may sign in to the online store. Staff disable accounts; a disabled
 * account is rejected on sign-in and on every signed-in request.
 */
enum AccountStatus: string
{
    case Active = 'active';
    case Disabled = 'disabled';
}
