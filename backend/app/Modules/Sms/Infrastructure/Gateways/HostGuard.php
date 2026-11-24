<?php

namespace App\Modules\Sms\Infrastructure\Gateways;

/**
 * BD1a: server-side request forgery guard for the merchant-configured SMS gateway address.
 * Only https (http only when `sms.allow_insecure_http` and not in production); the host is
 * resolved and every address must be public — loopback, private, link-local (cloud metadata),
 * carrier-grade NAT, multicast, reserved and documentation ranges are refused unless
 * `sms.allow_private_hosts`. IP-literal hosts are checked the same way.
 */
final class HostGuard
{
    /** Ranges refused on top of PHP's FILTER_FLAG_GLOBAL_RANGE. */
    private const BLOCKED = [
        '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
        '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
        '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
        '::/128', '::1/128', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16',
        'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
    ];

    public function __construct(private readonly HostResolver $resolver) {}

    /**
     * @return array{error: ?string, retryable: bool, host: string, port: int, ips: list<string>}
     */
    public function inspect(string $url): array
    {
        $parts = parse_url(trim($url));
        $parts = is_array($parts) ? $parts : [];
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
        $port = (int) ($parts['port'] ?? ($scheme === 'http' ? 80 : 443));
        $refuse = fn (string $error = 'blocked_host', bool $retryable = false) => ['error' => $error, 'retryable' => $retryable, 'host' => $host, 'port' => $port, 'ips' => []];

        if ($host === '' || ! self::schemeAllowed($scheme)) {
            return $refuse();
        }

        $allowPrivate = (bool) config('sms.allow_private_hosts', false);
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            $ips = [$host];
        } else {
            if (! $allowPrivate && ($host === 'localhost' || str_ends_with($host, '.localhost'))) {
                return $refuse();
            }
            $ips = $this->resolver->resolve($host);
            if ($ips === []) {
                return $refuse('host_not_found', true);
            }
        }

        if (! $allowPrivate) {
            foreach ($ips as $ip) {
                if (! self::isPublic($ip)) {
                    return $refuse();
                }
            }
        }

        return ['error' => null, 'retryable' => false, 'host' => $host, 'port' => $port, 'ips' => array_values($ips)];
    }

    /** https always; http only when allowed and not in production. */
    public static function schemeAllowed(string $scheme): bool
    {
        $scheme = strtolower($scheme);

        return $scheme === 'https' || ($scheme === 'http' && self::insecureHttpAllowed());
    }

    public static function insecureHttpAllowed(): bool
    {
        return (bool) config('sms.allow_insecure_http', false) && ! app()->isProduction();
    }

    public static function isPublic(string $ip): bool
    {
        $binary = @inet_pton($ip);
        if ($binary === false) {
            return false;
        }
        // IPv4-mapped IPv6 (::ffff:a.b.c.d): judge the embedded IPv4 address.
        if (strlen($binary) === 16 && str_starts_with($binary, str_repeat("\0", 10)."\xff\xff")) {
            return self::isPublic((string) inet_ntop(substr($binary, 12)));
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE) === false) {
            return false;
        }

        foreach (self::BLOCKED as $cidr) {
            if (self::inRange($binary, $cidr)) {
                return false;
            }
        }

        return true;
    }

    private static function inRange(string $binary, string $cidr): bool
    {
        [$network, $bits] = explode('/', $cidr);
        $net = inet_pton($network);
        if ($net === false || strlen($net) !== strlen($binary)) {
            return false;
        }
        $bits = (int) $bits;
        $bytes = intdiv($bits, 8);
        if (substr($binary, 0, $bytes) !== substr($net, 0, $bytes)) {
            return false;
        }
        $rest = $bits % 8;
        if ($rest === 0) {
            return true;
        }
        $mask = (0xFF << (8 - $rest)) & 0xFF;

        return (ord($binary[$bytes]) & $mask) === (ord($net[$bytes]) & $mask);
    }
}
