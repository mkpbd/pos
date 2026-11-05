<?php

namespace App\Modules\Cms\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property ?string $group
 * @property string $question
 * @property string $answer_html
 * @property bool $is_active
 * @property int $sort_order
 * @property ?array<string, array<string, string>> $translations {"bn": {field: text}} (E12b)
 */
#[Fillable(['organization_id', 'group', 'question', 'answer_html', 'is_active', 'sort_order', 'translations'])]
class FaqItem extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_active' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'sort_order' => 'integer',
            'translations' => 'array',
        ];
    }
}
