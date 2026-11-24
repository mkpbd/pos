<?php

/*
| BD1a: text messages (Sms module). The gateway itself (test mode or an HTTP SMS provider, its
| address, API key and templates) is set per organization on the SMS settings page; these are the
| server-wide safety limits.
*/
return [
    // Seconds for the whole request to the SMS provider, and for connecting.
    'timeout' => (int) env('SMS_TIMEOUT', 10),
    'connect_timeout' => (int) env('SMS_CONNECT_TIMEOUT', 5),

    // Plain http:// gateway addresses — never honoured in production.
    'allow_insecure_http' => (bool) env('SMS_ALLOW_INSECURE_HTTP', false),

    // Gateways on loopback / private / link-local addresses (SSRF guard off) — development only.
    'allow_private_hosts' => (bool) env('SMS_ALLOW_PRIVATE_HOSTS', false),

    // One-time codes (phone sign-in, checkout phone check).
    'otp' => [
        'ttl_seconds' => (int) env('SMS_OTP_TTL_SECONDS', 300),
        'resend_seconds' => (int) env('SMS_OTP_RESEND_SECONDS', 60),
        'max_per_phone_per_hour' => (int) env('SMS_OTP_MAX_PER_PHONE_PER_HOUR', 5),
        'max_per_ip_per_hour' => (int) env('SMS_OTP_MAX_PER_IP_PER_HOUR', 20),
        'max_attempts' => (int) env('SMS_OTP_MAX_ATTEMPTS', 5),
        'daily_limit_per_org' => (int) env('SMS_OTP_DAILY_LIMIT_PER_ORG', 1000),
    ],
];
