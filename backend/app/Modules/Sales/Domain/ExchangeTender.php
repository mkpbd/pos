<?php

namespace App\Modules\Sales\Domain;

/**
 * POS1c: the returned value that pays an exchange's new sale (A = min(V, T)) — a payment of
 * method `exchange` naming the return — and the invoice number reserved for that sale (the
 * return's `exchange` refund names it). Created by the server only (ExchangeItems).
 */
final readonly class ExchangeTender
{
    public function __construct(
        public string $amount,
        public string $returnId,
        public string $returnNumber,
        public ?string $saleNumber = null,
    ) {}
}
