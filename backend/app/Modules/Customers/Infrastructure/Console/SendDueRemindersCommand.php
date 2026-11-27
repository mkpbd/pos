<?php

namespace App\Modules\Customers\Infrastructure\Console;

use App\Modules\Customers\Application\Services\DueReminders;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Persistence\AlertRun;
use App\Modules\Sms\Application\Contracts\SmsSender;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * R1: scheduled due (বাকি) reminders. Scheduled hourly; an organization with
 * `alerts.due_reminders` weekly (on `due_reminder_weekday`) or monthly (on the 1st) is handled
 * from 10:00 in its own timezone, once per local day (claim `due_reminders`). Every customer with
 * a Bangladeshi mobile number who owes at least `due_reminder_min` gets the `due_reminder` SMS
 * (deduplicated per customer and day). SMS not set up or the text switched off: skipped and logged.
 */
class SendDueRemindersCommand extends Command
{
    public const LOCAL_HOUR = 10;

    protected $signature = 'customers:due-reminders {--any-hour : Ignore the 10:00 local start (manual runs)}';

    protected $description = 'Send due reminder text messages to customers who owe money (weekly or monthly)';

    public function handle(OrganizationDirectory $organizations, TenantContext $tenant, SmsSender $sms, DueReminders $reminders): int
    {
        $sent = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            try {
                $alerts = $organizations->alertSettings($organizationId);
                $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
                $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));
                $due = match ($alerts['due_reminders']) {
                    'weekly' => $local->dayOfWeekIso === $alerts['due_reminder_weekday'],
                    'monthly' => $local->day === 1,
                    default => false,
                };
                if (! $due || ($local->hour < self::LOCAL_HOUR && ! $this->option('any-hour'))) {
                    continue;
                }
                if (! $sms->ready($organizationId) || ! $sms->templateEnabled($organizationId, SmsSender::DUE_REMINDER)) {
                    Log::warning('Due reminders skipped: SMS_NOT_READY (SMS is not set up or the due reminder text is off).', ['organization_id' => $organizationId]);

                    continue;
                }
                $day = $local->toDateString();
                if (! AlertRun::claim($organizationId, 'due_reminders', $organizationId, $day)) {
                    continue;
                }

                $sent += $tenant->runAs($organizationId, fn () => $this->remind($reminders, $alerts['due_reminder_min'], $day));
            } catch (Throwable $e) {
                report($e);
            }
        }

        $this->info("Queued {$sent} due reminder(s).");

        return self::SUCCESS;
    }

    private function remind(DueReminders $reminders, string $min, string $day): int
    {
        $sent = 0;
        Customer::query()->whereNotNull('phone')->where('phone', '<>', '')
            ->chunkById(200, function (Collection $customers) use ($reminders, $min, $day, &$sent) {
                $outstanding = $reminders->outstanding($customers);
                foreach ($customers as $customer) {
                    $phone = BangladeshMobile::normalize($customer->phone);
                    $due = $outstanding[$customer->id];
                    if ($phone === null || Decimal::compare($due, '0') <= 0 || Decimal::compare($due, $min) < 0) {
                        continue;
                    }
                    try {
                        $sent += $reminders->queue($customer, $phone, $due, "due_reminder:{$customer->id}:{$day}") === null ? 0 : 1;
                    } catch (Throwable $e) {
                        report($e);
                    }
                }
            });

        return $sent;
    }
}
