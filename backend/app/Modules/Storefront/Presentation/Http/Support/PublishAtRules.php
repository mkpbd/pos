<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Storefront\Infrastructure\Models\BuilderSchedule;
use Carbon\CarbonImmutable;

/**
 * B11: validation of "publish later" times — an ISO date-time in the future, at most a year ahead.
 */
final class PublishAtRules
{
    /**
     * @return array<string, list<string>>
     */
    public static function rules(bool $required): array
    {
        return [
            'publish_at' => [$required ? 'required' : 'sometimes', ...($required ? [] : ['nullable']), 'date', 'after:now',
                'before_or_equal:'.CarbonImmutable::now()->addDays(BuilderSchedule::MAX_DAYS_AHEAD)->toIso8601String()],
            'note' => ['sometimes', 'nullable', 'string', 'max:160'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function messages(): array
    {
        return [
            'publish_at.after' => 'Choose a time in the future.',
            'publish_at.before_or_equal' => 'Choose a time within the next year.',
        ];
    }
}
