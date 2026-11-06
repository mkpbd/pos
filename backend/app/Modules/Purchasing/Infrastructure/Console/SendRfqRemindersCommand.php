<?php

namespace App\Modules\Purchasing\Infrastructure\Console;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqReminderRun;
use App\Modules\Purchasing\Infrastructure\Models\RfqSupplier;
use App\Modules\Purchasing\Infrastructure\Notifications\ProcurementNotification;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Throwable;

/**
 * Daily "quotes overdue" reminder (SC2). Scheduled hourly; an organization is handled from
 * 07:00 in its own timezone. Every sent RFQ whose reply-by date has passed (organization's
 * local day) while invited suppliers have not answered gets one in-app notification per day
 * for its creator. The day's run is claimed first (unique RFQ + day), so repeated or
 * overlapping runs never notify twice.
 */
class SendRfqRemindersCommand extends Command
{
    public const LOCAL_HOUR = 7;

    protected $signature = 'purchasing:rfq-reminders {--any-hour : Ignore the 07:00 local start (manual runs)}';

    protected $description = 'Remind RFQ creators about suppliers that have not quoted by the reply-by date (once a day per RFQ)';

    public function handle(OrganizationDirectory $organizations, UserDirectory $users, TenantContext $tenant): int
    {
        $sent = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
            $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));
            if ($local->hour < self::LOCAL_HOUR && ! $this->option('any-hour')) {
                continue;
            }
            $day = $local->toDateString();

            try {
                $sent += $tenant->runAs($organizationId, fn () => $this->remind($organizationId, $day, $users));
            } catch (Throwable $e) {
                report($e);
            }
        }

        $this->info("Sent {$sent} RFQ reminder(s).");

        return self::SUCCESS;
    }

    private function remind(string $organizationId, string $day, UserDirectory $users): int
    {
        $sent = 0;
        $overdue = Rfq::query()
            ->where('status', RfqStatus::Sent->value)
            ->whereNotNull('reply_by')
            ->where('reply_by', '<', $day)
            ->get();

        foreach ($overdue as $rfq) {
            $missing = $rfq->suppliers()->whereDoesntHave('quote')->get();
            if ($missing->isEmpty() || $rfq->created_by === null) {
                continue;
            }
            $claimed = RfqReminderRun::query()->insertOrIgnore([
                'id' => (string) Str::uuid7(),
                'organization_id' => $organizationId,
                'rfq_id' => $rfq->id,
                'run_on' => $day,
                'missing' => $missing->count(),
                'created_at' => now(),
            ]) === 1;
            $recipients = $users->active($organizationId, [$rfq->created_by]);
            if (! $claimed || $recipients->isEmpty()) {
                continue;
            }

            $count = $missing->count();
            Notification::send($recipients, new ProcurementNotification('purchasing.rfq_replies_overdue', [
                'title' => "Quotes overdue: {$rfq->number}",
                'message' => sprintf('%d %s not answered %s (reply by %s).', $count, $count === 1 ? 'supplier has' : 'suppliers have', $rfq->number, $rfq->reply_by?->toDateString()),
                'rfq_id' => $rfq->id,
                'number' => $rfq->number,
                'missing' => $count,
                'supplier_ids' => $missing->map(fn (RfqSupplier $s) => $s->supplier_id)->values()->all(),
                'date' => $day,
                'link' => '/purchasing/rfqs/'.$rfq->id,
            ]));
            $sent++;
        }

        return $sent;
    }
}
