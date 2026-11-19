<?php

namespace App\Modules\Marketing\Application\Listeners;

use App\Modules\Cart\Application\Events\ProductAddedFromBuilderPage;
use App\Modules\Marketing\Application\Contracts\PageInsightDocuments;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\CampaignAttribution;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * B13: counts an add-to-cart for each A/B test version the shopper saw (`attribution.builder`
 * with `experiments` on POST /store/cart/items) in builder_experiment_stats — for tests of a
 * tracked page of the store, on the store-local day and the page's device (an attribution
 * without a device is not counted). Never fails the cart change: errors are reported only.
 */
class RecordExperimentAddToCart
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly PageInsightDocuments $documents,
    ) {}

    public function handle(ProductAddedFromBuilderPage $event): void
    {
        if ($event->device === null || ! in_array($event->device, CampaignAttribution::DEVICES, true)) {
            return;
        }
        try {
            $this->tenant->runAs($event->organizationId, function () use ($event) {
                $timezone = (string) ($this->organizations->summary($event->organizationId)['timezone'] ?? config('app.timezone'));
                $day = CarbonImmutable::now($timezone)->toDateString();
                $rows = [];
                foreach ($event->experiments as $experiment => $arm) {
                    if (! in_array($arm, ['A', 'B'], true) || $this->documents->experiment($event->documentId, (string) $experiment) === null) {
                        continue;
                    }
                    $rows[] = [
                        'organization_id' => $event->organizationId,
                        'document_id' => strtolower($event->documentId),
                        'experiment_id' => (string) $experiment,
                        'arm' => $arm,
                        'day' => $day,
                        'device' => $event->device,
                        'add_to_carts' => 1,
                    ];
                }
                if ($rows !== []) {
                    DB::table('builder_experiment_stats')->upsert(
                        $rows,
                        ['organization_id', 'document_id', 'experiment_id', 'arm', 'day', 'device'],
                        ['add_to_carts' => DB::raw('builder_experiment_stats.add_to_carts + excluded.add_to_carts')],
                    );
                }
            });
        } catch (Throwable $e) {
            report($e);
        }
    }
}
