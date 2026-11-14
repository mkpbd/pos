<?php

namespace App\Modules\OnlineCatalog\Application\Actions;

use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * P1a: a shopper asks to be e-mailed once when a variant of a live product is back in stock.
 * The answer is the same whether the request is new or already open (no address probing);
 * a filled honeypot stores nothing.
 */
class RequestBackInStock
{
    public function __construct(private readonly CatalogReadModel $catalog) {}

    /**
     * @param  array{variant_id: string, email: string, website?: ?string}  $data
     */
    public function __invoke(string $slug, array $data, ?string $customerAccountId, string $locale, string $siteUrl): void
    {
        $record = $this->catalog->products(['slug' => $slug])[0] ?? null;
        $variant = null;
        foreach ($record === null ? [] : $this->catalog->activeVariants($record) as $candidate) {
            if ($candidate['id'] === $data['variant_id']) {
                $variant = $candidate;
            }
        }
        if ($record === null || $variant === null) {
            throw ValidationException::withMessages(['variant_id' => ['This option is not available.']]);
        }

        // Honeypot: bots fill every field; answer as usual, keep nothing.
        if (filled($data['website'] ?? null)) {
            return;
        }

        $now = now();
        // One open request per variant and address (partial unique index): repeats are ignored.
        DB::table('back_in_stock_requests')->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'organization_id' => $this->catalog->organizationId(),
            'product_id' => $record['id'],
            'variant_id' => $variant['id'],
            'email' => mb_strtolower(trim($data['email'])),
            'customer_account_id' => $customerAccountId,
            'locale' => $locale,
            'site_url' => mb_substr(rtrim($siteUrl, '/'), 0, 255),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
}
