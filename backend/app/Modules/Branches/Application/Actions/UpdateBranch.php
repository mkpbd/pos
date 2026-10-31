<?php

namespace App\Modules\Branches\Application\Actions;

use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

class UpdateBranch
{
    private const AUDITED = ['code', 'name', 'email', 'phone', 'address', 'timezone', 'is_active', 'allow_negative_stock'];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array<string, mixed>  $changes  validated partial attributes
     */
    public function __invoke(Branch $branch, array $changes): Branch
    {
        return DB::transaction(function () use ($branch, $changes) {
            $before = $branch->only(self::AUDITED);

            if (isset($changes['code'])) {
                $changes['code'] = mb_strtoupper($changes['code']);
            }
            $branch->fill($changes);

            if ($branch->isDirty('is_active') && ! $branch->is_active) {
                $otherActive = Branch::query()->whereKeyNot($branch->id)->where('is_active', true)->lockForUpdate()->first(['id']);
                if ($otherActive === null) {
                    throw new BusinessRuleViolation('LAST_ACTIVE_BRANCH', 'An organization must keep at least one active branch.');
                }
            }

            $branch->save();

            [$old, $new] = Changes::between($before, $branch->only(self::AUDITED));
            if ($new !== []) {
                $this->audit->record('branch.updated', $branch, $old, $new);
            }

            return $branch;
        });
    }
}
