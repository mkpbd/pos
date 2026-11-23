<?php

return [

    /*
    | Defaults for newly created organizations.
    */
    'default_currency' => env('POS_DEFAULT_CURRENCY', 'BDT'),
    'default_timezone' => env('POS_DEFAULT_TIMEZONE', 'Asia/Dhaka'),

    /*
    | Public self-service sign-up (creates a new organization with its first admin). Off unless
    | POS_REGISTRATION_ENABLED=true (Q1): anyone could otherwise create organizations on a public install.
    */
    'registration_enabled' => (bool) env('POS_REGISTRATION_ENABLED', false),

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

    // Coupon codes tried per minute per cart / customer (E8b, ADR-015).
    'coupon_rate_limit' => (int) env('POS_COUPON_RATE_LIMIT', 10),

    // New product reviews per hour per customer (E9).
    'review_rate_limit' => (int) env('POS_REVIEW_RATE_LIMIT', 5),

    // Store builder form submissions per hour per visitor IP (B8b).
    'form_rate_limit' => (int) env('POS_FORM_RATE_LIMIT', 10),

    // Shopper questions about products per hour per visitor IP (P1b).
    'question_rate_limit' => (int) env('POS_QUESTION_RATE_LIMIT', 5),

    /*
    | G1a: staff account lockout. After `max_attempts` failed sign-ins in a row (wrong password or
    | wrong two-factor code) the account is locked for `minutes`; the user is e-mailed. A successful
    | sign-in, an e-mailed password reset or an administrator's unlock clears it.
    */
    'lockout' => [
        'max_attempts' => (int) env('POS_LOCKOUT_MAX_ATTEMPTS', 10),
        'minutes' => (int) env('POS_LOCKOUT_MINUTES', 15),
    ],

    /*
    | G1a: security headers. HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`)
    | is sent on HTTPS requests only. Turn it off (POS_HSTS=false) when a subdomain of the host must
    | still be reachable over plain HTTP — browsers would refuse it for a year.
    */
    'security' => [
        'hsts' => (bool) env('POS_HSTS', true),
    ],

];
