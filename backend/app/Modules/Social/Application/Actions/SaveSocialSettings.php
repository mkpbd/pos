<?php

namespace App\Modules\Social\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Domain\SocialMode;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use App\Modules\Social\Infrastructure\Models\SocialSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P2b: social settings — mode, Meta app id, app secret (write-only: omitted keeps it, null or ""
 * clears it) and Graph API version. Live mode needs the app id and secret. Changing the mode
 * disconnects the account (a sandbox Page never publishes live, a live Page never in the
 * sandbox). Audited without the secret (only whether it changed).
 */
class SaveSocialSettings
{
    public function __construct(
        private readonly SocialConfig $config,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{mode?: string, meta_app_id?: ?string, meta_app_secret?: ?string, graph_version?: string}  $attributes  validated
     */
    public function __invoke(array $attributes): SocialSettings
    {
        return DB::transaction(function () use ($attributes) {
            $settings = $this->config->settings();
            $before = $settings->exists ? $this->snapshot($settings) : [];
            $oldMode = $settings->exists ? $settings->mode : null;
            $oldSecret = $settings->meta_app_secret;

            if (isset($attributes['mode'])) {
                $settings->mode = SocialMode::from($attributes['mode']);
            }
            if (array_key_exists('meta_app_id', $attributes)) {
                $id = trim((string) $attributes['meta_app_id']);
                $settings->meta_app_id = $id === '' ? null : $id;
            }
            if (array_key_exists('meta_app_secret', $attributes)) {
                $secret = trim((string) $attributes['meta_app_secret']);
                $settings->meta_app_secret = $secret === '' ? null : $secret;
            }
            if (isset($attributes['graph_version'])) {
                $settings->graph_version = $attributes['graph_version'];
            }

            if ($settings->mode === SocialMode::Live && ! $settings->liveReady()) {
                $errors = [];
                if (! is_string($settings->meta_app_id) || $settings->meta_app_id === '') {
                    $errors['meta_app_id'] = ['Enter your Meta app id to post for real (live mode).'];
                }
                if (! is_string($settings->meta_app_secret) || $settings->meta_app_secret === '') {
                    $errors['meta_app_secret'] = ['Enter your Meta app secret to post for real (live mode).'];
                }
                throw ValidationException::withMessages($errors);
            }

            $secretChanged = $settings->meta_app_secret !== $oldSecret;
            $settings->save();

            // The connected account belongs to the other mode now.
            $modeChanged = $oldMode !== null ? $oldMode !== $settings->mode : $settings->mode !== SocialMode::Sandbox;
            $account = SocialAccount::query()->first();
            if ($modeChanged && $account !== null) {
                $this->audit->record('social.disconnected', $account, ['page_id' => $account->page_id, 'page_name' => $account->page_name], [], ['reason' => 'mode_changed']);
                $account->delete();
            }

            [$old, $new] = Changes::between($before, $this->snapshot($settings));
            if ($new !== [] || $secretChanged) {
                $this->audit->record('social.settings_updated', $settings, $old, $new, $secretChanged ? ['secret_changed' => true] : []);
            }

            return $settings;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(SocialSettings $settings): array
    {
        return [
            'mode' => $settings->mode->value,
            'meta_app_id' => $settings->meta_app_id,
            'graph_version' => $settings->graph_version,
            'secret_set' => is_string($settings->meta_app_secret) && $settings->meta_app_secret !== '',
        ];
    }
}
