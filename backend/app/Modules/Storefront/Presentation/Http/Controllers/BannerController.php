<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Domain\BannerPlacement;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Presentation\Http\Rules\SafeLink;
use App\Modules\Storefront\Presentation\Http\Support\ContentPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class BannerController
{
    /**
     * List banners
     *
     * All banners in display order, optionally of one `?placement=hero_slider|home_promo|popup`.
     * `is_live` tells whether a banner is active and inside its schedule now.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['placement' => ['sometimes', Rule::enum(BannerPlacement::class)]]);

        return ApiResponse::success(Banner::query()
            ->when($request->query('placement'), fn (Builder $q, string $placement) => $q->where('placement', $placement))
            ->orderBy('placement')->orderBy('sort_order')->get()
            ->map(fn (Banner $b) => ContentPresenter::banner($b))->all());
    }

    public function show(Banner $banner): JsonResponse
    {
        return ApiResponse::success(ContentPresenter::banner($banner));
    }

    /**
     * Create a banner
     *
     * Links are site paths (`/sale`) or http(s) URLs. A button label needs its link; a link
     * without a label makes the whole banner clickable. Popups (E11) also take
     * `popup_delay_seconds` (0–60, default 5) and `popup_frequency` (once_per_session |
     * once_per_day | once_per_week, default once_per_day); other placements store null.
     */
    public function store(Request $request, ManageBanners $banners): JsonResponse
    {
        return ApiResponse::created(ContentPresenter::banner($banners->save(new Banner, $request->validate($this->rules(true)))));
    }

    public function update(Request $request, Banner $banner, ManageBanners $banners): JsonResponse
    {
        return ApiResponse::success(ContentPresenter::banner($banners->save($banner, $request->validate($this->rules(false)))));
    }

    /**
     * Delete a banner
     *
     * `IN_USE` while a homepage section shows it (`details.sections`).
     */
    public function destroy(Banner $banner, ManageBanners $banners): JsonResponse
    {
        $banners->delete($banner);

        return ApiResponse::noContent();
    }

    /**
     * Reorder banners
     *
     * Every banner id of the placement exactly once, in the new order.
     */
    public function reorder(Request $request, ManageBanners $banners): JsonResponse
    {
        $data = $request->validate([
            'placement' => ['required', Rule::enum(BannerPlacement::class)],
            'ids' => ['present', 'array', 'max:'.ManageBanners::MAX_PER_PLACEMENT],
            'ids.*' => ['uuid', 'distinct'],
        ]);
        $banners->reorder(BannerPlacement::from($data['placement']), $data['ids']);

        return $this->index($request);
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'placement' => [$required, Rule::enum(BannerPlacement::class)],
            'name' => [$required, 'string', 'max:80'],
            'kicker' => ['sometimes', 'nullable', 'string', 'max:60'],
            'title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'link_url' => ['sometimes', 'nullable', new SafeLink],
            'button_label' => ['sometimes', 'nullable', 'string', 'max:40'],
            'secondary_link_url' => ['sometimes', 'nullable', new SafeLink],
            'secondary_button_label' => ['sometimes', 'nullable', 'string', 'max:40'],
            'desktop_media_id' => [$required, 'uuid'],
            'mobile_media_id' => ['sometimes', 'nullable', 'uuid'],
            'text_color' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'text_position' => ['sometimes', Rule::in(['left', 'center', 'right'])],
            // Popups only (E11); ignored for other placements.
            'popup_delay_seconds' => ['sometimes', 'nullable', 'integer', 'between:0,60'],
            'popup_frequency' => ['sometimes', 'nullable', Rule::in(BannerPlacement::POPUP_FREQUENCIES)],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
            // E12b: {bn: {kicker, title, subtitle, button_label, secondary_button_label}}.
            ...TranslationInput::rules(ManageBanners::TRANSLATABLE),
        ];
    }
}
