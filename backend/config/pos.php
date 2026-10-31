<?php

return [

    /*
    | Defaults for newly created organizations.
    */
    'default_currency' => env('POS_DEFAULT_CURRENCY', 'BDT'),
    'default_timezone' => env('POS_DEFAULT_TIMEZONE', 'Asia/Dhaka'),

    /*
    | Public self-service sign-up (creates a new organization with its first admin).
    */
    'registration_enabled' => (bool) env('POS_REGISTRATION_ENABLED', true),

    /*
    | Lifetime of personal access tokens issued to devices/integrations.
    */
    'device_token_ttl_days' => (int) env('POS_DEVICE_TOKEN_TTL_DAYS', 90),

    /*
    | SPA base URL, used in e-mails (password reset links).
    */
    'frontend_url' => env('FRONTEND_URL', 'http://localhost:5173'),

    // Requests per minute per user (or IP when signed out) on the API. Full-stack e2e runs raise it.
    'api_rate_limit' => (int) env('POS_API_RATE_LIMIT', 120),

    // Sign-in / reset attempts per minute per account+IP (four times that per IP). Full-stack e2e runs raise it.
    'auth_rate_limit' => (int) env('POS_AUTH_RATE_LIMIT', 5),

    // Storefront checkout previews and placements per minute per IP + cart (ADR-015). Full-stack e2e runs raise it.
    'checkout_rate_limit' => (int) env('POS_CHECKOUT_RATE_LIMIT', 10),

];
