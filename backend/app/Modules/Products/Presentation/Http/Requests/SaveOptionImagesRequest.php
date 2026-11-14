<?php

namespace App\Modules\Products\Presentation\Http\Requests;

use App\Modules\Products\Application\Actions\SaveOptionImages;
use Illuminate\Foundation\Http\FormRequest;

/**
 * P1a: photos by colour and option swatch styles (rules against the product in SaveOptionImages).
 */
class SaveOptionImagesRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'photo_option' => ['present', 'nullable', 'string', 'max:50'],
            'styles' => ['sometimes', 'nullable', 'array', 'max:3'],
            'styles.*' => ['nullable', 'string'],
            'values' => ['sometimes', 'nullable', 'array', 'max:50'],
            'values.*.value' => ['required', 'string', 'max:50'],
            'values.*.image_ids' => ['present', 'array', 'max:'.SaveOptionImages::MAX_IMAGES_PER_VALUE],
            'values.*.image_ids.*' => ['uuid'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function optionData(): array
    {
        $data = $this->validated();
        if (is_array($data['values'] ?? null)) {
            ksort($data['values']);
            $data['values'] = array_map(function (array $v) {
                ksort($v['image_ids']);
                $v['image_ids'] = array_values($v['image_ids']);

                return $v;
            }, array_values($data['values']));
        }

        return $data;
    }
}
