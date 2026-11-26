<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReceiptLink;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * POS1d: the public link of a sale's digital receipt — one random token per sale (40 URL-safe
 * characters from a CSPRNG), made on first need and reused. The page lives on the store:
 * `{primary storefront URL}/receipt/{token}`; without an open store with a domain there is no
 * URL (the receipt then travels in full by e-mail and the SMS carries no link).
 */
class ReceiptLinks
{
    public const TOKEN_LENGTH = 40;

    public function __construct(private readonly StorefrontConfig $storefront) {}

    public function forSale(Sale $sale): SaleReceiptLink
    {
        $existing = SaleReceiptLink::query()->where('sale_id', $sale->id)->first();
        if ($existing !== null) {
            return $existing;
        }

        try {
            // A savepoint, so a link racing in does not abort a surrounding transaction.
            return DB::transaction(fn () => SaleReceiptLink::query()->create([
                'sale_id' => $sale->id,
                'token' => Str::random(self::TOKEN_LENGTH),
                'created_at' => now(),
            ]));
        } catch (UniqueConstraintViolationException) {
            return SaleReceiptLink::query()->where('sale_id', $sale->id)->firstOrFail();
        }
    }

    /** The public address of the receipt, or null when the organization has no open store with a domain. */
    public function url(SaleReceiptLink $link): ?string
    {
        $site = $this->storefront->primaryUrl();
        if ($site === null || ! $this->storefront->settings()->is_enabled) {
            return null;
        }

        return rtrim($site, '/').'/receipt/'.$link->token;
    }

    /** The sale of a receipt token in the current organization (the storefront host's). */
    public function saleFor(string $token): ?Sale
    {
        if (preg_match('/^[A-Za-z0-9]{32,48}$/', $token) !== 1) {
            return null;
        }
        $saleId = SaleReceiptLink::query()->where('token', $token)->value('sale_id');

        return $saleId === null ? null : Sale::query()->find($saleId);
    }
}
