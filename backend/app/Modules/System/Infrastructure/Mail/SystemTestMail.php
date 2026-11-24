<?php

namespace App\Modules\System\Infrastructure\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * G1b: plain test e-mail from System status → "Send test e-mail" (sent synchronously).
 */
class SystemTestMail extends Mailable
{
    public function envelope(): Envelope
    {
        return new Envelope(subject: config('app.name').': test e-mail');
    }

    public function content(): Content
    {
        return new Content(htmlString: '<p>This is a test e-mail from '.e((string) config('app.name')).'.</p>'
            .'<p>If you can read it, outgoing e-mail works (mailer: '.e((string) config('mail.default')).', sent '.e(now()->toIso8601String()).').</p>');
    }
}
