<?php

namespace App\Modules\Organizations\Application\Contracts;

/**
 * Read access to organizations for other modules.
 */
interface OrganizationDirectory
{
    public function isActive(string $organizationId): bool;

    /**
     * Ids of all active (not suspended) organizations, for scheduled per-tenant jobs.
     *
     * @return list<string>
     */
    public function activeIds(): array;

    /**
     * Profile plus the document settings other modules print (invoice prefix, receipt texts)
     * and the contact details printed on documents (E10a: legal name, tax/BIN number, e-mail,
     * phone, address).
     *
     * @return array{id: string, name: string, slug: string, base_currency: string, timezone: string, tax_mode: string, status: string, invoice_prefix: ?string, receipt_header: ?string, receipt_footer: ?string, legal_name: ?string, tax_number: ?string, email: ?string, phone: ?string, address: ?string}|null
     */
    public function summary(string $organizationId): ?array;

    /**
     * G1a: who must use two-factor sign-in — `optional` (default), `admins` or `everyone`.
     */
    public function twoFactorPolicy(string $organizationId): string;

    /**
     * R1: the scheduled alert and due reminder settings with their defaults (see AlertSettings).
     *
     * @return array{daily_summary: bool, daily_summary_hour: int, expiry_alert_days: int, register_open_hours: int, due_reminders: string, due_reminder_min: string, due_reminder_weekday: int}
     */
    public function alertSettings(string $organizationId): array;
}
