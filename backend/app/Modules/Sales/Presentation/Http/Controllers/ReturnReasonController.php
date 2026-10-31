<?php

namespace App\Modules\Sales\Presentation\Http\Controllers;

use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Persistence\ReferentialIntegrity;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Reasons customers return goods for, each with a default restocking rule.
 */
class ReturnReasonController
{
    private const FIELDS = ['name', 'restock_by_default', 'is_active'];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * Return reasons
     *
     * For anyone who can see or request returns.
     */
    public function index(Request $request): JsonResponse
    {
        if (! Gate::forUser($request->user())->any(['returns.view', 'returns.create', 'returns.manage'])) {
            throw new AccessDeniedHttpException;
        }

        return ApiResponse::success(ReturnReason::query()->orderBy('name')->get()->map(fn (ReturnReason $r) => $this->present($r))->all());
    }

    public function store(Request $request): JsonResponse
    {
        return ApiResponse::created($this->present($this->save(new ReturnReason, $this->validated($request, null))));
    }

    public function update(Request $request, ReturnReason $returnReason): JsonResponse
    {
        return ApiResponse::success($this->present($this->save($returnReason, $this->validated($request, $returnReason))));
    }

    /**
     * Delete a reason
     *
     * Only reasons no return refers to (422 `IN_USE`; deactivate those instead).
     */
    public function destroy(ReturnReason $returnReason): JsonResponse
    {
        DB::transaction(function () use ($returnReason) {
            ReferentialIntegrity::deleteOrFail($returnReason, 'return reason');
            $this->audit->record('return_reason.deleted', $returnReason, old: $returnReason->only(self::FIELDS));
        });

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ?ReturnReason $reason): array
    {
        $required = $reason === null ? 'required' : 'sometimes';

        return $request->validate([
            'name' => [$required, 'string', 'max:100', new TenantUnique('return_reasons', 'name', $reason?->id)],
            'restock_by_default' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function save(ReturnReason $reason, array $attributes): ReturnReason
    {
        return DB::transaction(function () use ($reason, $attributes) {
            $creating = ! $reason->exists;
            $before = $creating ? [] : $reason->only(self::FIELDS);
            if (isset($attributes['name'])) {
                $attributes['name'] = trim($attributes['name']);
            }
            $reason->fill($attributes)->save();
            [$old, $new] = Changes::between($before, $reason->only(self::FIELDS));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'return_reason.created' : 'return_reason.updated', $reason, $old, $new);
            }

            return $reason;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function present(ReturnReason $reason): array
    {
        return [
            'id' => $reason->id,
            'name' => $reason->name,
            'restock_by_default' => $reason->restock_by_default,
            'is_active' => $reason->is_active,
        ];
    }
}
