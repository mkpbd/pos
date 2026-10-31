<?php

namespace App\Modules\Branches\Application\Actions;

use App\Modules\Branches\Domain\StoreType;
use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Creates a branch with its default sales-floor store, so it can trade immediately.
 */
class CreateBranch
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{code: string, name: string, email?: ?string, phone?: ?string, address?: ?string, timezone?: ?string, allow_negative_stock?: bool}  $data
     */
    public function __invoke(array $data): Branch
    {
        $organizationId = $this->tenant->requireOrganization();

        return DB::transaction(function () use ($data, $organizationId) {
            $branch = Branch::query()->create([
                ...$data,
                'code' => mb_strtoupper($data['code']),
                'organization_id' => $organizationId,
            ]);

            $branch->stores()->create([
                'organization_id' => $organizationId,
                'code' => 'MAIN',
                'name' => 'Main Store',
                'type' => StoreType::Store,
            ]);

            $this->audit->record('branch.created', $branch, new: $branch->only(['code', 'name', 'allow_negative_stock']));

            return $branch;
        });
    }
}
