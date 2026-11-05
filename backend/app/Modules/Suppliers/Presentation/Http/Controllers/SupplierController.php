<?php

namespace App\Modules\Suppliers\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Suppliers\Application\Actions\ArchiveSupplier;
use App\Modules\Suppliers\Application\Actions\SaveSupplier;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Suppliers\Presentation\Http\Exports\SuppliersExport;
use App\Modules\Suppliers\Presentation\Http\Requests\SaveSupplierRequest;
use App\Modules\Suppliers\Presentation\Http\Resources\SupplierResource;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;

class SupplierController
{
    /**
     * List suppliers
     *
     * `search` matches code, name, phone and e-mail. Filters: `is_active`, `archived=1`.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate(['is_active' => ['sometimes', 'boolean'], 'archived' => ['sometimes', 'boolean']]);

        $query = Supplier::query()
            ->when($request->boolean('archived'), fn (Builder $q) => $q->onlyTrashed())
            ->when($request->has('is_active'), fn (Builder $q) => $q->where('is_active', $request->boolean('is_active')));

        ListQuery::apply($query, $request, sortable: ['code', 'name', 'created_at'], searchable: ['code', 'name', 'phone', 'email'], defaultSort: 'name');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, SuppliersExport::class, RowSource::fromQuery($query, fn (Collection $suppliers) => $suppliers->map(fn (Supplier $s) => new SupplierResource($s))));
        }

        return ApiResponse::paginated($query->paginate(ListQuery::perPage($request)), SupplierResource::class);
    }

    public function store(SaveSupplierRequest $request, SaveSupplier $save): JsonResponse
    {
        return ApiResponse::created(new SupplierResource($save(null, $request->validated())));
    }

    public function show(Supplier $supplier): JsonResponse
    {
        return ApiResponse::success(new SupplierResource($supplier));
    }

    public function update(SaveSupplierRequest $request, Supplier $supplier, SaveSupplier $save): JsonResponse
    {
        return ApiResponse::success(new SupplierResource($save($supplier, $request->validated())));
    }

    public function destroy(Supplier $supplier, ArchiveSupplier $archive): JsonResponse
    {
        $archive->archive($supplier);

        return ApiResponse::noContent();
    }

    public function restore(string $supplierId, ArchiveSupplier $archive): JsonResponse
    {
        return ApiResponse::success(new SupplierResource($archive->restore(Supplier::onlyTrashed()->findOrFail($supplierId))));
    }
}
