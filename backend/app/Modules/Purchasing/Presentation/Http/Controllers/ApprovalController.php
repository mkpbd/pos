<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\UpdateApprovalSettings;
use App\Modules\Purchasing\Application\Queries\ApprovalInbox;
use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Presentation\Http\Exports\ApprovalsExport;
use App\Modules\Purchasing\Presentation\Http\Requests\UpdateApprovalSettingsRequest;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * The approvals inbox and the organization's approval limits (SC2).
 */
class ApprovalController
{
    public function __construct(
        private readonly ApprovalRules $rules,
        private readonly PurchasingContext $context,
    ) {}

    /**
     * Waiting for my approval
     *
     * Submitted requisitions and purchase orders pending approval that the current user may
     * approve (permission for the level, branch access, not raised or submitted by them), oldest
     * first. Filters: `kind=requisition|purchase_order`, `approval_level`, `search` (number).
     */
    public function index(Request $request, ApprovalInbox $inbox, ListExporter $exports): Response
    {
        $user = $this->user($request);
        $this->rules->requireAny($user, ['purchases.approve', 'purchases.approve_high']);
        $request->validate([
            'kind' => ['sometimes', Rule::in(['requisition', 'purchase_order'])],
            'approval_level' => ['sometimes', Rule::in([ApprovalLevel::Manager->value, ApprovalLevel::High->value])],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $rows = $inbox->for($user, [
            'kind' => $request->query('kind'),
            'approval_level' => $request->query('approval_level'),
            'search' => $request->query('search'),
        ]);

        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, ApprovalsExport::class, RowSource::fromRows($rows));
        }

        $perPage = ListQuery::perPage($request);
        $current = max(1, (int) $request->query('page', 1));
        $page = new LengthAwarePaginator(array_slice($rows, ($current - 1) * $perPage, $perPage), count($rows), $perPage, $current);

        return ApiResponse::paginated($page, fn (array $row) => new JsonResource($row), [
            'counts' => [
                'requisition' => count(array_filter($rows, fn (array $r) => $r['kind'] === 'requisition')),
                'purchase_order' => count(array_filter($rows, fn (array $r) => $r['kind'] === 'purchase_order')),
            ],
        ]);
    }

    /**
     * Approval limits
     *
     * Defaults until saved: auto-approve up to 10 000.00, manager approval up to 100 000.00,
     * purchase order approval required. Readable by anyone working with purchasing.
     */
    public function settings(Request $request): JsonResponse
    {
        $this->rules->requireAny($this->user($request), ['purchases.view', 'purchases.request', 'purchases.approve', 'purchases.approve_high', 'purchases.settings']);

        return ApiResponse::success($this->presentSettings());
    }

    public function updateSettings(UpdateApprovalSettingsRequest $request, UpdateApprovalSettings $update): JsonResponse
    {
        $update($request->validated());

        return ApiResponse::success($this->presentSettings());
    }

    /**
     * @return array<string, mixed>
     */
    private function presentSettings(): array
    {
        return $this->rules->settings() + ['currency' => $this->context->currency()];
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
