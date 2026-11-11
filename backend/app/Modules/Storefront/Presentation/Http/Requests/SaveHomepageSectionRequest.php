<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Storefront\Domain\SectionConfigRules;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A homepage section. The config rules depend on the section's type, which is given on
 * creation and fixed afterwards. On update, a sent `config` replaces the whole config.
 */
class SaveHomepageSectionRequest extends FormRequest
{
    public function rules(): array
    {
        $section = $this->route('section');
        $creating = ! $section instanceof HomepageSection;
        $type = $creating ? SectionType::tryFrom((string) $this->input('type')) : $section->type;

        $rules = [
            'type' => $creating ? ['required', Rule::enum(SectionType::class)] : ['prohibited'],
            'title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_enabled' => ['sometimes', 'boolean'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
        ];

        if ($type === null) {
            return $rules;
        }

        if ($type->itemLimits() !== null) {
            $rules['banner_ids'] = [$creating ? 'required' : 'sometimes', 'array', 'max:'.$type->itemLimits()['max']];
            $rules['banner_ids.*'] = ['uuid', 'distinct'];
        } else {
            $rules['banner_ids'] = ['prohibited'];
        }

        // Hand-picked products, categories or brands (used when the config's source is `manual`).
        if (($manual = $type->manualItemLimits()) !== null) {
            $rules['item_ids'] = ['sometimes', 'array', 'max:'.$manual['max']];
            $rules['item_ids.*'] = ['uuid', 'distinct'];
        } else {
            $rules['item_ids'] = ['prohibited'];
        }

        // E12b: {bn: {title, subtitle, …the type's config texts}}.
        $rules += TranslationInput::rules($type->translatable());

        $rules['config'] = [$creating && SectionConfigRules::requiresConfig($type) ? 'required' : 'sometimes', 'array'];

        // The config's value rules are shared with the store builder's section elements (B1).
        return $rules + SectionConfigRules::for($type);
    }

    public function messages(): array
    {
        return ['type.prohibited' => 'A section\'s type cannot change. Add a new section instead.'];
    }
}
