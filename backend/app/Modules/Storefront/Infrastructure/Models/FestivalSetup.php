<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * B17: what a one-click festival setup made for an occasion and year (organization-scoped):
 * the campaign window and the drafts it created — so a repeat setup updates them. Nothing here
 * is shown to shoppers; the drafts go live through the builder's own publishing.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $occasion
 * @property int $year
 * @property CarbonImmutable $starts_at
 * @property CarbonImmutable $ends_at
 * @property ?string $landing_document_id
 * @property ?string $popup_document_id
 * @property list<string> $home_section_ids
 * @property ?string $discount_id
 */
#[Fillable(['organization_id', 'occasion', 'year', 'starts_at', 'ends_at', 'landing_document_id', 'popup_document_id', 'home_section_ids', 'discount_id'])]
class FestivalSetup extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $table = 'storefront_festival_setups';

    protected $attributes = ['home_section_ids' => '[]'];

    protected function casts(): array
    {
        return [
            'year' => 'integer',
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'home_section_ids' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
