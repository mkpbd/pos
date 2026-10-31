<?php

namespace App\Modules\Organizations\Presentation\Http\Middleware;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the organization and active branch for an authenticated request.
 *
 * - Organization: the user's own; platform admins may pick one with X-Organization-Id.
 * - Branch: optional X-Branch-Id, which must be an active branch of the organization
 *   that the user may access.
 *
 * Runs before route-model binding (see bootstrap/app.php priority) so bound models are tenant-scoped.
 * Usage: `tenant` (organization required) or `tenant:optional` (platform routes).
 */
class ResolveTenant
{
    public const ORGANIZATION_HEADER = 'X-Organization-Id';

    public const BRANCH_HEADER = 'X-Branch-Id';

    public function __construct(
        private readonly TenantContext $context,
        private readonly BranchDirectory $branches,
    ) {}

    public function handle(Request $request, Closure $next, string $mode = 'required'): Response
    {
        $user = $request->user();

        if (! $user instanceof TenantUser) {
            return ApiResponse::error('UNAUTHENTICATED', 'Authentication is required.', 401);
        }

        if (! $user->isActive()) {
            return ApiResponse::error('ACCOUNT_INACTIVE', 'Your account has been deactivated.', 403);
        }

        $organizationId = $user->isPlatformAdmin()
            ? $request->headers->get(self::ORGANIZATION_HEADER)
            : $user->organizationId();

        if ($organizationId === null) {
            if ($mode === 'optional') {
                return $this->run($request, $next, null, null);
            }

            return ApiResponse::error('ORGANIZATION_CONTEXT_REQUIRED', 'Select an organization ('.self::ORGANIZATION_HEADER.' header).', 400);
        }

        $organization = Organization::query()->find($organizationId);
        if ($organization === null) {
            return ApiResponse::error('NOT_FOUND', 'The requested resource was not found.', 404);
        }
        if (! $organization->isActive() && ! $user->isPlatformAdmin()) {
            return ApiResponse::error('ORGANIZATION_SUSPENDED', 'Your organization is suspended. Contact support.', 403);
        }

        $branchId = $request->headers->get(self::BRANCH_HEADER);
        if ($branchId !== null && $branchId !== '') {
            if (! $this->branches->isActiveBranchOf($branchId, $organizationId) || ! $user->canAccessBranch($branchId)) {
                return ApiResponse::error('BRANCH_ACCESS_DENIED', 'You do not have access to the selected branch.', 403);
            }
        } else {
            $branchId = null;
        }

        return $this->run($request, $next, $organizationId, $branchId);
    }

    private function run(Request $request, Closure $next, ?string $organizationId, ?string $branchId): Response
    {
        $this->context->setOrganization($organizationId);
        $this->context->setBranch($branchId);

        try {
            return $next($request);
        } finally {
            // Never let a tenant leak into whatever runs next in this process (tests, Octane).
            $this->context->setOrganization(null);
        }
    }
}
