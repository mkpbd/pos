<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Domain\ErrorLog\ErrorText;
use App\Modules\System\Infrastructure\Mail\SystemTestMail;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * G1b: sends a plain test e-mail synchronously, so a misconfigured mailer shows its (sanitised)
 * error to the operator instead of failing later in a queue.
 */
final class SendTestMail
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(string $to): void
    {
        $mailer = (string) config('mail.default');

        try {
            Mail::to($to)->send(new SystemTestMail);
        } catch (Throwable $e) {
            $reason = ErrorText::sanitise($e->getMessage(), 500);
            $this->audit->record('system.mail_test', context: ['to' => $to, 'mailer' => $mailer, 'sent' => false, 'error' => $reason]);

            throw new BusinessRuleViolation('MAIL_FAILED', 'The test e-mail could not be sent: '.($reason !== '' ? $reason : $e::class));
        }

        $this->audit->record('system.mail_test', context: ['to' => $to, 'mailer' => $mailer, 'sent' => true]);
    }
}
