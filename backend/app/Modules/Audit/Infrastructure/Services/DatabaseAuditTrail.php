<?php

namespace App\Modules\Audit\Infrastructure\Services;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;

class DatabaseAuditTrail implements AuditTrail
{
    /** Attribute names that must never be written to the audit log. */
    private const REDACTED = ['password', 'remember_token', 'token', 'current_password', 'password_confirmation'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly Request $request,
    ) {}

    public function record(string $action, ?Model $subject = null, array $old = [], array $new = [], array $context = []): void
    {
        $organizationId = match (true) {
            $subject?->getTable() === 'organizations' => $subject->getKey(),
            $this->tenant->hasOrganization() => $this->tenant->organizationId(),
            default => $subject?->getAttributes()['organization_id'] ?? null,
        };

        $this->tenant->runAs($organizationId, fn () => AuditLog::query()->create([
            'organization_id' => $organizationId,
            'branch_id' => $this->tenant->branchId(),
            'user_id' => StaffActor::id(),
            'action' => $action,
            'subject_type' => $subject?->getTable(),
            'subject_id' => $subject?->getKey(),
            'old_values' => $this->clean($old),
            'new_values' => $this->clean($new),
            'context' => $context ?: null,
            'ip_address' => $this->request->ip(),
            'request_id' => Context::get('request_id'),
            'created_at' => now(),
        ]), $this->tenant->branchId());
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>|null
     */
    private function clean(array $values): ?array
    {
        $values = array_diff_key($values, array_flip(self::REDACTED));
        unset($values['updated_at'], $values['created_at'], $values['updated_by'], $values['created_by']);

        return $values === [] ? null : $values;
    }
}
