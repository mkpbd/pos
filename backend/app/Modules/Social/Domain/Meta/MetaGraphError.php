<?php

namespace App\Modules\Social\Domain\Meta;

use RuntimeException;

/**
 * P2b: a Graph API (or sandbox) failure as a plain message for the merchant and a stable code:
 * TOKEN_EXPIRED, PERMISSION_MISSING, RATE_LIMITED, SPAM_BLOCKED, MEDIA_REJECTED, NETWORK_ERROR,
 * GRAPH_ERROR (anything else), SANDBOX_FAILURE. Meta's own codes are kept for logs; messages
 * never contain tokens.
 */
final class MetaGraphError extends RuntimeException
{
    public const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

    public const PERMISSION_MISSING = 'PERMISSION_MISSING';

    public const RATE_LIMITED = 'RATE_LIMITED';

    public const SPAM_BLOCKED = 'SPAM_BLOCKED';

    public const MEDIA_REJECTED = 'MEDIA_REJECTED';

    public const NETWORK_ERROR = 'NETWORK_ERROR';

    public const GRAPH_ERROR = 'GRAPH_ERROR';

    public const SANDBOX_FAILURE = 'SANDBOX_FAILURE';

    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?int $graphCode = null,
        public readonly ?int $graphSubcode = null,
        public readonly ?int $httpStatus = null,
        public readonly ?string $traceId = null,
    ) {
        parent::__construct($message);
    }

    /**
     * From a Graph API error object (`{message, type, code, error_subcode, fbtrace_id}`).
     *
     * @param  array<string, mixed>  $error
     */
    public static function fromGraph(array $error, int $status): self
    {
        $code = is_numeric($error['code'] ?? null) ? (int) $error['code'] : null;
        $subcode = is_numeric($error['error_subcode'] ?? null) ? (int) $error['error_subcode'] : null;
        $trace = is_string($error['fbtrace_id'] ?? null) ? mb_substr($error['fbtrace_id'], 0, 64) : null;
        $meta = self::scrub(is_string($error['error_user_msg'] ?? null) ? $error['error_user_msg'] : (is_string($error['message'] ?? null) ? $error['message'] : ''));

        [$ours, $message] = match (true) {
            in_array($code, [102, 190, 463, 467], true), ($error['type'] ?? null) === 'OAuthException' && $code === null && $status === 401 => [
                self::TOKEN_EXPIRED, 'Your Facebook connection has expired or was removed. Reconnect Facebook on the Social page.',
            ],
            in_array($code, [3, 10], true), $code !== null && $code >= 200 && $code <= 299 => [
                self::PERMISSION_MISSING, 'Facebook did not allow this. Reconnect Facebook and allow the app to publish to your Page and Instagram account.',
            ],
            in_array($code, [4, 17, 32, 613], true), $code !== null && $code >= 80001 && $code <= 80014 => [
                self::RATE_LIMITED, 'Facebook is limiting requests right now. Try again in a few minutes.',
            ],
            $code === 368 => [
                self::SPAM_BLOCKED, 'Facebook blocked this post (it may look like spam). Check your Page and try again later.',
            ],
            in_array($code, [324, 352, 9004], true), $code !== null && $code >= 36000 && $code <= 36003, $subcode !== null && $subcode >= 2207000 && $subcode <= 2207999 => [
                self::MEDIA_REJECTED, 'Facebook could not use a photo. Use JPEG photos at a public https:// address (Instagram: between 4:5 and 1.91:1).',
            ],
            in_array($code, [1, 2], true), $status >= 500 => [
                self::GRAPH_ERROR, 'Facebook had a temporary problem. Try again in a few minutes.',
            ],
            default => [
                self::GRAPH_ERROR, 'Facebook rejected the request'.($meta === '' ? '.' : ': '.$meta),
            ],
        };

        return new self($ours, $message, $code, $subcode, $status, $trace);
    }

    public static function network(): self
    {
        return new self(self::NETWORK_ERROR, 'Could not reach Facebook. Check the internet connection and try again.');
    }

    public static function unexpected(string $what): self
    {
        return new self(self::GRAPH_ERROR, "Facebook sent an unexpected answer ({$what}). Try again later.");
    }

    /**
     * Without anything that looks like an access token or app secret, at most 200 characters.
     */
    public static function scrub(string $text): string
    {
        $text = (string) preg_replace(['/EAA[A-Za-z0-9]{10,}/', '/(access_token|client_secret|appsecret_proof)=[^&\s]+/i'], ['[token]', '$1=[redacted]'], $text);

        return mb_substr(trim($text), 0, 200);
    }
}
