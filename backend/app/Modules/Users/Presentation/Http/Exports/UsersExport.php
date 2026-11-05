<?php

namespace App\Modules\Users\Presentation\Http\Exports;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Http\Request;

/**
 * GET /users?export=xlsx|pdf
 */
class UsersExport extends ListExport
{
    /** @var array<string, string>|null */
    private ?array $branchNames = null;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
    ) {}

    public function name(): string
    {
        return 'users';
    }

    public function title(): string
    {
        return 'Users';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('name', 'Name'),
            ExportColumn::text('email', 'E-mail'),
            ExportColumn::text('phone', 'Phone'),
            ExportColumn::text('roles', 'Roles', fn (array $r) => collect($r['roles'] ?? [])->pluck('name')->implode(', ')),
            ExportColumn::text('branch_ids', 'Branches', fn (array $r) => collect($r['branch_ids'] ?? [])->map(fn (string $id) => $this->branchName($id))->filter()->implode(', ')),
            ExportColumn::status('status', 'Status'),
            ExportColumn::dateTime('last_login_at', 'Last sign-in'),
            ExportColumn::date('created_at', 'Created'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)
            ->search()
            ->value('status', 'Status')
            ->lookup('role_id', 'Role', fn (string $id) => Role::query()->whereKey($id)->value('name'))
            ->lookup('branch_id', 'Branch', fn (string $id) => $this->branchName($id))
            ->all();
    }

    private function branchName(string $id): ?string
    {
        $this->branchNames ??= collect($this->branches->summaries($this->tenant->requireOrganization()))->pluck('name', 'id')->all();

        return $this->branchNames[$id] ?? null;
    }
}
