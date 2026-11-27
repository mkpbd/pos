<?php

namespace App\Modules\Sales\Domain;

use App\Modules\Shared\Domain\BangladeshMobile;

/**
 * POS1d: how a receipt's recipient is shown and stored — never in full. A mobile number keeps
 * its operator prefix and last three digits (`017••••123`), an e-mail address the first two
 * characters of the name (one when it is that short) and the domain (`ra•••@gmail.com`).
 */
final class RecipientMask
{
    public static function phone(string $phone): string
    {
        return BangladeshMobile::masked($phone);
    }

    public static function email(string $email): string
    {
        $at = strrpos($email, '@');
        if ($at === false || $at === 0) {
            return '•••';
        }
        $name = substr($email, 0, $at);
        $keep = mb_strlen($name) > 2 ? 2 : 1;

        return mb_substr($name, 0, $keep).'•••'.substr($email, $at);
    }
}
