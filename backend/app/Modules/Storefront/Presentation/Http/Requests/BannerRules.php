<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Domain\BannerPlacement;
use App\Modules\Storefront\Presentation\Http\Rules\SafeLink;
use Illuminate\Validation\Rule;

/**
 * Validation of a banner's fields, shared by the banners API and the store builder's in-place
 * banner edit (`POST /storefront/builder/documents/{document}/banners/{banner}`).
 */
final class BannerRules
{
    /**
     * @return array<string, mixed>
     */
    public static function rules(bool $creating): array
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
