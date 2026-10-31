<?php

namespace App\Modules\Organizations\Presentation\Http\Middleware;

use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePlatformAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof TenantUser || ! $user->isPlatformAdmin()) {
            return ApiResponse::error('FORBIDDEN', 'You are not allowed to perform this action.', 403);
        }

        return $next($request);
    }
}
