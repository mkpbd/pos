<?php

namespace App\Modules\Social\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Social\Application\Actions\ManageSocialAccount;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Presentation\Http\Support\SocialPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * P2b: the connected Facebook Page and Instagram account.
 */
class SocialAccountController
{
    /**
     * Connected account
     *
     * `{mode, connected (an account of the current mode), sandbox, page: {id, name, picture_url}|null,
     * instagram: {id, username, picture_url}|null, pages: [{id, name, instagram: {id, username}|null}],
     * connected_at, connected_by: {id, name}|null}`. Tokens are never returned.
     */
    public function show(SocialConfig $config, SocialPresenter $presenter): JsonResponse
    {
        $settings = $config->settings();

        return ApiResponse::success($presenter->account($settings, $config->account()));
    }

    /**
     * Use another Page
     *
     * `{page_id}` — one of `pages` (else 422 `page_id`). Audited.
     */
    public function select(Request $request, ManageSocialAccount $accounts, SocialConfig $config, SocialPresenter $presenter): JsonResponse
    {
        $data = $request->validate(['page_id' => ['required', 'string', 'max:64']]);

        return ApiResponse::success($presenter->account($config->settings(), $accounts->select($data['page_id'])));
    }

    /**
     * Disconnect
     *
     * Deletes the stored Page and its tokens. Audited.
     */
    public function destroy(ManageSocialAccount $accounts): JsonResponse
    {
        $accounts->disconnect();

        return ApiResponse::noContent();
    }
}
