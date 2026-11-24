<?php

namespace App\Modules\Sms\Infrastructure\Gateways;

/**
 * The system resolver: A records (gethostbynamel) and AAAA records (dns_get_record).
 */
final class DnsHostResolver implements HostResolver
{
    public function resolve(string $host): array
    {
        $ips = @gethostbynamel($host) ?: [];
        $aaaa = @dns_get_record($host, DNS_AAAA);
        foreach (is_array($aaaa) ? $aaaa : [] as $record) {
            if (is_string($record['ipv6'] ?? null)) {
                $ips[] = $record['ipv6'];
            }
        }

        return array_values(array_unique($ips));
    }
}
