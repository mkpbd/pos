<?php

namespace App\Modules\Customers\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Actions\ArchiveCustomer;
use App\Modules\Customers\Application\Actions\SaveCustomer;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Customers\Presentation\Http\Requests\SaveCustomerRequest;
use App\Modules\Customers\Presentation\Http\Resources\CustomerResource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerController
{
    /**
     * List customers
     *
     * `search` matches code, name, phone and e-mail. Filters: `customer_group_id`, `is_active`, `archived=1`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'customer_group_id' => ['sometimes', 'uuid'],
            'is_active' => ['sometimes', 'boolean'],
            'archived' => ['sometimes', 'boolean'],
        ]);

        $search = $request->query('search');
        if (is_string($search) && preg_match('/^\+?[0-9 ()\-]+$/', $search)) {
            // Phone searches ignore formatting, like stored phones.
            $request->query->set('search', preg_replace('/[\s()\-]/', '', $search));
        }

        $query = Customer::query()
            ->with('group')
            ->when($request->boolean('archived'), fn (Builder $q) => $q->onlyTrashed())
            ->when($request->query('customer_group_id'), fn (Builder $q, string $id) => $q->where('customer_group_id', $id))
            ->when($request->has('is_active'), fn (Builder $q) => $q->where('is_active', $request->boolean('is_active')));

        return ApiResponse::paginated(
            ListQuery::paginate($query, $request, sortable: ['code', 'name', 'created_at'], searchable: ['code', 'name', 'phone', 'email'], defaultSort: 'name'),
            CustomerResource::class,
        );
    }

    public function store(SaveCustomerRequest $request, SaveCustomer $save): JsonResponse
    {
        return ApiResponse::created(new CustomerResource($save(null, $request->validated())->load('group')));
    }

    public function show(Customer $customer): JsonResponse
    {
        return ApiResponse::success(new CustomerResource($customer->load('group')));
    }

    public function update(SaveCustomerRequest $request, Customer $customer, SaveCustomer $save): JsonResponse
    {
        return ApiResponse::success(new CustomerResource($save($customer, $request->validated())->load('group')));
    }

    public function destroy(Customer $customer, ArchiveCustomer $archive): JsonResponse
    {
        $archive->archive($customer);

        return ApiResponse::noContent();
    }

    public function restore(string $customerId, ArchiveCustomer $archive): JsonResponse
    {
        return ApiResponse::success(new CustomerResource($archive->restore(Customer::onlyTrashed()->findOrFail($customerId))->load('group')));
    }
}
