<?php

namespace App\Modules\Payments\Infrastructure\Console;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Payments\Infrastructure\Notifications\RegisterOpenNotification;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Persistence\AlertRun;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Notification;
use Throwable;

/**
 * R1: open register reminder. Scheduled hourly; register sessions open longer than
 * `alerts.register_open_hours` (0 = off) get one in-app reminder per organization-local day
 * (claim `register_open` per session) to the cashier who opened it and the users with
 * `cash_registers.view` in its branch.
 */
class SendOpenRegisterRemindersCommand extends Command
{
    protected $signature = 'payments:open-register-reminders';

    protected $description = 'Remind cashiers and managers about register sessions left open (once a day per session)';

    public function handle(OrganizationDirectory $organizations, UserDirectory $users, TenantContext $tenant): int
    {
        $sent = 0;
        foreach ($organizations->activeIds() as $organizationId) {
            $hours = $organizations->alertSettings($organizationId)['register_open_hours'];
            if ($hours <= 0) {
                continue;
            }
            $timezone = $organizations->summary($organizationId)['timezone'] ?? null;
            $local = CarbonImmutable::now(is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone'));

            try {
                $sessions = $tenant->runAs($organizationId, fn () => RegisterSession::query()->with('register')
                    ->where('status', SessionStatus::Open->value)
                    ->where('opened_at', '<=', $local->subHours($hours)->utc())
                    ->orderBy('opened_at')->get());
            } catch (Throwable $e) {
                report($e);

                continue;
            }

            foreach ($sessions as $session) {
                try {
                    $sent += $this->remind($organizationId, $session, $local, $users) ? 1 : 0;
                } catch (Throwable $e) {
                    report($e);
                }
            }
        }

        $this->info("Sent {$sent} open register reminder(s).");

        return self::SUCCESS;
    }

    private function remind(string $organizationId, RegisterSession $session, CarbonImmutable $local, UserDirectory $users): bool
    {
        $recipients = $users->active($organizationId, [$session->opened_by])
            ->concat($users->withPermissionInBranch($organizationId, 'cash_registers.view', $session->branch_id))
            ->unique(fn ($user) => $user->getAuthIdentifier())->values();

        if (! AlertRun::claim($organizationId, 'register_open', $session->id, $local->toDateString()) || $recipients->isEmpty()) {
            return false;
        }

        $openedAt = CarbonImmutable::instance($session->opened_at)->setTimezone($local->getTimezone());
        $hours = (int) $openedAt->diffInHours($local);
        $register = $session->register->name ?? 'Register';
        Notification::send($recipients, new RegisterOpenNotification([
            'title' => 'Register still open: '.$register,
            'message' => sprintf('Session %s on %s has been open for %d hours (since %s). Count the cash and close it.',
                $session->number, $register, $hours, $openedAt->format('j M, g:i A')),
            'session_id' => $session->id,
            'number' => $session->number,
            'cash_register_id' => $session->cash_register_id,
            'branch_id' => $session->branch_id,
            'opened_at' => $openedAt->toIso8601String(),
            'hours' => $hours,
            'date' => $local->toDateString(),
            'link' => '/cash-registers/sessions/'.$session->id,
        ]));

        return true;
    }
}
