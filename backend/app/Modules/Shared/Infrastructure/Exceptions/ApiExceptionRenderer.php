<?php

namespace App\Modules\Shared\Infrastructure\Exceptions;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

/**
 * Maps every exception thrown inside /api/* to the standard error envelope.
 * Internal details are never exposed unless APP_DEBUG is on.
 */
final class ApiExceptionRenderer
{
    public function __invoke(Throwable $e, Request $request): ?JsonResponse
    {
        if (! $request->is('api/*') && ! $request->expectsJson()) {
            return null;
        }

        return match (true) {
            $e instanceof ValidationException => ApiResponse::error(
                'VALIDATION_FAILED', 'The given data was invalid.', 422, $e->errors(),
            ),
            $e instanceof AuthenticationException => ApiResponse::error(
                'UNAUTHENTICATED', 'Authentication is required.', 401,
            ),
            $e instanceof AuthorizationException, $e instanceof AccessDeniedHttpException => ApiResponse::error(
                'FORBIDDEN', 'You are not allowed to perform this action.', 403,
            ),
            $e instanceof ModelNotFoundException, $e instanceof NotFoundHttpException => ApiResponse::error(
                'NOT_FOUND', 'The requested resource was not found.', 404,
            ),
            $e instanceof BusinessRuleViolation => ApiResponse::error(
                $e->errorCode, $e->getMessage(), 422, $e->details,
            ),
            // A unique index caught a race that validation could not see (two requests at once).
            $e instanceof UniqueConstraintViolationException => ApiResponse::error(
                'CONFLICT', 'The record conflicts with one that was just saved. Reload and try again.', 409,
            ),
            $e instanceof HttpExceptionInterface => ApiResponse::error(
                self::httpCode($e->getStatusCode()),
                self::httpMessage($e->getStatusCode()),
                $e->getStatusCode(),
                headers: $e->getHeaders(),
            ),
            default => ApiResponse::error(
                'SERVER_ERROR',
                config('app.debug') ? $e->getMessage() : 'An unexpected error occurred.',
                500,
                config('app.debug') ? ['exception' => $e::class] : [],
            ),
        };
    }

    private static function httpCode(int $status): string
    {
        return match ($status) {
            405 => 'METHOD_NOT_ALLOWED',
            409 => 'CONFLICT',
            419 => 'CSRF_TOKEN_MISMATCH',
            429 => 'TOO_MANY_REQUESTS',
            503 => 'SERVICE_UNAVAILABLE',
            default => 'HTTP_'.$status,
        };
    }

    private static function httpMessage(int $status): string
    {
        return match ($status) {
            405 => 'Method not allowed.',
            409 => 'The request conflicts with the current state.',
            419 => 'The CSRF token is missing or expired.',
            429 => 'Too many requests. Please slow down.',
            503 => 'Service temporarily unavailable.',
            default => 'The request could not be completed.',
        };
    }
}
