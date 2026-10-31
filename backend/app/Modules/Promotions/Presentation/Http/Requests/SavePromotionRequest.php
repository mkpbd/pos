<?php

namespace App\Modules\Promotions\Presentation\Http\Requests;

use App\Modules\Promotions\Application\Actions\SavePromotion;
use App\Modules\Promotions\Domain\PromotionScope;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Domain\PromotionType;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The shape of a promotion; SavePromotion checks how the fields go together.
 * On update every field is optional.
 */
class SavePromotionRequest extends FormRequest
{
    public function rules(): array
    {
        $creating = ! $this->route('promotion') instanceof Promotion;
        $required = $creating ? 'required' : 'sometimes';
        $money = ['numeric', 'min:0', 'max:99999999', 'decimal:0,2'];

        return [
            'name' => [$required, 'string', 'max:80'],
            'description' => ['sometimes', 'nullable', 'string', 'max:200'],
            'type' => [$required, Rule::enum(PromotionType::class)],
            'value' => ['sometimes', 'nullable', ...$money],
            'scope' => [$required, Rule::enum(PromotionScope::class)],
            'target_ids' => ['sometimes', 'array', 'max:'.SavePromotion::MAX_TARGETS],
            'target_ids.*' => ['uuid', 'distinct'],
            'min_subtotal' => ['sometimes', 'nullable', ...$money],
            'max_discount' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:99999999', 'decimal:0,2'],
            'trigger' => [$required, Rule::enum(PromotionTrigger::class)],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'show_countdown' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'usage_limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000000'],
            'usage_limit_per_customer' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000000'],
            'coupon_code' => [$creating ? 'sometimes' : 'prohibited', 'nullable', 'string', 'max:40'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function promotionData(): array
    {
        $data = $this->validated();
        foreach (['show_countdown', 'is_active'] as $flag) {
            if (array_key_exists($flag, $data)) {
                $data[$flag] = $this->boolean($flag);
            }
        }
        foreach (['usage_limit', 'usage_limit_per_customer'] as $int) {
            if (isset($data[$int])) {
                $data[$int] = (int) $data[$int];
            }
        }
        foreach (['value', 'min_subtotal', 'max_discount'] as $money) {
            if (isset($data[$money])) {
                $data[$money] = (string) $data[$money];
            }
        }
        if (array_key_exists('coupon_code', $data) && blank($data['coupon_code'])) {
            unset($data['coupon_code']);
        }

        return $data;
    }
}
