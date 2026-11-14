<?php

namespace App\Modules\Reviews\Infrastructure\Models;

use App\Modules\Reviews\Domain\QuestionStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P1b: a shopper's question about a product and the staff answer.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $product_id
 * @property ?string $customer_account_id
 * @property string $name
 * @property string $email
 * @property string $question
 * @property ?string $answer
 * @property ?string $answered_by
 * @property ?CarbonImmutable $answered_at
 * @property QuestionStatus $status
 * @property string $locale
 * @property string $site_url
 * @property ?CarbonImmutable $answer_notified_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
#[Fillable([
    'organization_id', 'product_id', 'customer_account_id', 'name', 'email', 'question', 'answer', 'answered_by',
    'answered_at', 'status', 'locale', 'site_url', 'answer_notified_at',
])]
class ProductQuestion extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = [
        'status' => 'pending',
    ];

    protected function casts(): array
    {
        return [
            'status' => QuestionStatus::class,
            'answered_at' => 'immutable_datetime',
            'answer_notified_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
