<?php

namespace App\Modules\Customers\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerDues;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * R1: due (বাকি) reminders — what a customer owes (opening balance + dues from sales, through
 * CustomerDues), the `due_reminder` text ({name} {due} {link}: the online store's account page
 * while the store is open, else nothing) in the store's language, the WhatsApp click-to-chat link
 * with that text, and queuing the SMS (purpose `due_reminder`, related to the customer).
 * Runs in the customer's organization (request or TenantContext::runAs).
 */
class DueReminders
{
    public function __construct(
        private readonly CustomerDues $dues,
        private readonly SmsSender $sms,
        private readonly StorefrontConfig $storefront,
    ) {}

    /**
     * Opening balance + dues from sales, keyed by customer id.
     *
     * @param  iterable<Customer>  $customers
     * @return array<string, string>
     */
    public function outstanding(iterable $customers): array
    {
        $list = collect($customers);
        $dues = $this->dues->dues($list->pluck('id')->all());

        return $list->mapWithKeys(fn (Customer $c) => [$c->id => Decimal::add((string) $c->opening_balance, $dues[$c->id] ?? '0', 2)])->all();
    }

    public function text(string $organizationId, Customer $customer, string $due): string
    {
        return $this->sms->renderTemplate($organizationId, SmsSender::DUE_REMINDER, $this->locale(), [
            'name' => $customer->name,
            'due' => ExportValues::grouped($due, 2),
            'link' => $this->link(),
        ]);
    }

    /** `https://wa.me/8801…?text=…` with the reminder text; null without a mobile number or a due. */
    public function whatsappUrl(Customer $customer): ?string
    {
        $phone = BangladeshMobile::normalize($customer->phone);
        if ($phone === null) {
            return null;
        }
        $due = $this->outstanding([$customer])[$customer->id];
        if (Decimal::compare($due, '0') <= 0) {
            return null;
        }

        return 'https://wa.me/88'.$phone.'?text='.rawurlencode($this->text($customer->organization_id, $customer, $due));
    }

    /** Queues the reminder to the (normalized) phone; the message id, or null when nothing was queued. */
    public function queue(Customer $customer, string $phone, string $due, ?string $dedupeKey = null): ?string
    {
        $organizationId = $customer->organization_id;

        return $this->sms->queue($organizationId, $phone, SmsSender::DUE_REMINDER, $this->text($organizationId, $customer, $due), $dedupeKey, 'customer', $customer->id);
    }

    private function link(): ?string
    {
        $site = $this->storefront->primaryUrl();

        return $site === null || ! $this->storefront->settings()->is_enabled ? null : rtrim($site, '/').'/account';
    }

    /** The store's default language (Bangla only while Bangla is on), as for digital receipts. */
    private function locale(): string
    {
        $settings = $this->storefront->settings();

        return $settings->bangla_enabled && $settings->default_locale === 'bn' ? 'bn' : 'en';
    }
}
