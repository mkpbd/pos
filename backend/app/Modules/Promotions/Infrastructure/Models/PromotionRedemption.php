<?php

namespace App\Modules\Promotions\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A promotion used by a placed order. Append-only.
 *
 * @property string $id
 * @property string $promotion_id
 * @property ?string $coupon_id
 * @property string $order_id
 * @property string $order_number
 * @property ?string $customer_id
 * @property ?string $customer_account_id
 * @property string $email
 * @property string $kind
 * @property string $amount
 * @property CarbonImmutable $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'promotion_id', 'coupon_id', 'order_id', 'order_number', 'customer_id', 'customer_account_id', 'email', 'kind', 'amount', 'created_at'])]
class PromotionRedemption extends Model
{
    use AppendOnly, BelongsToOrganization, ChangesStorefrontContent, HasUuids;

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'created_at' => 'immutable_datetime',
        ];
    }
}
