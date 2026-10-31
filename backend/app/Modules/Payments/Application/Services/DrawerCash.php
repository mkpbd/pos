<?php

namespace App\Modules\Payments\Application\Services;

use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Cash that should be in a session's drawer: opening float + cash in − cash out.
 */
class DrawerCash
{
    public function expected(RegisterSession $session): string
    {
        $sums = Payment::query()
            ->where('cash_register_session_id', $session->id)
            ->where('method', PaymentMethod::Cash)
            ->groupBy('direction')
            ->selectRaw('direction, SUM(amount) as total')
            ->pluck('total', 'direction');

        $in = Decimal::round((string) ($sums[PaymentDirection::In->value] ?? '0'), 2);
        $out = Decimal::round((string) ($sums[PaymentDirection::Out->value] ?? '0'), 2);

        return Decimal::sub(Decimal::add($session->opening_float, $in, 2), $out, 2);
    }
}
