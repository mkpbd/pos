<?php

namespace App\Modules\Orders\Presentation\Http\Support;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use Illuminate\Http\Request;

/**
 * BD1a: the mobile numbers the shopper proved with a checkout SMS code, kept in the storefront
 * session for two hours (`checkout_verified_phones`: [{org, phone, at}]). Entries belong to the
 * organization that verified them, so a session cookie carried to another store proves nothing
 * there.
 */
final class CheckoutVerifiedPhones
{
    public const SESSION_KEY = 'checkout_verified_phones';

    public const VALID_SECONDS = 7200;

    private const MAX_ENTRIES = 10;

    public static function remember(Request $request, string $organizationId, string $phone): void
    {
        $entries = array_values(array_filter(
            self::entries($request),
            fn (array $e) => ! ($e['org'] === $organizationId && $e['phone'] === $phone),
        ));
        $entries[] = ['org' => $organizationId, 'phone' => $phone, 'at' => now()->getTimestamp()];

        $request->session()->put(self::SESSION_KEY, array_slice($entries, -self::MAX_ENTRIES));
    }

    /**
     * The numbers that count as checked for this shopper: the signed-in account's verified
     * number and the ones checked with a code in this session.
     *
     * @return list<string>
     */
    public static function forShopper(Request $request, string $organizationId, ?CustomerAccount $account): array
    {
        $phones = self::phones($request, $organizationId);
        if ($account !== null && $account->getAttribute('phone_verified_at') !== null && is_string($account->phone) && $account->phone !== '') {
            $phones[] = $account->phone;
        }

        return $phones;
    }

    /**
     * The numbers this organization's checkout accepts as verified now.
     *
     * @return list<string>
     */
    public static function phones(Request $request, string $organizationId): array
    {
        return array_values(array_map(
            fn (array $e) => $e['phone'],
            array_filter(self::entries($request), fn (array $e) => $e['org'] === $organizationId),
        ));
    }

    /**
     * Unexpired, well-formed entries.
     *
     * @return list<array{org: string, phone: string, at: int}>
     */
    private static function entries(Request $request): array
    {
        if (! $request->hasSession()) {
            return [];
        }
        $stored = $request->session()->get(self::SESSION_KEY);
        $oldest = now()->getTimestamp() - self::VALID_SECONDS;

        return array_values(array_filter(
            is_array($stored) ? $stored : [],
            fn ($e) => is_array($e) && is_string($e['org'] ?? null) && is_string($e['phone'] ?? null) && is_int($e['at'] ?? null) && $e['at'] >= $oldest,
        ));
    }
}
