<?php

namespace App\Modules\Shared\Infrastructure\Persistence;

use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * R1: the claim of one scheduled alert (kind + subject + organization-local day). Claiming is
 * an insert on the unique key, so only one of overlapping or repeated runs wins.
 *
 * @property string $id
 * @property string $kind daily_summary | expiry_alert | register_open | due_reminders
 * @property string $subject_id
 * @property string $run_on
 */
#[Table(name: 'alert_runs', timestamps: false)]
class AlertRun extends Model
{
    use HasUuids;

    protected $guarded = [];

    /** True when this call claimed the day's alert (false: already claimed). */
    public static function claim(string $organizationId, string $kind, string $subjectId, string $day): bool
    {
        return static::query()->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'organization_id' => $organizationId,
            'kind' => $kind,
            'subject_id' => $subjectId,
            'run_on' => $day,
            'created_at' => now(),
        ]) === 1;
    }

    public static function claimed(string $kind, string $subjectId, string $day): bool
    {
        return static::query()->where('kind', $kind)->where('subject_id', $subjectId)->where('run_on', $day)->exists();
    }
}
