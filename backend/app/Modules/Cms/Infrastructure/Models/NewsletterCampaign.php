<?php

namespace App\Modules\Cms\Infrastructure\Models;

use App\Modules\Cms\Domain\CampaignStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $subject
 * @property string $body
 * @property CampaignStatus $status
 * @property int $recipients_count
 * @property int $sent_count
 * @property ?string $created_by
 * @property ?string $sent_by
 * @property ?CarbonImmutable $sent_at
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['subject', 'body', 'status', 'recipients_count', 'sent_count', 'created_by', 'sent_by', 'sent_at'])]
class NewsletterCampaign extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = [
        'status' => 'draft',
        'recipients_count' => 0,
        'sent_count' => 0,
    ];

    protected function casts(): array
    {
        return [
            'status' => CampaignStatus::class,
            'recipients_count' => 'integer',
            'sent_count' => 'integer',
            'sent_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
