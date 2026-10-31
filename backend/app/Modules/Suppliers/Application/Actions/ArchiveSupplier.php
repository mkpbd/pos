<?php

namespace App\Modules\Suppliers\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use Illuminate\Support\Facades\DB;

/**
 * Archived suppliers disappear from pick lists but stay referenced by past purchases.
 */
class ArchiveSupplier
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function archive(Supplier $supplier): void
    {
        DB::transaction(function () use ($supplier) {
            $supplier->delete();
            $this->audit->record('supplier.archived', $supplier, old: ['code' => $supplier->code, 'name' => $supplier->name]);
        });
    }

    public function restore(Supplier $supplier): Supplier
    {
        return DB::transaction(function () use ($supplier) {
            $supplier->restore();
            $this->audit->record('supplier.restored', $supplier, new: ['code' => $supplier->code, 'name' => $supplier->name]);

            return $supplier;
        });
    }
}
