<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Orders\Application\Contracts\OrderForms;
use App\Modules\Storefront\Application\Forms\SubmitBuilderForm;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;

/**
 * P2a: an order form as published — looked up in the published version of its document (a
 * page, CMS page design or shop area of the store's organization), live like a B8b form.
 */
class PublishedOrderForms implements OrderForms
{
    public function __construct(private readonly SubmitBuilderForm $forms) {}

    public function find(string $documentId, string $elementId): ?array
    {
        if (preg_match('/^[0-9a-fA-F-]{36}$/', $documentId) !== 1) {
            return null;
        }
        $document = BuilderDocument::query()->builder()->with('publishedVersion')->whereKey(strtolower($documentId))->first();
        $version = $document?->publishedVersion;
        if ($version === null || $document->isPopup() || ! $this->forms->documentLive($document)) {
            return null;
        }
        $element = SubmitBuilderForm::liveElement($version->content, $elementId, 'order_form');
        $props = $element['props'] ?? null;
        if (! is_array($props) || ! is_string($props['product_id'] ?? null)) {
            return null;
        }

        return [
            'document_id' => $document->id,
            'element_id' => $elementId,
            'path' => $document->storePath(),
            'product_id' => $props['product_id'],
            'upsell_product_id' => is_string($props['upsell']['product_id'] ?? null) ? $props['upsell']['product_id'] : null,
            'quantity_max' => (int) ($props['quantity']['max'] ?? 1),
            'email' => $props['fields']['email'] ?? 'optional',
            'note' => $props['fields']['note'] ?? 'optional',
            'payment' => $props['payment'] ?? 'cod_only',
        ];
    }
}
