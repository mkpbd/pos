<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Orders\Infrastructure\Models\BlockedPhone;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BD1b: the organization's blocked mobile numbers (no cash on delivery from the shop). Numbers
 * are stored normalised (01XXXXXXXXX), once per organization. Audited:
 * `blocked_phone.added` / `blocked_phone.removed`.
 */
class BlockedPhones
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @throws ValidationException phone (not a Bangladeshi mobile number, or already blocked)
     */
    public function add(string $phone, ?string $reason, string $actorId): BlockedPhone
    {
        $normalized = BangladeshMobile::normalize($phone);
        if ($normalized === null) {
            throw ValidationException::withMessages(['phone' => ['Enter a Bangladeshi mobile number, e.g. 01712345678.']]);
        }
        $reason = $reason === null || trim($reason) === '' ? null : mb_substr(trim($reason), 0, 200);
        $organizationId = $this->tenant->requireOrganization();

        try {
            return DB::transaction(function () use ($organizationId, $normalized, $reason, $actorId) {
                if (BlockedPhone::query()->where('organization_id', $organizationId)->where('phone', $normalized)->exists()) {
                    throw self::alreadyBlocked();
                }
                $blocked = BlockedPhone::query()->create([
                    'organization_id' => $organizationId,
                    'phone' => $normalized,
                    'reason' => $reason,
                    'created_by' => $actorId,
                    'created_at' => now(),
                ]);
                $this->audit->record('blocked_phone.added', $blocked, [], ['phone' => $normalized, 'reason' => $reason]);

                return $blocked;
            });
        } catch (UniqueConstraintViolationException) {
            // Added by someone else at the same moment.
            throw self::alreadyBlocked();
        }
    }

    public function remove(BlockedPhone $blocked): void
    {
        DB::transaction(function () use ($blocked) {
            $this->audit->record('blocked_phone.removed', $blocked, ['phone' => $blocked->phone, 'reason' => $blocked->reason], []);
            $blocked->delete();
        });
    }

    private static function alreadyBlocked(): ValidationException
    {
        return ValidationException::withMessages(['phone' => ['This number is already blocked.']]);
    }
}
