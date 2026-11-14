<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Notifications;

use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\Inventory\Application\Events\StockBecameAvailable;
use App\Modules\OnlineCatalog\Infrastructure\Models\BackInStockRequest;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\Notification;

/**
 * P1a: when variants come back in stock at the storefront's fulfilment store, every open
 * back-in-stock request of a live product's active, now sellable variant gets its one e-mail
 * (queued) and is closed (`notified_at`). Each request is claimed with a conditional update,
 * so a request is never mailed twice.
 */
class NotifyBackInStock
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StockLevels $stock,
        private readonly LocaleContext $locale,
    ) {}

    public function handle(StockBecameAvailable $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            $catalog = app(CatalogReadModel::class);
            if ($catalog->fulfilmentStoreId() !== $event->storeId) {
                return;
            }

            $requests = BackInStockRequest::query()->whereIn('variant_id', $event->variantIds)->whereNull('notified_at')
                ->orderBy('created_at')->get();
            if ($requests->isEmpty()) {
                return;
            }

            $onHand = $this->stock->onHand($event->storeId, $requests->pluck('variant_id')->unique()->values()->all());
            $sellable = array_keys(array_filter($onHand, fn (string $qty) => Decimal::compare($qty, '0') > 0));
            $storeName = $catalog->siteName() ?? '';

            foreach ($requests->groupBy('locale') as $locale => $group) {
                $texts = $this->texts($group->pluck('product_id')->unique()->values()->all(), (string) $locale);

                foreach ($group as $request) {
                    /** @var BackInStockRequest $request */
                    $text = $texts[$request->product_id][$request->variant_id] ?? null;
                    if ($text === null || ! in_array($request->variant_id, $sellable, true)) {
                        continue; // not live or not sellable yet: stays open
                    }
                    $claimed = BackInStockRequest::query()->whereKey($request->id)->whereNull('notified_at')
                        ->update(['notified_at' => now(), 'updated_at' => now()]);
                    if ($claimed !== 1) {
                        continue;
                    }

                    Notification::route('mail', $request->email)->notify(new BackInStockEmail(
                        $storeName,
                        $text['product'],
                        $text['variant'],
                        rtrim($request->site_url, '/').$text['path'],
                        (string) $locale,
                    ));
                }
            }
        });
    }

    /**
     * Product names, variant labels and paths of live products in one language.
     *
     * @param  list<string>  $productIds
     * @return array<string, array<string, array{product: string, variant: ?string, path: string}>>
     */
    private function texts(array $productIds, string $locale): array
    {
        $locale = in_array($locale, LocaleContext::SUPPORTED, true) ? $locale : LocaleContext::BASE;

        return $this->locale->runAs($locale, function () use ($productIds) {
            $catalog = app(CatalogReadModel::class);
            $result = [];
            foreach ($catalog->products(['ids' => $productIds]) as $record) {
                $variants = $catalog->activeVariants($record);
                foreach ($variants as $variant) {
                    $result[$record['id']][$variant['id']] = [
                        'product' => $record['name'],
                        'variant' => count($variants) > 1 || $variant['option_values'] !== [] ? CatalogReadModel::variantLabel($record['name'], $variant) : null,
                        'path' => '/product/'.$record['listing']->slug,
                    ];
                }
            }

            return $result;
        });
    }
}
