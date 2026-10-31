<?php

// Read by Laravel's TrustProxies middleware. Behind a TLS-terminating load balancer or reverse
// proxy, list its addresses (comma-separated, CIDR allowed) or "*" so that the request scheme
// and client IP come from the X-Forwarded-* headers: e-mail links then use https://, the cart
// cookie keeps its Secure flag and rate limits apply per visitor instead of per proxy.
// Leave empty when the application is reached directly.
$proxies = trim((string) env('TRUSTED_PROXIES', ''));

return [
    'proxies' => match ($proxies) {
        '' => null,
        '*' => '*',
        default => array_values(array_filter(array_map('trim', explode(',', $proxies)))),
    },
];
