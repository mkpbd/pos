<?php

namespace App\Modules\Cms\Infrastructure\Models;

use App\Modules\Cms\Domain\SubscriberStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $email
 * @property SubscriberStatus $status
 * @property ?string $confirm_token_hash
 * @property ?string $unsubscribe_token_hash
 * @property ?CarbonImmutable $confirmation_sent_at
 * @property ?CarbonImmutable $confirmed_at
 * @property ?CarbonImmutable $unsubscribed_at
 * @property ?string $ip
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'email', 'status', 'confirm_token_hash', 'unsubscribe_token_hash', 'confirmation_sent_at', 'confirmed_at', 'unsubscribed_at', 'ip'])]
class NewsletterSubscriber extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = [
        'status' => 'pending',
    ];

    protected function casts(): array
    {
        return [
            'status' => SubscriberStatus::class,
            'confirmation_sent_at' => 'immutable_datetime',
            'confirmed_at' => 'immutable_datetime',
            'unsubscribed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }
}
