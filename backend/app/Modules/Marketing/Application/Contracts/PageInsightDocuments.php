<?php

namespace App\Modules\Marketing\Application\Contracts;

/**
 * B15: the store builder documents page insights are collected for — pages (home, landing, CMS
 * page designs), the header, the footer and shop areas — as Marketing needs them (declared here,
 * implemented by the Storefront module; organization from the tenant context).
 *
 * @phpstan-type InsightSection array{node_id: string, label: ?string, type: string}
 */
interface PageInsightDocuments
{
    /**
     * The top-level section ids of a published version of a document that is published now, or
     * null when the document is not this store's, not of a tracked kind, not published or has
     * no such version (older published versions count: a cached page may still show one).
     *
     * @return list<string>|null
     */
    public function trackableSections(string $documentId, int $version): ?array;

    /**
     * The document with its sections: `sections` in the order of the current published version
     * (none when never published), `draft_sections` those of the draft (labels for sections
     * that are no longer live), and its published versions. Null when the document is not this
     * store's or not of a tracked kind.
     *
     * @return array{id: string, title: string, kind: string, key: string, sections: list<InsightSection>,
     *   draft_sections: list<InsightSection>, versions: list<array{number: int, published_at: ?string}>}|null
     */
    public function describe(string $documentId): ?array;

    /**
     * Which of these ids are tracked documents of this store.
     *
     * @param  list<string>  $documentIds
     * @return list<string>
     */
    public function existing(array $documentIds): array;
}
