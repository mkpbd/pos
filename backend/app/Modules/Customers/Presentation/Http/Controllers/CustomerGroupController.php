<?php

namespace App\Modules\Customers\Presentation\Http\Controllers;

use App\Modules\Customers\Infrastructure\Models\CustomerGroup;
use App\Modules\Customers\Presentation\Http\Requests\SaveCustomerGroupRequest;
use App\Modules\Customers\Presentation\Http\Resources\CustomerGroupResource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Persistence\ReferentialIntegrity;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class CustomerGroupController
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function index(): JsonResponse
    {
        return ApiResponse::success(CustomerGroupResource::collection(
            CustomerGroup::query()->withCount('customers')->orderBy('name')->get()
        ));
    }

    public function store(SaveCustomerGroupRequest $request): JsonResponse
    {
        return ApiResponse::created(new CustomerGroupResource($this->save(new CustomerGroup, $request->validated())));
    }

    public function update(SaveCustomerGroupRequest $request, CustomerGroup $customerGroup): JsonResponse
    {
        return ApiResponse::success(new CustomerGroupResource($this->save($customerGroup, $request->validated())));
    }

    /**
     * Delete a group
     *
     * Only groups without customers can be deleted (422 `IN_USE` otherwise).
     */
    public function destroy(CustomerGroup $customerGroup): JsonResponse
    {
        DB::transaction(function () use ($customerGroup) {
            ReferentialIntegrity::deleteOrFail($customerGroup, 'customer group');
            $this->audit->record('customer_group.deleted', $customerGroup, old: $customerGroup->only(['name', 'discount_percent']));
        });

        return ApiResponse::noContent();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function save(CustomerGroup $group, array $attributes): CustomerGroup
    {
        return DB::transaction(function () use ($group, $attributes) {
            $creating = ! $group->exists;
            $before = $creating ? [] : $group->only(['name', 'description', 'discount_percent']);
            $group->fill($attributes)->save();

            [$old, $new] = Changes::between($before, $group->only(['name', 'description', 'discount_percent']));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'customer_group.created' : 'customer_group.updated', $group, $old, $new);
            }

            return $group->loadCount('customers');
        });
    }
}
