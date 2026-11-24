<?php

namespace App\Modules\Marketing\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use DateTimeInterface;

/**
 * BD1c: Meta Conversions API events (server side of the Meta pixel).
 *
 * `purchase()` — one `Purchase` for a placed web order: `event_id` is the order number (the
 * browser pixel sends the same id, so Meta counts the order once), `action_source` website, the
 * page URL, `user_data` hashed as Meta asks (SHA-256 of normalized values: e-mail lower-cased
 * and trimmed; phone as 880 + 10 digits; first / last name lower-cased; city = the district,
 * lower-cased without spaces or punctuation; country `bd`; the customer id) plus the unhashed
 * IP address, user agent and the `_fbp` / `_fbc` click ids, and `custom_data` {currency, value,
 * content_ids (SKUs, else variant ids), content_type product, num_items, order_id}.
 *
 * `body()` / `json()` — the request body with the access token (sent in the body, never in the
 * URL) and the optional test event code; the order total is written as a JSON number straight
 * from its decimal string (money never passes through a float).
 */
final class MetaConversionEvent
{
    public const GRAPH_VERSION = 'v21.0';

    public const ENDPOINT = 'https://graph.facebook.com/'.self::GRAPH_VERSION.'/{pixel_id}/events';

    /**
     * @param  array{number: string, placed_at: DateTimeInterface, currency: string, total: string, contact_name: ?string,
     *   contact_email: ?string, contact_phone: ?string, customer_id: ?string, district: ?string, ip: ?string,
     *   user_agent: ?string, tracking_ids: ?array<string, string>, lines: list<array{sku: ?string, variant_id: ?string, quantity: string}>}  $order
     * @return array<string, mixed>
     */
    public static function purchase(array $order, string $pageUrl): array
    {
        $names = self::names((string) ($order['contact_name'] ?? ''));
        $user = [];
        $email = mb_strtolower(trim((string) ($order['contact_email'] ?? '')));
        if ($email !== '') {
            $user['em'] = [self::hash($email)];
        }
        $phone = self::phone($order['contact_phone'] ?? null);
        if ($phone !== null) {
            $user['ph'] = [self::hash($phone)];
        }
        if ($names['first'] !== null) {
            $user['fn'] = [self::hash($names['first'])];
        }
        if ($names['last'] !== null) {
            $user['ln'] = [self::hash($names['last'])];
        }
        $city = self::city($order['district'] ?? null);
        if ($city !== null) {
            $user['ct'] = [self::hash($city)];
        }
        $user['country'] = [self::hash('bd')];
        if (is_string($order['customer_id'] ?? null) && $order['customer_id'] !== '') {
            $user['external_id'] = [self::hash(strtolower($order['customer_id']))];
        }
        $user += self::client($order['ip'] ?? null, $order['user_agent'] ?? null);
        foreach (['fbp', 'fbc'] as $key) {
            $value = $order['tracking_ids'][$key] ?? null;
            if (is_string($value) && $value !== '') {
                $user[$key] = $value;
            }
        }

        $ids = [];
        $items = 0;
        foreach ($order['lines'] as $line) {
            $id = is_string($line['sku'] ?? null) && trim($line['sku']) !== '' ? trim($line['sku']) : ($line['variant_id'] ?? null);
            if (is_string($id) && ! in_array($id, $ids, true)) {
                $ids[] = $id;
            }
            // Items are counted whole (a weighed quantity counts as one).
            $items += max(1, (int) Decimal::ceil((string) $line['quantity']));
        }

        return [
            'event_name' => 'Purchase',
            'event_time' => $order['placed_at']->getTimestamp(),
            'event_id' => $order['number'],
            'action_source' => 'website',
            'event_source_url' => $pageUrl,
            'user_data' => $user,
            'custom_data' => [
                'currency' => $order['currency'],
                'value' => $order['total'],
                'content_ids' => $ids,
                'content_type' => 'product',
                'num_items' => $items,
                'order_id' => $order['number'],
            ],
        ];
    }

    /**
     * A `PageView` (the settings page's test event).
     *
     * @return array<string, mixed>
     */
    public static function pageView(string $eventId, DateTimeInterface $time, string $pageUrl, ?string $ip, ?string $userAgent): array
    {
        return [
            'event_name' => 'PageView',
            'event_time' => $time->getTimestamp(),
            'event_id' => $eventId,
            'action_source' => 'website',
            'event_source_url' => $pageUrl,
            'user_data' => ['country' => [self::hash('bd')]] + self::client($ip, $userAgent),
        ];
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    public static function body(array $event, string $accessToken, ?string $testEventCode): array
    {
        $body = ['data' => [$event], 'access_token' => $accessToken];
        if ($testEventCode !== null && $testEventCode !== '') {
            $body['test_event_code'] = $testEventCode;
        }

        return $body;
    }

    /**
     * The body as JSON, with `custom_data.value` (a decimal string) written as a JSON number.
     *
     * @param  array<string, mixed>  $body
     */
    public static function json(array $body): string
    {
        $json = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return preg_replace('/"value":"(-?\d+(?:\.\d+)?)"/', '"value":$1', $json) ?? $json;
    }

    public static function url(string $pixelId): string
    {
        return str_replace('{pixel_id}', rawurlencode($pixelId), self::ENDPOINT);
    }

    public static function hash(string $value): string
    {
        return hash('sha256', $value);
    }

    /**
     * 01712345678 → 8801712345678 (country code + 10 digits), null for anything else.
     */
    public static function phone(?string $phone): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $phone) ?? '';
        if (preg_match('/^(?:880|0)(1\d{9})$/', $digits, $m) === 1) {
            return '880'.$m[1];
        }

        return null;
    }

    /**
     * First and last name, lower-cased (a single name is the first name only).
     *
     * @return array{first: ?string, last: ?string}
     */
    public static function names(string $name): array
    {
        $parts = preg_split('/\s+/u', mb_strtolower(trim($name)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $clean = fn (string $part) => trim((string) preg_replace('/[^\p{L}\p{M}\p{N}\'-]+/u', '', $part));
        $first = $parts === [] ? '' : $clean($parts[0]);
        $last = count($parts) > 1 ? $clean($parts[count($parts) - 1]) : '';

        return ['first' => $first === '' ? null : $first, 'last' => $last === '' ? null : $last];
    }

    /** A city for Meta: lower-cased, letters and digits only ("Cox's Bazar" → "coxsbazar"). */
    public static function city(?string $district): ?string
    {
        $city = preg_replace('/[^\p{L}\p{M}\p{N}]+/u', '', mb_strtolower(trim((string) $district))) ?? '';

        return $city === '' ? null : $city;
    }

    /**
     * @return array<string, string>
     */
    private static function client(?string $ip, ?string $userAgent): array
    {
        $data = [];
        if (is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP) !== false) {
            $data['client_ip_address'] = $ip;
        }
        if (is_string($userAgent) && trim($userAgent) !== '') {
            $data['client_user_agent'] = $userAgent;
        }

        return $data;
    }
}
