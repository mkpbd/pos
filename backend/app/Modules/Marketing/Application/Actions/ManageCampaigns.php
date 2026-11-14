<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Application\Contracts\LandingPages;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Slug;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P2a: campaigns — create and change (archived instead of deleted, so their numbers stay).
 * The slug comes from the name when not given (de-duplicated), `utm_campaign` from the slug;
 * both are unique in the organization (422 field errors). The landing page must be one of the
 * organization's landing pages. Audited.
 */
class ManageCampaigns
{
    public function __construct(
        private readonly LandingPages $landingPages,
        private readonly AuditTrail $audit,
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function create(array $attributes): Campaign
    {
        $attributes = $this->dates($attributes);

        return DB::transaction(function () use ($attributes) {
            $slug = $attributes['slug'] ?? null;
            if (! is_string($slug) || $slug === '') {
                $slug = Slug::suggest((string) $attributes['name'], fn (string $c) => Campaign::query()->where('slug', $c)->exists(), 60, 'campaign');
            }
            $utm = mb_strtolower(trim((string) ($attributes['utm_campaign'] ?? '')));
            $campaign = new Campaign([
                'name' => trim((string) $attributes['name']),
                'slug' => $slug,
                'utm_campaign' => $utm === '' ? $slug : $utm,
                'landing_document_id' => $attributes['landing_document_id'] ?? null,
                'starts_at' => $attributes['starts_at'] ?? null,
                'ends_at' => $attributes['ends_at'] ?? null,
                'status' => $attributes['status'] ?? Campaign::STATUS_ACTIVE,
            ]);
            $this->check($campaign);
            $campaign->save();
            $this->audit->record('marketing.campaign_created', $campaign, [], $campaign->only(['name', 'slug', 'utm_campaign', 'landing_document_id', 'status']));

            return $campaign;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes  validated (any subset)
     */
    public function update(Campaign $campaign, array $attributes): Campaign
    {
        $attributes = $this->dates($attributes);

        return DB::transaction(function () use ($campaign, $attributes) {
            /** @var Campaign $locked */
            $locked = Campaign::query()->whereKey($campaign->id)->lockForUpdate()->firstOrFail();
            $old = $locked->only(['name', 'slug', 'utm_campaign', 'landing_document_id', 'starts_at', 'ends_at', 'status']);
            foreach (['name', 'slug', 'landing_document_id', 'starts_at', 'ends_at', 'status'] as $key) {
                if (array_key_exists($key, $attributes) && ! (in_array($key, ['name', 'slug', 'status'], true) && $attributes[$key] === null)) {
                    $locked->{$key} = is_string($attributes[$key]) && $key === 'name' ? trim($attributes[$key]) : $attributes[$key];
                }
            }
            if (array_key_exists('utm_campaign', $attributes) && is_string($attributes['utm_campaign']) && trim($attributes['utm_campaign']) !== '') {
                $locked->utm_campaign = mb_strtolower(trim($attributes['utm_campaign']));
            }
            $this->check($locked);
            if ($locked->isDirty()) {
                $locked->save();
                $this->audit->record('marketing.campaign_updated', $locked, $old, $locked->only(array_keys($old)));
            }

            return $locked;
        });
    }

    /**
     * `starts_at` / `ends_at` as instants: a plain date ("2026-04-01") is the start (resp. the
     * end) of that day in the organization's time zone; an ISO-8601 instant is kept.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function dates(array $attributes): array
    {
        $timezone = null;
        foreach (['starts_at' => false, 'ends_at' => true] as $key => $endOfDay) {
            $value = $attributes[$key] ?? null;
            if (! is_string($value) || trim($value) === '') {
                if (array_key_exists($key, $attributes)) {
                    $attributes[$key] = null;
                }

                continue;
            }
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1) {
                $timezone ??= (string) ($this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? config('app.timezone'));
                $day = CarbonImmutable::createFromFormat('!Y-m-d', $value, $timezone);
                $attributes[$key] = ($endOfDay ? $day->endOfDay()->startOfSecond() : $day->startOfDay())->setTimezone(config('app.timezone'));
            } else {
                // Stored in the application time zone (the column is written without an offset).
                $attributes[$key] = CarbonImmutable::parse($value)->setTimezone(config('app.timezone'));
            }
        }

        return $attributes;
    }

    /**
     * @throws ValidationException
     */
    private function check(Campaign $campaign): void
    {
        $errors = [];
        $others = fn () => Campaign::query()->when($campaign->exists, fn ($q) => $q->whereKeyNot($campaign->id));
        if ($campaign->isDirty('slug') && $others()->where('slug', $campaign->slug)->exists()) {
            $errors['slug'] = ['Another campaign already uses this address.'];
        }
        if ($campaign->isDirty('utm_campaign') && $others()->where('utm_campaign', $campaign->utm_campaign)->exists()) {
            $errors['utm_campaign'] = ['Another campaign already uses this campaign tag.'];
        }
        if ($campaign->isDirty('landing_document_id') && $campaign->landing_document_id !== null
            && $this->landingPages->find([$campaign->landing_document_id]) === []) {
            $errors['landing_document_id'] = ['Choose one of your landing pages.'];
        }
        if ($campaign->starts_at !== null && $campaign->ends_at !== null && $campaign->ends_at->lte($campaign->starts_at)) {
            $errors['ends_at'] = ['The end must be after the start.'];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }
}
