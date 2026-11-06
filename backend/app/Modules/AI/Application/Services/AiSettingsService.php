<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Infrastructure\Models\AiSetting;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Support\Changes;
use Illuminate\Support\Facades\DB;

/**
 * Per-organization AI settings (`ai_settings`, created on first save): the organization switch,
 * the monthly token budget override and the data sharing level (`aggregates` only in AI1 — the
 * model receives totals, top-N lists and segment counts, never customer contact details or full
 * ledgers). Changes are audited (`ai.settings_updated`).
 */
final class AiSettingsService
{
    public const SHARING_LEVELS = ['aggregates'];

    public function __construct(private readonly AuditTrail $audit) {}

    /** The saved settings, or the defaults (unsaved) when the organization never changed them. */
    public function current(string $organizationId): AiSetting
    {
        return AiSetting::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->first()
            ?? new AiSetting(['organization_id' => $organizationId]);
    }

    /**
     * @param  array{enabled?: bool, monthly_token_budget?: ?int, data_sharing_level?: string}  $data
     */
    public function update(TenantUser $user, string $organizationId, array $data): AiSetting
    {
        return DB::transaction(function () use ($user, $organizationId, $data) {
            $setting = AiSetting::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->lockForUpdate()->first()
                ?? new AiSetting(['organization_id' => $organizationId]);
            $before = $setting->exists ? $this->snapshot($setting) : [];

            foreach (['enabled', 'monthly_token_budget', 'data_sharing_level'] as $field) {
                if (array_key_exists($field, $data)) {
                    $setting->{$field} = $data[$field];
                }
            }
            $setting->updated_by = (string) $user->getAuthIdentifier();
            $setting->save();

            $after = $this->snapshot($setting);
            [$old, $new] = Changes::between($before, $after);
            if ($old !== [] || $new !== []) {
                $this->audit->record('ai.settings_updated', $setting, $old, $new);
            }

            return $setting;
        });
    }

    /**
     * The organization's monthly budget: its override, else the application default. 0 = unlimited.
     *
     * @return array{budget: int, source: string}
     */
    public function budget(string $organizationId): array
    {
        $override = $this->current($organizationId)->monthly_token_budget;

        return $override === null
            ? ['budget' => max(0, (int) config('ai.monthly_token_budget')), 'source' => 'default']
            : ['budget' => max(0, $override), 'source' => 'organization'];
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(AiSetting $setting): array
    {
        return [
            'enabled' => (bool) $setting->enabled,
            'monthly_token_budget' => $setting->monthly_token_budget,
            'data_sharing_level' => $setting->data_sharing_level,
        ];
    }
}
