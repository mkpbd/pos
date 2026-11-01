<?php

namespace App\Modules\Reviews\Infrastructure\Models;

use App\Modules\Reviews\Domain\ReviewStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A customer's review of a product, verified by a delivered order line.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $product_id
 * @property string $customer_id
 * @property string $order_line_id
 * @property int $rating
 * @property ?string $title
 * @property string $body
 * @property ReviewStatus $status
 * @property ?string $rejection_reason
 * @property ?string $moderated_by
 * @property ?CarbonImmutable $moderated_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
#[Fillable([
    'organization_id', 'product_id', 'customer_id', 'order_line_id', 'rating', 'title', 'body', 'status',
    'rejection_reason', 'moderated_by', 'moderated_at',
])]
class Review extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = [
        'status' => 'pending',
    ];

    protected function casts(): array
    {
        return [
            'rating' => 'integer',
            'status' => ReviewStatus::class,
            'moderated_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
