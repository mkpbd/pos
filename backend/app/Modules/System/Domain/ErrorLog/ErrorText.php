<?php

namespace App\Modules\System\Domain\ErrorLog;

/**
 * Text rules of the built-in error log (G1b): what of an error message may be stored and shown
 * to operators, and how occurrences of "the same" error are grouped.
 */
final class ErrorText
{
    public const MESSAGE_LIMIT = 1000;

    /**
     * Removes secrets and personal data from a message: `password=…` / `token: …` style values,
     * credentials in connection URLs, e-mail addresses and long digit runs (phone, card and
     * account numbers); then truncates.
     */
    public static function sanitise(string $message, int $limit = self::MESSAGE_LIMIT): string
    {
        // key=value / key: value where the key mentions a password, secret, token or key.
        $message = (string) preg_replace(
            '/\b([A-Za-z0-9_.\-]*(?:password|passwd|pwd|secret|token|key)[A-Za-z0-9_.\-]*)(\s*[=:]\s*)("[^"]*"|\'[^\']*\'|[^\s,;&)]+)/i',
            '$1$2[redacted]',
            $message,
        );
        // scheme://user:password@host
        $message = (string) preg_replace('#\b([a-z][a-z0-9+.\-]*://)[^\s/@:]+:[^\s/@]+@#i', '$1[redacted]@', $message);
        $message = (string) preg_replace('/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/', '[email]', $message);
        $message = (string) preg_replace('/\d{6,}/', '[number]', $message);

        return self::truncate(trim($message), $limit);
    }

    /**
     * The message with its variable parts (numbers, UUIDs / ULIDs, quoted strings, e-mail
     * addresses) replaced, so "Order 12 failed" and "Order 13 failed" group together.
     */
    public static function normalise(string $message): string
    {
        $message = (string) preg_replace('/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/', '{email}', $message);
        $message = (string) preg_replace('/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i', '{uuid}', $message);
        $message = (string) preg_replace('/\b[0-9A-HJKMNP-TV-Z]{26}\b/', '{ulid}', $message);
        $message = (string) preg_replace('/"[^"]*"|\'[^\']*\'/', '{string}', $message);
        $message = (string) preg_replace('/\d+(?:\.\d+)?/', '{number}', $message);

        return trim((string) preg_replace('/\s+/', ' ', $message));
    }

    /**
     * Identity of an error: class, place and the normalised message.
     */
    public static function fingerprint(string $class, string $file, int $line, string $message): string
    {
        return hash('sha256', implode('|', [$class, $file, $line, self::normalise($message)]));
    }

    public static function truncate(string $text, int $limit): string
    {
        return mb_strlen($text) > $limit ? mb_substr($text, 0, $limit - 1).'…' : $text;
    }

    /**
     * The first non-empty line of a text, truncated.
     */
    public static function firstLine(string $text, int $limit): string
    {
        foreach (preg_split('/\R/', $text) ?: [] as $line) {
            if (trim($line) !== '') {
                return self::truncate(trim($line), $limit);
            }
        }

        return '';
    }
}
