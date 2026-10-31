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

];
