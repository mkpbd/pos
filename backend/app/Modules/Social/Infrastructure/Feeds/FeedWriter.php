<?php

namespace App\Modules\Social\Infrastructure\Feeds;

/**
 * P2b: writes a catalog feed to a stream, item by item (Google Merchant fields, which Meta,
 * TikTok and Pinterest all read).
 *
 * @phpstan-type FeedRow array{id: string, item_group_id: ?string, title: string, description: string, link: string,
 *   image_link: ?string, additional_image_links: list<string>, availability: string, condition: string, price: string,
 *   sale_price: ?string, sale_price_effective_date: ?string, brand: ?string, product_type: ?string, color: ?string, size: ?string}
 */
interface FeedWriter
{
    /**
     * @param  resource  $stream
     */
    public function begin($stream, string $title, string $link, string $description): void;

    /**
     * @param  resource  $stream
     * @param  FeedRow  $row
     */
    public function item($stream, array $row): void;

    /**
     * @param  resource  $stream
     */
    public function end($stream): void;

    public function contentType(): string;
}
