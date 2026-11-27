<?php

namespace App\Modules\Organizations\Presentation\Http\Requests;

use App\Modules\Organizations\Domain\AlertSettings;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateAlertSettingsRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'daily_summary' => ['sometimes', 'boolean'],
            'daily_summary_hour' => ['sometimes', 'integer', 'between:0,23'],
            'expiry_alert_days' => ['sometimes', 'integer', 'between:0,365'],
            'register_open_hours' => ['sometimes', 'integer', 'between:0,168'],
            'due_reminders' => ['sometimes', 'string', Rule::in(AlertSettings::DUE_REMINDER_SCHEDULES)],
            'due_reminder_min' => ['sometimes', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'],
            'due_reminder_weekday' => ['sometimes', 'integer', 'between:1,7'],
        ];
    }
}
