<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Requests;

use App\Modules\OnlineCatalog\Application\Actions\ManageSizeGuides;
use Illuminate\Foundation\Http\FormRequest;

/**
 * P1a: a size guide (full replace). Ids of columns and rows are chosen by the client.
 */
class SaveSizeGuideRequest extends FormRequest
{
    public function rules(): array
    {
        $id = ['required', 'string', 'regex:'.ManageSizeGuides::ID_PATTERN];

        return [
            'name' => ['required', 'string', 'max:100'],
            'title' => ['required', 'string', 'max:120'],
            'intro' => ['nullable', 'string', 'max:1000'],
            'note' => ['nullable', 'string', 'max:1000'],
            'image_media_id' => ['nullable', 'uuid'],
            'columns' => ['required', 'array', 'min:1', 'max:'.ManageSizeGuides::MAX_COLUMNS],
            'columns.*.id' => $id,
            'columns.*.label' => ['required', 'string', 'max:60'],
            'rows' => ['present', 'array', 'max:'.ManageSizeGuides::MAX_ROWS],
            'rows.*.id' => $id,
            'rows.*.cells' => ['present', 'array'],
            'rows.*.cells.*' => ['nullable', 'string', 'max:120'],
            'category_ids' => ['sometimes', 'array', 'max:500'],
            'category_ids.*' => ['uuid', 'distinct'],
            'translations' => ['sometimes', 'nullable', 'array:bn'],
            'translations.bn' => ['sometimes', 'nullable', 'array:title,intro,note,columns,cells'],
            'translations.bn.title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'translations.bn.intro' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'translations.bn.note' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'translations.bn.columns' => ['sometimes', 'nullable', 'array', 'max:'.ManageSizeGuides::MAX_COLUMNS],
            'translations.bn.columns.*' => ['nullable', 'string', 'max:60'],
            'translations.bn.cells' => ['sometimes', 'nullable', 'array', 'max:'.ManageSizeGuides::MAX_ROWS],
            'translations.bn.cells.*' => ['array', 'max:'.ManageSizeGuides::MAX_COLUMNS],
            'translations.bn.cells.*.*' => ['nullable', 'string', 'max:120'],
        ];
    }

    /**
     * Validated data with list order kept.
     *
     * @return array<string, mixed>
     */
    public function guideData(): array
    {
        $data = $this->validated();
        foreach (['columns', 'rows', 'category_ids'] as $key) {
            if (isset($data[$key])) {
                ksort($data[$key]);
                $data[$key] = array_values($data[$key]);
            }
        }

        return $data;
    }
}
