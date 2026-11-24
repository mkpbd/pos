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

    /*
    | G1b: who gets operations alerts (new / returning errors, failed backups and restore checks):
    | comma-separated e-mail addresses. Empty = no alert mails (the status page still shows them).
    */
    'ops_alert_emails' => array_values(array_filter(array_map('trim', explode(',', (string) env('POS_OPS_ALERT_EMAILS', ''))))),

    /*
    | G1b: built-in error log (`error_events`, shown to platform admins). Unexpected server errors
    | are recorded through a separate database connection, so a rolled-back transaction keeps them.
    */
    'error_log' => [
        'enabled' => (bool) env('POS_ERROR_LOG_ENABLED', true),
    ],

    /*
    | G1b: database backups with pg_dump (custom format) to a local folder, a checksum next to each
    | file, an optional off-site hook (`{file}` = the shell-escaped path, e.g.
    | `rclone copy {file} offsite:pos-backups`) and a nightly restore check (`pg_restore --list`, and
    | a full restore into `verify_database` when set — never the live database).
    */
    'backup' => [
        'enabled' => (bool) env('POS_BACKUP_ENABLED', false),
        'path' => env('POS_BACKUP_PATH') ?: storage_path('app/backups'),
        'keep_days' => (int) env('POS_BACKUP_KEEP_DAYS', 14),
        // The newest N successful backups are always kept, however old.
        'keep_min' => (int) env('POS_BACKUP_KEEP_MIN', 3),
        // Daily, in the application timezone; the restore check runs 90 minutes later.
        'time' => (string) env('POS_BACKUP_TIME', '02:00'),
        // Directory holding pg_dump / pg_restore; empty = found on PATH.
        'pg_bin' => (string) env('POS_PG_BIN', ''),
        'after_command' => (string) env('POS_BACKUP_AFTER_COMMAND', ''),
        'verify_database' => (string) env('POS_BACKUP_VERIFY_DATABASE', ''),
        // Seconds pg_dump / pg_restore / the off-site hook may run.
        'timeout' => (int) env('POS_BACKUP_TIMEOUT', 3600),
    ],

    /*
    | G1b: data retention (`pos:prune-records`, daily), in days; empty or 0 = keep forever.
    | Audit logs are kept forever unless POS_RETAIN_AUDIT_DAYS is set (financial records stay in
    | their own tables either way, but who-did-what history older than that is gone).
    */
    'retention' => [
        'login_activities' => env('POS_RETAIN_LOGIN_ACTIVITY_DAYS', 365),
        'notifications' => env('POS_RETAIN_READ_NOTIFICATIONS_DAYS', 180),
        'failed_jobs' => env('POS_RETAIN_FAILED_JOBS_DAYS', 30),
        'ai_requests' => env('POS_RETAIN_AI_REQUESTS_DAYS', 365),
        'error_events' => env('POS_RETAIN_ERROR_EVENTS_DAYS', 90),
        'audit_logs' => env('POS_RETAIN_AUDIT_DAYS'),
        'system_backups' => env('POS_RETAIN_BACKUP_RECORDS_DAYS', 90),
        // ST1: uploaded import files, counted from the import's end (completed, failed, cancelled).
        'import_files' => env('POS_RETAIN_IMPORT_FILES_DAYS', 30),
        // BD1a: the SMS message log (one-time codes are always deleted after a day).
        'sms_messages' => env('POS_RETAIN_SMS_DAYS', 180),
    ],

    /*
    | ST1: bulk import (Imports module). Files live on the private disk under
    | imports/{organization}/{import}.{ext}; rows are imported in chunks, one transaction each.
    */
    'imports' => [
        'disk' => env('POS_IMPORTS_DISK', 'local'),
        'max_rows' => 20000,
        'max_file_kb' => 10240,
        'chunk_size' => 200,
        // Errors kept per phase (dry run, run); the import page shows the first 200.
        'stored_errors' => 1000,
    ],

];
