<?php

namespace App\Modules\Social\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Social\Application\Actions\SaveSocialSettings;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Domain\SocialMode;
use App\Modules\Social\Presentation\Http\Support\SocialPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * P2b: Marketing → Social settings.
 */
class SocialSettingsController
{
    /**
     * Social settings
     *
     * `{mode: sandbox|live, meta_app_id, secret_set, graph_version, redirect_uri (paste it into the
     * Meta app: Facebook Login → Valid OAuth Redirect URIs), live_ready, updated_at}`. The app
     * secret is never returned.
     */
    public function show(SocialConfig $config, SocialPresenter $presenter): JsonResponse
    {
        return ApiResponse::success($presenter->settings($config->settings()));
    }

    /**
     * Change social settings
     *
     * `{mode?, meta_app_id?: string|null, meta_app_secret?: string (write-only: omitted keeps it,
     * null or "" clears it), graph_version?: "v21.0"}`. Live mode needs the app id and secret
     * (422 field errors). Changing the mode disconnects the account. Audited without the secret.
     */
    public function update(Request $request, SaveSocialSettings $save, SocialPresenter $presenter): JsonResponse
    {
        $data = $request->validate([
            'mode' => ['sometimes', Rule::enum(SocialMode::class)],
            'meta_app_id' => ['sometimes', 'nullable', 'string', 'max:64', 'regex:/^\d*$/'],
            'meta_app_secret' => ['sometimes', 'nullable', 'string', 'max:255'],
            'graph_version' => ['sometimes', 'string', 'regex:/^v\d{1,2}\.\d$/'],
        ], ['meta_app_id.regex' => 'A Meta app id is a number.', 'graph_version.regex' => 'Enter a Graph API version such as v21.0.']);

        return ApiResponse::success($presenter->settings($save($data)));
    }
}
