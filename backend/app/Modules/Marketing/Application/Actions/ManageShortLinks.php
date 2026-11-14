<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\CampaignAttribution;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * P2a: short links — create (a random six-character code when none is given), change and
 * delete. The code is unique in the organization (422 errors.code); the campaign must be the
 * organization's. UTM values are trimmed; source, medium and campaign lower-cased. Audited.
 */
class ManageShortLinks
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function create(array $attributes): ShortLink
    {
        return DB::transaction(function () use ($attributes) {
            $link = new ShortLink(['clicks' => 0, 'active' => $attributes['active'] ?? true]);
            $link->code = is_string($attributes['code'] ?? null) && $attributes['code'] !== '' ? mb_strtolower($attributes['code']) : $this->randomCode();
            $this->fill($link, $attributes);
            $this->check($link);
            $link->save();
            $this->audit->record('marketing.short_link_created', $link, [], $link->only(['code', 'target_path', 'campaign_id', 'active']));

            return $link;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes  validated (any subset)
     */
    public function update(ShortLink $link, array $attributes): ShortLink
    {
        return DB::transaction(function () use ($link, $attributes) {
            /** @var ShortLink $locked */
            $locked = ShortLink::query()->whereKey($link->id)->lockForUpdate()->firstOrFail();
            $old = $locked->only(['code', 'target_path', 'campaign_id', 'active', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
            if (is_string($attributes['code'] ?? null) && $attributes['code'] !== '') {
                $locked->code = mb_strtolower($attributes['code']);
            }
            if (array_key_exists('active', $attributes)) {
                $locked->active = (bool) $attributes['active'];
            }
            $this->fill($locked, $attributes);
            $this->check($locked);
            if ($locked->isDirty()) {
                $locked->save();
                $this->audit->record('marketing.short_link_updated', $locked, $old, $locked->only(array_keys($old)));
            }

            return $locked;
        });
    }

    public function delete(ShortLink $link): void
    {
        DB::transaction(function () use ($link) {
            $this->audit->record('marketing.short_link_deleted', $link, $link->only(['code', 'target_path', 'campaign_id', 'clicks']), []);
            $link->delete();
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function fill(ShortLink $link, array $attributes): void
    {
        if (array_key_exists('target_path', $attributes)) {
            $link->target_path = trim((string) $attributes['target_path']);
        }
        if (array_key_exists('campaign_id', $attributes)) {
            $link->campaign_id = $attributes['campaign_id'] === null ? null : strtolower((string) $attributes['campaign_id']);
        }
        if (is_array($attributes['utm'] ?? null)) {
            foreach (ShortLink::UTM as $key) {
                if (array_key_exists($key, $attributes['utm'])) {
                    $value = CampaignAttribution::utm($attributes['utm'][$key]);
                    $link->{'utm_'.$key} = $value !== null && in_array('utm_'.$key, CampaignAttribution::LOWERCASE, true) ? mb_strtolower($value) : $value;
                }
            }
        }
    }

    /**
     * @throws ValidationException
     */
    private function check(ShortLink $link): void
    {
        $errors = [];
        if ($link->isDirty('code') && ShortLink::query()->when($link->exists, fn ($q) => $q->whereKeyNot($link->id))->where('code', $link->code)->exists()) {
            $errors['code'] = ['Another short link already uses this code.'];
        }
        if ($link->isDirty('campaign_id') && $link->campaign_id !== null && ! Campaign::query()->whereKey($link->campaign_id)->exists()) {
            $errors['campaign_id'] = ['Choose one of your campaigns.'];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    private function randomCode(): string
    {
        do {
            $code = Str::lower(Str::random(6));
            $code = preg_replace('/[^a-z0-9]/', 'x', $code) ?? 'link00';
        } while (ShortLink::query()->where('code', $code)->exists());

        return $code;
    }
}
