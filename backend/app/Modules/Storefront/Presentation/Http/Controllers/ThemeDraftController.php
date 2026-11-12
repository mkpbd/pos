<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\ManageThemeDraft;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Presentation\Http\Requests\SaveThemeDraftRequest;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use App\Modules\Storefront\Presentation\Http\Support\StorefrontPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * B3: the theme draft — edited like a builder page (draft with revision, publish to a new
 * version, discard, restore). The live store's theme changes only on publish. Reading needs
 * storefront.view, editing storefront.manage, publishing also storefront.publish.
 */
class ThemeDraftController
{
    public function __construct(
        private readonly ManageThemeDraft $theme,
        private readonly StorefrontConfig $config,
    ) {}

    /**
     * Theme draft
     *
     * `{settings, draft_revision, has_unpublished_changes, draft_updated_at, published:
     * {version_id, number, published_at}|null, preview_url, custom_css, has_custom_css}`.
     * Before the first draft the draft is the live theme at revision 0. Custom CSS is not
     * drafted (`PUT /storefront/theme/custom-css` stays immediate); `custom_css` is only
     * returned to holders of `storefront.custom_css`.
     */
    public function show(Request $request): JsonResponse
    {
        return $this->payload($request);
    }

    /**
     * Save the theme draft
     *
     * `{revision, settings}`: the whole theme document, validated like `PUT /storefront/theme`
     * (omitted keys take their defaults; media must exist, `MEDIA_NOT_FOUND`). A stale revision
     * is 409 DRAFT_CONFLICT with `details.revision`. Not live until published.
     */
    public function save(SaveThemeDraftRequest $request): JsonResponse
    {
        $this->theme->saveDraft((int) $request->validated('revision'), $request->settings());

        return $this->payload($request);
    }

    /**
     * Publish the theme draft
     *
     * `{note?}` (≤ 160). The draft becomes the live theme (audited, storefront cache refreshed)
     * and a new version; the first publish first records the theme that was live before as
     * version 1.
     */
    public function publish(Request $request): JsonResponse
    {
        $note = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:160']])['note'] ?? null;
        $this->theme->publish($note);

        return $this->payload($request);
    }

    /**
     * Discard the theme draft
     *
     * The draft goes back to the live theme.
     */
    public function discard(Request $request): JsonResponse
    {
        $this->theme->discard();

        return $this->payload($request);
    }

    /**
     * Theme version history
     *
     * Newest first (empty before the first publish).
     */
    public function versions(): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::versions($this->theme->versions()));
    }

    /**
     * Restore a theme version
     *
     * Copies it into the draft (newer keys take their defaults); it goes live when published.
     * A version that is not one of this organization's theme versions: 404.
     */
    public function restore(Request $request, string $version): JsonResponse
    {
        $this->theme->restore($version);

        return $this->payload($request);
    }

    /**
     * Apply a theme preset
     *
     * B3: puts the preset's colours, fonts, shape and layout over the **draft** (logo, favicon,
     * announcement, footer and palette are kept); publish to make it live. Returns the draft
     * (as `GET /storefront/theme/draft`). Unknown preset: 404.
     */
    public function applyPreset(Request $request, string $preset): JsonResponse
    {
        $this->theme->applyPreset($preset);

        return $this->payload($request);
    }

    private function payload(Request $request): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::themeDraft(
            $this->theme->state(),
            $this->config->theme(),
            $request->user()->can('storefront.custom_css'),
            $this->config->primaryUrl(),
        ))->header('Cache-Control', 'no-store, private');
    }
}
