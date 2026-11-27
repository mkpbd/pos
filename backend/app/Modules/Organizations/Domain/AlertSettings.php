<?php

namespace App\Modules\Organizations\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * R1: scheduled alerts and due reminders, kept in `organizations.settings.alerts`.
 *
 * - daily_summary / daily_summary_hour: the owners' daily summary from that local hour;
 * - expiry_alert_days: batches expiring within that many days (0 = off);
 * - register_open_hours: register sessions open longer than that (0 = off);
 * - due_reminders (off | weekly | monthly), due_reminder_min (amount), due_reminder_weekday
 *   (ISO 1 = Monday … 7 = Sunday): scheduled SMS reminders to customers who owe money.
 */
final class AlertSettings
{
    public const DUE_REMINDER_SCHEDULES = ['off', 'weekly', 'monthly'];

    public const DEFAULTS = [
        'daily_summary' => true,
        'daily_summary_hour' => 21,
        'expiry_alert_days' => 30,
        'register_open_hours' => 14,
        'due_reminders' => 'off',
        'due_reminder_min' => '100.00',
        'due_reminder_weekday' => 6,
    ];

    /**
     * The saved settings over the defaults, typed (an unknown key is dropped).
     *
     * @return array{daily_summary: bool, daily_summary_hour: int, expiry_alert_days: int, register_open_hours: int, due_reminders: string, due_reminder_min: string, due_reminder_weekday: int}
     */
    public static function effective(mixed $saved): array
    {
        $values = array_replace(self::DEFAULTS, array_intersect_key(is_array($saved) ? $saved : [], self::DEFAULTS));
        $schedule = (string) $values['due_reminders'];
        $min = is_numeric($values['due_reminder_min']) ? Decimal::round((string) $values['due_reminder_min'], 2) : self::DEFAULTS['due_reminder_min'];

        return [
            'daily_summary' => (bool) $values['daily_summary'],
            'daily_summary_hour' => (int) $values['daily_summary_hour'],
            'expiry_alert_days' => (int) $values['expiry_alert_days'],
            'register_open_hours' => (int) $values['register_open_hours'],
            'due_reminders' => in_array($schedule, self::DUE_REMINDER_SCHEDULES, true) ? $schedule : 'off',
            'due_reminder_min' => $min,
            'due_reminder_weekday' => (int) $values['due_reminder_weekday'],
        ];
    }
}
