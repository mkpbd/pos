<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P1a: a size guide shown from the product page.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $name internal name
 * @property string $title
 * @property ?string $intro
 * @property array{columns: list<array{id: string, label: string}>, rows: list<array{id: string, cells: array<string, string>}>} $table
 * @property ?string $note
 * @property ?string $image_media_id
 * @property ?array<string, array<string, mixed>> $translations {bn: {title, intro, note, columns: {col: label}, cells: {row: {col: text}}}}
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'name', 'title', 'intro', 'table', 'note', 'image_media_id', 'translations'])]
class SizeGuide extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected function casts(): array
    {
        return [
            'table' => 'array',
            'translations' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
