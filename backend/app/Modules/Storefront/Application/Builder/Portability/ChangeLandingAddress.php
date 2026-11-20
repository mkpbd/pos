<?php

namespace App\Modules\Storefront\Application\Builder\Portability;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\Collaboration\BuilderEditLock;
use App\Modules\Storefront\Application\Redirects\StorefrontRedirects;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Support\Facades\DB;

/**
 * B16: a landing page's new address (`/p/<slug>`): the key `landing:<slug>` changes, a domain
 * that opened on the old address opens on the new one, and a published page gets an automatic 301
 * from its old address (StorefrontRedirects). 422 NOT_A_LANDING_PAGE for other documents, 409
 * DOCUMENT_EXISTS when another landing page has the address, 423 DOCUMENT_LOCKED while someone
 * else edits it. Audited (`storefront.builder_address_changed`).
 */
class ChangeLandingAddress
{
    public function __construct(
        private readonly BuilderEditLock $lock,
        private readonly StorefrontRedirects $redirects,
        private readonly StorefrontContentVersion $contentVersion,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(BuilderDocument $document, string $slug): BuilderDocument
    {
        if ($document->landingSlug() === null) {
            throw new BusinessRuleViolation('NOT_A_LANDING_PAGE', 'Only campaign (landing) pages have an address of their own to change.');
        }
        $slug = strtolower($slug);

        return DB::transaction(function () use ($document, $slug) {
            $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            $this->lock->assertCanWrite($locked);
            $old = (string) $locked->landingSlug();
            if ($old === $slug) {
                return $locked;
            }
            $key = BuilderDocument::LANDING_PREFIX.$slug;
            if (BuilderDocument::query()->where('key', $key)->lockForUpdate()->exists()) {
                throw new BusinessRuleViolation('DOCUMENT_EXISTS', 'Another landing page already uses this address.', ['key' => $key], 409);
            }

            $locked->key = $key;
            $locked->save();
            StorefrontDomain::query()->where('entry_path', '/p/'.$old)->update(['entry_path' => '/p/'.$slug]);
            $published = $locked->published_version_id !== null;
            // Only a live page had visitors at the old address.
            $this->redirects->addressChanged($locked->organization_id, $published ? '/p/'.$old : null, '/p/'.$slug);
            if ($published) {
                $this->contentVersion->bump($locked->organization_id);
            }
            $this->audit->record('storefront.builder_address_changed', $locked, ['key' => BuilderDocument::LANDING_PREFIX.$old], ['key' => $key]);

            return $locked;
        });
    }
}
