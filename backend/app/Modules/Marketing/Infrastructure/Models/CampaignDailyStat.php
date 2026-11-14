<?php

namespace App\Modules\Marketing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P2a: visits of a day (organization time zone) per campaign, short link, landing path, source
 * and medium. No personal data.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $day
 * @property string $bucket
 * @property ?string $campaign_id
 * @property ?string $short_link_id
 * @property ?string $path
 * @property ?string $source
 * @property ?string $medium
 * @property int $visits
 * @property int $unique_visitors
 */
#[Fillable(['organization_id', 'day', 'bucket', 'campaign_id', 'short_link_id', 'path', 'source', 'medium', 'visits', 'unique_visitors'])]
class CampaignDailyStat extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'day' => 'date:Y-m-d',
            'visits' => 'integer',
            'unique_visitors' => 'integer',
        ];
    }
}
