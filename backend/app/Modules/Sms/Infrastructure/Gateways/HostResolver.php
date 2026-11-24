<?php

namespace App\Modules\Sms\Infrastructure\Gateways;

/**
 * Resolves a host name to its IP addresses (IPv4 and IPv6). Swappable in tests.
 */
interface HostResolver
{
    /**
     * @return list<string> empty when the name does not resolve
     */
    public function resolve(string $host): array;
}
