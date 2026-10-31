<?php

namespace App\Modules\Cms\Application\Actions;

use App\Modules\Cms\Infrastructure\Models\ContactMessage;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * Storefront contact form submissions and their handling by staff.
 */
class ContactMessages
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * Stores a visitor's message. Bot submissions (the hidden honeypot field filled in)
     * are accepted silently and dropped, so bots learn nothing.
     *
     * @param  array{name: string, email: string, phone?: ?string, subject?: ?string, message: string, website?: ?string}  $input
     */
    public function submit(array $input, ?string $ip): ?ContactMessage
    {
        if (trim((string) ($input['website'] ?? '')) !== '') {
            return null;
        }

        return ContactMessage::query()->create([
            'name' => trim($input['name']),
            'email' => mb_strtolower(trim($input['email'])),
            'phone' => isset($input['phone']) && trim($input['phone']) !== '' ? trim($input['phone']) : null,
            'subject' => isset($input['subject']) && trim($input['subject']) !== '' ? trim($input['subject']) : null,
            'message' => trim($input['message']),
            'ip' => $ip,
        ]);
    }

    public function markHandled(ContactMessage $message, bool $handled): ContactMessage
    {
        if ($handled === ($message->handled_at !== null)) {
            return $message;
        }

        return DB::transaction(function () use ($message, $handled) {
            $message->update([
                'handled_at' => $handled ? now() : null,
                'handled_by' => $handled ? Auth::id() : null,
            ]);
            $this->audit->record($handled ? 'contact_message.handled' : 'contact_message.reopened', $message);

            return $message;
        });
    }
}
